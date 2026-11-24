// Every backend operation SAS performs, in one place.
// All privacy enforcement happens in Supabase RLS (see supabase/schema.sql);
// this file just speaks to it.

import { supabase } from './supabase'

export function errText(e) {
  if (!e) return 'Unknown error'
  const map = {
    42501: 'You do not have permission to do that.',
    23505: 'That record already exists.',
    23503: 'That record is missing.',
  }
  if (e.message && e.message.includes('Failed to fetch')) return 'Network error — check your connection'
  return map[e.code] || e.message || 'Something went wrong'
}

async function uid() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user?.id || null
}

const P_FIELDS = 'id, username, display_name, avatar_url, status, accent, last_seen'

/* ===================== PROFILES ===================== */

export async function getProfileByUsername(username) {
  const { data, error } = await supabase
    .from('profiles').select(P_FIELDS).eq('username', username).maybeSingle()
  if (error) throw error
  return data
}

export async function getProfileById(id) {
  const { data, error } = await supabase
    .from('profiles').select(P_FIELDS).eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function searchUsers(q) {
  const clean = q.replace(/[,()%]/g, '').trim()
  if (clean.length < 2) return []
  const me = await uid()
  const { data, error } = await supabase
    .from('profiles')
    .select(P_FIELDS)
    .or(`username.ilike.%${clean}%,display_name.ilike.%${clean}%`)
    .neq('id', me)
    .limit(12)
  if (error) throw error
  return data
}

export async function updateMyProfile(id, patch) {
  const { data, error } = await supabase
    .from('profiles').update(patch).eq('id', id).select(P_FIELDS).single()
  if (error) throw error
  return data
}

export async function isUsernameTaken(username) {
  const { data } = await supabase
    .from('profiles').select('id').eq('username', username).maybeSingle()
  return Boolean(data)
}

/* ===================== FRIENDS ===================== */

export async function fetchFriendLists() {
  const me = await uid()
  const sel = `id, requester_id, addressee_id, created_at, responded_at,
    requester:profiles!friendships_requester_id_fkey(${P_FIELDS}),
    addressee:profiles!friendships_addressee_id_fkey(${P_FIELDS})`

  const [acc, inc, out] = await Promise.all([
    supabase.from('friendships').select(sel).eq('status', 'accepted')
      .or(`requester_id.eq.${me},addressee_id.eq.${me}`),
    supabase.from('friendships').select(sel).eq('status', 'pending').eq('addressee_id', me),
    supabase.from('friendships').select(sel).eq('status', 'pending').eq('requester_id', me),
  ])
  if (acc.error) throw acc.error
  if (inc.error) throw inc.error
  if (out.error) throw out.error

  const mapRow = (f) => (f.requester_id === me
    ? { id: f.id, other: f.addressee, since: f.responded_at || f.created_at }
    : { id: f.id, other: f.requester, since: f.responded_at || f.created_at })

  return {
    friends: acc.data.map(mapRow),
    incoming: inc.data.map(mapRow),
    outgoing: out.data.map(mapRow),
  }
}

export async function getFriendshipState(otherId) {
  const me = await uid()
  const { data } = await supabase
    .from('friendships')
    .select('id, status, requester_id, addressee_id')
    .or(`and(requester_id.eq.${me},addressee_id.eq.${otherId}),and(requester_id.eq.${otherId},addressee_id.eq.${me})`)
    .maybeSingle()
  if (!data) return { kind: 'none' }
  if (data.status === 'accepted') return { kind: 'friends', id: data.id }
  return {
    kind: 'pending',
    id: data.id,
    outgoing: data.requester_id === me,
  }
}

export async function sendFriendRequest(otherId) {
  const me = await uid()
  const { data, error } = await supabase
    .from('friendships')
    .insert({ requester_id: me, addressee_id: otherId })
    .select('id').single()
  if (error) throw error
  await safeNotify(otherId, me, 'friend_request')
  return data.id
}

export async function acceptFriendship(id, requesterId) {
  const { error } = await supabase
    .from('friendships').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
  if (requesterId) await safeNotify(requesterId, null, 'friend_accepted')
}

export async function deleteFriendship(id) {
  const { error } = await supabase.from('friendships').delete().eq('id', id)
  if (error) throw error
}

/* ===================== CLOSE FRIENDS ===================== */

export async function fetchCloseFriends() {
  const { data, error } = await supabase
    .from('close_friends')
    .select(`friend_id, created_at, friend:profiles!close_friends_friend_id_fkey(${P_FIELDS})`)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function addCloseFriend(friendId) {
  const { error } = await supabase
    .from('close_friends').insert({ friend_id: friendId })
  if (error) throw error
}

export async function removeCloseFriend(friendId) {
  const { error } = await supabase
    .from('close_friends').delete().eq('friend_id', friendId)
  if (error) throw error
}

/* ===================== FEED / POSTS ===================== */

export async function fetchPosts({ authorId, limit = 30 } = {}) {
  let q = supabase
    .from('posts')
    .select(`id, content, image_url, visibility, created_at, author_id,
      author:profiles!posts_author_id_fkey(${P_FIELDS}),
      likes(count), comments(count), reactions(emoji, user_id)`)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (authorId) q = q.eq('author_id', authorId)

  const { data, error } = await q
  if (error) throw error
  if (!data.length) return []

  const ids = data.map((p) => p.id)
  const me = await uid()
  const [myLikes, myReactions] = await Promise.all([
    supabase.from('likes').select('post_id').eq('user_id', me).in('post_id', ids),
    supabase.from('reactions').select('post_id, emoji').eq('user_id', me).in('post_id', ids),
  ])

  const likedSet = new Set((myLikes.data || []).map((r) => r.post_id))
  const reactedMap = new Map()
  for (const r of myReactions.data || []) {
    if (!reactedMap.has(r.post_id)) reactedMap.set(r.post_id, new Set())
    reactedMap.get(r.post_id).add(r.emoji)
  }

  return data.map((p) => {
    const counts = {}
    for (const r of p.reactions || []) counts[r.emoji] = (counts[r.emoji] || 0) + 1
    return {
      id: p.id,
      content: p.content,
      image_url: p.image_url,
      visibility: p.visibility,
      created_at: p.created_at,
      author_id: p.author_id,
      author: p.author,
      likeCount: p.likes?.[0]?.count || 0,
      liked: likedSet.has(p.id),
      commentCount: p.comments?.[0]?.count || 0,
      reactionCounts: counts,
      myReactions: reactedMap.get(p.id) || new Set(),
    }
  })
}

export async function createPost({ content, imageUrl, visibility }) {
  const me = await uid()
  const { data, error } = await supabase
    .from('posts')
    .insert({ author_id: me, content, image_url: imageUrl, visibility })
    .select(`*, author:profiles!posts_author_id_fkey(${P_FIELDS})`)
    .single()
  if (error) throw error
  return { ...data, likeCount: 0, liked: false, commentCount: 0, reactionCounts: {}, myReactions: new Set() }
}

export async function deletePost(id) {
  const { error } = await supabase.from('posts').delete().eq('id', id)
  if (error) throw error
}

export async function setPostVisibility(id, visibility) {
  const { error } = await supabase.from('posts').update({ visibility }).eq('id', id)
  if (error) throw error
}

export async function toggleLike(postId, liked) {
  const me = await uid()
  if (liked) {
    const { error } = await supabase.from('likes').delete()
      .eq('post_id', postId).eq('user_id', me)
    if (error) throw error
    return false
  }
  const { error } = await supabase.from('likes').insert({ post_id: postId, user_id: me })
  if (error) throw error
  return true
}

export async function toggleReaction(postId, emoji, active) {
  const me = await uid()
  if (active) {
    const { error } = await supabase.from('reactions').delete()
      .eq('post_id', postId).eq('user_id', me).eq('emoji', emoji)
    if (error) throw error
    return false
  }
  const { error } = await supabase.from('reactions').upsert(
    { post_id: postId, user_id: me, emoji },
    { onConflict: 'post_id,user_id,emoji' }
  )
  if (error) throw error
  return true
}

export async function fetchComments(postId) {
  const { data, error } = await supabase
    .from('comments')
    .select(`id, content, created_at, author_id, author:profiles!comments_author_id_fkey(${P_FIELDS})`)
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function addComment(postId, content, postAuthorId) {
  const me = await uid()
  const { data, error } = await supabase
    .from('comments')
    .insert({ post_id: postId, author_id: me, content })
    .select(`id, content, created_at, author_id, author:profiles!comments_author_id_fkey(${P_FIELDS})`)
    .single()
  if (error) throw error
  if (postAuthorId && postAuthorId !== me) await safeNotify(postAuthorId, me, 'post_comment', postId)
  return data
}

export async function deleteComment(id) {
  const { error } = await supabase.from('comments').delete().eq('id', id)
  if (error) throw error
}

/* ===================== NOTIFICATIONS ===================== */

// Notification failures must never break the main action.
export async function safeNotify(targetUserId, actorId, type, postId = null) {
  try {
    const me = actorId || (await uid())
    if (!me || targetUserId === me) return
    await supabase.from('notifications').insert({ user_id: targetUserId, actor_id: me, type, post_id: postId })
  } catch {
    /* non-critical */
  }
}

export async function fetchNotifications() {
  const { data, error } = await supabase
    .from('notifications')
    .select(`id, type, read, created_at, actor_id, actor:profiles!notifications_actor_id_fkey(${P_FIELDS})`)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error
  return data
}

export async function markNotificationRead(id) {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id)
  if (error) throw error
}

export async function markAllNotificationsRead() {
  const { error } = await supabase
    .from('notifications').update({ read: true }).eq('read', false)
  if (error) throw error
}

/* ===================== CHAT ===================== */

// v1.5 columns (last_read_at / edited_at) live behind a manual SQL upgrade.
// Detect them once so an un-migrated project still sends and loads messages
// instead of failing on a missing column.
let chatSignals = null
export async function chatSignalsReady() {
  if (chatSignals !== null) return chatSignals
  const { error } = await supabase
    .from('conversation_members')
    .select('last_read_at')
    .limit(1)
  chatSignals = !(error && (error.code === '42703' || /last_read_at/i.test(error.message || '')))
  return chatSignals
}

export async function listConversations() {
  const me = await uid()
  const signals = await chatSignalsReady()
  const mine = await supabase
    .from('conversation_members')
    .select(signals ? 'conversation_id, last_read_at' : 'conversation_id')
    .eq('user_id', me)
  if (mine.error) throw mine.error
  const ids = mine.data.map((r) => r.conversation_id)
  if (!ids.length) return []

  const msgCols = `id, conversation_id, content, image_url, created_at, sender_id${signals ? ', edited_at' : ''}`
  const memberCols = `conversation_id, user_id, ${signals ? 'last_read_at, ' : ''}profile:profiles!conversation_members_user_id_fkey(${P_FIELDS})`

  const [others, msgs, convs, unreadRes] = await Promise.all([
    supabase.from('conversation_members')
      .select(memberCols)
      .in('conversation_id', ids).neq('user_id', me),
    supabase.from('messages')
      .select(msgCols)
      .in('conversation_id', ids)
      .order('created_at', { ascending: false })
      .limit(400),
    supabase.from('conversations').select('id, created_at, last_message_at').in('id', ids),
    signals ? supabase.rpc('my_unread_counts') : Promise.resolve({ data: [], error: null }),
  ])
  if (others.error) throw others.error
  if (msgs.error) throw msgs.error
  if (convs.error) throw convs.error

  const unreadByConv = new Map(
    (unreadRes.error ? [] : (unreadRes.data || [])).map((r) => [r.conversation_id, Number(r.unread) || 0])
  )
  const convCreated = new Map(convs.data.map((c) => [c.id, c]))
  const lastByConv = new Map()
  for (const m of msgs.data) {
    if (!lastByConv.has(m.conversation_id)) lastByConv.set(m.conversation_id, m)
  }

  const out = []
  for (const id of ids) {
    const otherRows = others.data.filter((o) => o.conversation_id === id)
    const conv = convCreated.get(id)
    if (!conv) continue
    out.push({
      id,
      createdAt: conv.created_at,
      lastMessageAt: conv.last_message_at,
      participants: otherRows.map((r) => r.profile).filter(Boolean),
      otherLastReadAt: otherRows[0]?.last_read_at || null,
      unread: unreadByConv.get(id) || 0,
      last: lastByConv.get(id) || null,
    })
  }
  out.sort((a, b) => {
    const ta = new Date(a.lastMessageAt || a.createdAt).getTime() || 0
    const tb = new Date(b.lastMessageAt || b.createdAt).getTime() || 0
    return tb - ta
  })
  return out
}

export async function getOrCreateConversation(otherId) {
  // Atomic, server-side: validates friendship + blocks and creates the
  // conversation with both members in one transaction (v1.4 fix).
  const { data, error } = await supabase.rpc('start_conversation', { other: otherId })
  if (error) throw error
  return data
}

function msgSelect(signals) {
  return `id, content, image_url, created_at${signals ? ', edited_at' : ''}, sender_id,
      sender:profiles!messages_sender_id_fkey(${P_FIELDS})`
}

export async function fetchMessages(conversationId) {
  const signals = await chatSignalsReady()
  const { data, error } = await supabase
    .from('messages')
    .select(msgSelect(signals))
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(300)
  if (error) throw error
  return (data || []).reverse()
}

// Compact snapshot used by the chat's live catch-up loop. It is cheap enough
// to poll and still reveals inserts, edits, and deletions.
export async function fetchMessageDigest(conversationId) {
  const signals = await chatSignalsReady()
  const { data, error } = await supabase
    .from('messages')
    .select(`id, created_at${signals ? ', edited_at' : ''}`)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(300)
  if (error) throw error
  return (data || []).reverse()
}

export async function fetchMessagesByIds(ids) {
  if (!ids.length) return []
  const signals = await chatSignalsReady()
  const { data, error } = await supabase
    .from('messages')
    .select(msgSelect(signals))
    .in('id', ids)
  if (error) throw error
  return data || []
}

// Tiny incremental query for the open chat: returns the newest row plus
// anything after it. An idle chat costs a few hundred bytes per poll.
export async function fetchMessagesSince(conversationId, since) {
  const signals = await chatSignalsReady()
  const { data, error } = await supabase
    .from('messages')
    .select(msgSelect(signals))
    .eq('conversation_id', conversationId)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(100)
  if (error) throw error
  return data || []
}

export async function sendMessage(conversationId, { content, imageUrl }) {
  const me = await uid()
  const signals = await chatSignalsReady()
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: me, content, image_url: imageUrl })
    .select(msgSelect(signals))
    .single()
  if (error) throw error
  return data
}

export async function editMessage(id, content) {
  const signals = await chatSignalsReady()
  const patch = signals ? { content, edited_at: new Date().toISOString() } : { content }
  const { data, error } = await supabase
    .from('messages')
    .update(patch)
    .eq('id', id)
    .select(msgSelect(signals))
    .single()
  if (error) throw error
  return data
}

export async function markConversationRead(conversationId) {
  const { error } = await supabase.rpc('mark_conversation_read', { conv: conversationId })
  if (error) throw error
}

export async function deleteMessage(id) {
  const { error } = await supabase.from('messages').delete().eq('id', id)
  if (error) throw error
}

/* ===================== BLOCKS ===================== */

export async function fetchBlocked() {
  const { data, error } = await supabase
    .from('blocks')
    .select(`blocked_id, created_at, blocked:profiles!blocks_blocked_id_fkey(${P_FIELDS})`)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function blockUser(blockedId) {
  const { error } = await supabase.from('blocks').insert({ blocked_id: blockedId })
  if (error) throw error
}

export async function unblockUser(blockedId) {
  const { error } = await supabase.from('blocks').delete().eq('blocked_id', blockedId)
  if (error) throw error
}

/* ===================== ACTIVITY ===================== */

export async function fetchRecentFriendPosts(friendIds) {
  if (!friendIds.length) return []
  const { data, error } = await supabase
    .from('posts')
    .select(`id, content, created_at, author:profiles!posts_author_id_fkey(${P_FIELDS})`)
    .in('author_id', friendIds)
    .order('created_at', { ascending: false })
    .limit(8)
  if (error) throw error
  return data
}

/* ===================== ACCOUNT ===================== */

export async function deleteMyAccount() {
  const { error } = await supabase.rpc('delete_account')
  if (error) throw error
}
