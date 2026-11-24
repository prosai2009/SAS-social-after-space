import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Send, Trash2, ChevronLeft, Smile, Plus, Loader2, RefreshCw } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useUnread } from '../context/UnreadContext'
import {
  listConversations, getOrCreateConversation, fetchMessages, fetchMessageDigest,
  fetchMessagesByIds, fetchMessagesSince, sendMessage, editMessage, deleteMessage,
  fetchFriendLists, markConversationRead, chatSignalsReady, errText,
} from '../lib/db'
import { supabase } from '../lib/supabase'
import { isOnline, timeAgo, fullTime } from '../lib/time'
import Avatar from '../components/ui/Avatar'
import Page from '../components/ui/Page'
import Empty from '../components/ui/Empty'
import Modal from '../components/ui/Modal'
import { Loading } from '../components/ui/Loading'

const EMOJIS = ['🔥', '💜', '⚡', '😎', '😂', '👾', '✨', '💀', '🌈', '🎧', '🛸', '🤖']
const CATCH_UP_MS = 15000

// Applies a compact database snapshot to the open chat. The digest is the
// source of truth: rows missing from it were deleted, rows with a newer
// edited_at are patched, and rows we have never seen are appended.
function reconcileMessages(current, digest, freshRows) {
  const prev = current || []
  const digestIds = new Set(digest.map((d) => d.id))
  const freshById = new Map((freshRows || []).map((m) => [m.id, m]))
  let changed = prev.length !== digestIds.size

  let next = prev.filter((m) => digestIds.has(m.id))
  next = next.map((m) => {
    const patch = freshById.get(m.id)
    if (!patch) return m
    const sender = patch.sender || m.sender
    const same = m.content === patch.content
      && m.image_url === patch.image_url
      && (m.edited_at || null) === (patch.edited_at || null)
      && (m.sender?.id || null) === (sender?.id || null)
    if (same) return m
    changed = true
    return { ...m, ...patch, sender }
  })

  const known = new Set(next.map((m) => m.id))
  const additions = (freshRows || [])
    .filter((r) => digestIds.has(r.id) && !known.has(r.id))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  if (additions.length) {
    changed = true
    next = [...next, ...additions]
  }

  next.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  return changed ? next : current
}

export default function Messages() {
  const { userId } = useAuth()
  const { toast } = useToast()
  const { refresh: refreshUnread } = useUnread()
  const location = useLocation()

  const [conversations, setConversations] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [friends, setFriends] = useState([])
  const [otherTyping, setOtherTyping] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const endRef = useRef(null)
  const inputRef = useRef(null)
  const channelRef = useRef(null)
  const typingTimer = useRef(null)
  const typingSentAt = useRef(0)
  const lastReadSent = useRef({})
  const readTimer = useRef(null)
  const activeIdRef = useRef(null)
  const deepLinkDone = useRef(false)
  const screenSeq = useRef(0)
  const messagesRef = useRef(null)
  const catchUpRef = useRef(null)

  const active = conversations?.find((c) => c.id === activeId) || null
  const other = active?.participants?.[0] || null

  const loadConversations = async () => {
    try {
      const data = await listConversations()
      setConversations(data)
      return data
    } catch (e) {
      toast(errText(e), 'err')
      return null
    }
  }

  useEffect(() => { loadConversations() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { messagesRef.current = messages }, [messages])

  // Marks the open conversation read: clears the badge immediately, then
  // persists last_read_at so the sender sees ViewSync. Throttled with a
  // trailing call so a quick burst of messages still ends fully read.
  const markRead = (id) => {
    if (!id) return
    setConversations((list) => (list ? list.map((c) => (c.id === id ? { ...c, unread: 0 } : c)) : list))
    const run = () => {
      lastReadSent.current[id] = Date.now()
      markConversationRead(id).then(refreshUnread).catch(() => { /* never break chat */ })
    }
    const elapsed = Date.now() - (lastReadSent.current[id] || 0)
    clearTimeout(readTimer.current)
    if (elapsed >= 1500) run()
    else readTimer.current = setTimeout(run, 1500 - elapsed)
  }

  const openConversation = (id) => {
    setActiveId(id)
    markRead(id)
  }

  // deep-link: /messages with state {conversationId} from Profile/Friends.
  // Processed once per mount so a later inbox refresh can never yank the
  // user back into the deep-linked conversation.
  useEffect(() => {
    const target = location.state?.conversationId
    if (target && conversations && !deepLinkDone.current) {
      deepLinkDone.current = true
      setActiveId(target)
      markRead(target)
      window.history.replaceState({}, '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, conversations])

  // load messages + subscribe to realtime for the active conversation
  useEffect(() => {
    if (!activeId) return
    let alive = true
    setMessages(null)
    messagesRef.current = null
    setEditingId(null)
    setEditText('')
    setOtherTyping(false)
    typingSentAt.current = 0

    fetchMessages(activeId)
      .then((d) => {
        if (!alive) return
        setMessages(d)
        markRead(activeId)
      })
      .catch((e) => { if (alive) { setMessages([]); toast(errText(e), 'err') } })

    const channel = supabase
      .channel(`chat-${activeId}`, { config: { broadcast: { self: false } } })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${activeId}` },
        (payload) => {
          const row = payload.new
          screenSeq.current += 1
          setMessages((list) => {
            if (!list || list.some((m) => m.id === row.id)) return list
            return [...list, { ...row, sender: null }]
          })
          // realtime payloads don't embed the profile — fetch it once
          supabase.from('profiles').select('id, username, display_name, avatar_url, status, accent, last_seen')
            .eq('id', row.sender_id).single()
            .then(({ data }) => {
              if (!data) return
              setMessages((list) => (list || []).map((m) => (m.id === row.id ? { ...m, sender: data } : m)))
            })
          setConversations((list) => {
            if (!list) return list
            const visible = document.visibilityState === 'visible'
            const next = list.map((c) => (
              c.id === activeId
                ? {
                    ...c,
                    last: row,
                    lastMessageAt: row.created_at,
                    unread: row.sender_id === userId || visible ? 0 : (c.unread || 0) + 1,
                  }
                : c
            ))
            next.sort((a, b) => {
              const ta = new Date(a.lastMessageAt || a.createdAt).getTime() || 0
              const tb = new Date(b.lastMessageAt || b.createdAt).getTime() || 0
              return tb - ta
            })
            return next
          })
          if (row.sender_id !== userId) {
            setOtherTyping(false)
            if (document.visibilityState === 'visible') markRead(activeId)
          }
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${activeId}` },
        (payload) => {
          const row = payload.new
          screenSeq.current += 1
          setMessages((list) => (list || []).map((m) => (
            m.id === row.id ? { ...m, ...row, sender: m.sender } : m
          )))
        })
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages' },
        (payload) => {
          screenSeq.current += 1
          setMessages((list) => (list || []).filter((m) => m.id !== payload.old.id))
        })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload || payload.userId === userId) return
        setOtherTyping(true)
        clearTimeout(typingTimer.current)
        typingTimer.current = setTimeout(() => setOtherTyping(false), 3000)
      })
      .on('broadcast', { event: 'typing_stop' }, ({ payload }) => {
        if (!payload || payload.userId === userId) return
        setOtherTyping(false)
      })
      .on('broadcast', { event: 'chat_signal' }, ({ payload }) => {
        // The other side just sent/edited/deleted something. Ask the
        // database what changed instead of trusting the payload.
        catchUpRef.current?.(payload?.kind === 'edit' ? 'edit' : 'fast')
      })
      .subscribe()

    channelRef.current = channel

    // Read receipts live on a separate channel. If the DB upgrade has not
    // been run yet (or Realtime is not enabled for conversation_members),
    // only this optional channel fails — messages keep working.
    let receiptChannel = null
    chatSignalsReady().then((ready) => {
      if (!ready || !alive) return
      receiptChannel = supabase
        .channel(`receipts-${activeId}`)
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${activeId}` },
          (payload) => {
            const row = payload.new
            if (row.user_id === userId) return
            setConversations((list) => (list ? list.map((c) => (
              c.id === activeId ? { ...c, otherLastReadAt: row.last_read_at } : c
            )) : list))
          })
        .subscribe()
    })

    return () => {
      alive = false
      channelRef.current = null
      clearTimeout(typingTimer.current)
      setOtherTyping(false)
      supabase.removeChannel(channel)
      if (receiptChannel) supabase.removeChannel(receiptChannel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  // Keeps the conversation list live for channels that are not open.
  // The open channel already has its own subscription above.
  useEffect(() => {
    if (!userId) return
    let reloadTimer = null

    const sortByTime = (list) => {
      list.sort((a, b) => {
        const ta = new Date(a.lastMessageAt || a.createdAt).getTime() || 0
        const tb = new Date(b.lastMessageAt || b.createdAt).getTime() || 0
        return tb - ta
      })
      return list
    }

    const onInsert = (row) => {
      if (!row || row.conversation_id === activeIdRef.current) return
      setConversations((list) => {
        if (!list) return list
        if (!list.some((c) => c.id === row.conversation_id)) {
          // first message of a brand-new channel — pull the full list once
          clearTimeout(reloadTimer)
          reloadTimer = setTimeout(() => loadConversations(), 600)
          return list
        }
        return sortByTime(list.map((c) => (
          c.id === row.conversation_id
            ? {
                ...c,
                last: row,
                lastMessageAt: row.created_at,
                unread: row.sender_id === userId ? c.unread : (c.unread || 0) + 1,
              }
            : c
        )))
      })
    }

    const onUpdate = (row) => {
      if (!row) return
      setConversations((list) => {
        if (!list) return list
        return list.map((c) => (
          c.id === row.conversation_id && c.last?.id === row.id
            ? { ...c, last: { ...c.last, ...row } }
            : c
        ))
      })
    }

    const channel = supabase
      .channel(`inbox-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => onInsert(p.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (p) => onUpdate(p.new))
      .subscribe()

    return () => {
      clearTimeout(reloadTimer)
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Safety net + instant cross-client signal. Realtime postgres_changes is
  // still the primary path, but the sender also broadcasts a tiny "something
  // changed" event. The receiver then asks the database for a compact digest,
  // so inserts, edits, and deletes all land without a refresh even if the
  // Realtime publication is misconfigured. The timer is the last-resort path.
  useEffect(() => {
    if (!activeId) return
    let alive = true
    let inFlight = false
    let rerun = false
    let rerunMode = null

    const catchUp = async (mode) => {
      if (!alive) return
      if (inFlight) { rerun = true; rerunMode = mode || rerunMode; return }
      if (document.visibilityState !== 'visible') return
      inFlight = true
      const seq = screenSeq.current
      try {
        const digest = await fetchMessageDigest(activeId)
        // A local send/edit/delete or a live event landed mid-fetch — the
        // screen is already newer than this snapshot, so ignore it.
        if (!alive || seq !== screenSeq.current) return

        if (mode === 'edit') {
          // Edits are rare. Pull the full rows so even projects without the
          // v1.5 edited_at column update the text live.
          const fresh = await fetchMessages(activeId)
          if (!alive || seq !== screenSeq.current) return
          setMessages((list) => reconcileMessages(list, digest, fresh))
          return
        }

        const current = messagesRef.current || []
        const byId = new Map(current.map((m) => [m.id, m]))
        const digestIds = new Set(digest.map((d) => d.id))
        const missing = digest.filter((d) => !byId.has(d.id)).map((d) => d.id)
        const edited = digest.filter((d) => {
          const old = byId.get(d.id)
          return old && 'edited_at' in d && (old.edited_at || null) !== (d.edited_at || null)
        }).map((d) => d.id)
        const lostOne = current.some((m) => !digestIds.has(m.id))
        if (!missing.length && !edited.length && !lostOne) return

        const fresh = await fetchMessagesByIds([...missing, ...edited])
        if (!alive || seq !== screenSeq.current) return
        setMessages((list) => reconcileMessages(list, digest, fresh))
      } catch {
        /* keep whatever is already on screen */
      } finally {
        inFlight = false
        if (rerun) {
          rerun = false
          const nextMode = rerunMode || 'fast'
          rerunMode = null
          catchUp(nextMode)
        }
      }
    }

    catchUpRef.current = catchUp

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      markRead(activeId)
      catchUp()
    }

    const timer = setInterval(catchUp, CATCH_UP_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      alive = false
      catchUpRef.current = null
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  // Fast incremental insert poll. It asks only for rows at/after the newest
  // message already on screen, so an idle open chat costs almost nothing.
  // This guarantees incoming messages even if both Realtime and broadcasts
  // are unavailable; the digest sweep above handles deletes and edits.
  useEffect(() => {
    if (!activeId) return
    let alive = true
    let inFlight = false
    const EPOCH = '1970-01-01T00:00:00.000Z'

    const tick = async () => {
      if (!alive || inFlight || document.visibilityState !== 'visible') return
      const list = messagesRef.current
      if (!list) return // initial load still running
      const since = list.length ? list[list.length - 1].created_at : EPOCH
      inFlight = true
      try {
        const rows = await fetchMessagesSince(activeId, since)
        if (!alive || !rows.length) return
        const have = new Set((messagesRef.current || []).map((m) => m.id))
        const fresh = rows.filter((m) => !have.has(m.id))
        if (!fresh.length) return
        screenSeq.current += 1

        setMessages((current) => {
          const known = new Set((current || []).map((m) => m.id))
          const add = fresh.filter((m) => !known.has(m.id))
          if (!add.length) return current
          return [...(current || []), ...add]
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        })

        const last = fresh[fresh.length - 1]
        setConversations((current) => {
          if (!current) return current
          const next = current.map((c) => (
            c.id === activeId
              ? { ...c, last, lastMessageAt: last.created_at, unread: 0 }
              : c
          ))
          next.sort((a, b) => {
            const ta = new Date(a.lastMessageAt || a.createdAt).getTime() || 0
            const tb = new Date(b.lastMessageAt || b.createdAt).getTime() || 0
            return tb - ta
          })
          return next
        })

        if (fresh.some((m) => m.sender_id !== userId)) {
          setOtherTyping(false)
          if (document.visibilityState === 'visible') markRead(activeId)
        }
      } catch {
        /* the digest sweep will catch up */
      } finally {
        inFlight = false
      }
    }

    const timer = setInterval(tick, 3000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages?.length])

  const notifyTyping = () => {
    const now = Date.now()
    if (!channelRef.current || now - typingSentAt.current < 1200) return
    typingSentAt.current = now
    channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { userId } })
  }

  const stopTyping = () => {
    channelRef.current?.send({ type: 'broadcast', event: 'typing_stop', payload: { userId } })
  }

  // Cheap "pull" signal for the other member. They will query a compact
  // digest, so this works even when postgres_changes is unavailable.
  const signalChat = (kind) => {
    channelRef.current?.send({ type: 'broadcast', event: 'chat_signal', payload: { kind } })
  }

  const onChangeText = (e) => {
    const v = e.target.value
    setText(v)
    if (v.trim()) notifyTyping()
    else stopTyping()
  }

  const openPicker = async () => {
    setPickerOpen(true)
    try {
      const lists = await fetchFriendLists()
      setFriends(lists.friends)
    } catch (e) { toast(errText(e), 'err') }
  }

  const startWith = async (f) => {
    try {
      const id = await getOrCreateConversation(f.other.id)
      setPickerOpen(false)
      await loadConversations()
      openConversation(id)
    } catch (e) { toast(errText(e), 'err') }
  }

  const send = async (e) => {
    e?.preventDefault?.()
    const content = text.trim()
    if (!content || sending || !activeId) return
    setSending(true)
    stopTyping()
    try {
      const msg = await sendMessage(activeId, { content, imageUrl: null })
      screenSeq.current += 1
      signalChat('new')
      setMessages((list) => {
        if (!list || list.some((m) => m.id === msg.id)) return list
        return [...list, msg]
      })
      setConversations((list) => {
        if (!list) return list
        const next = list.map((c) => (
          c.id === activeId ? { ...c, last: msg, lastMessageAt: msg.created_at, unread: 0 } : c
        ))
        next.sort((a, b) => {
          const ta = new Date(a.lastMessageAt || a.createdAt).getTime() || 0
          const tb = new Date(b.lastMessageAt || b.createdAt).getTime() || 0
          return tb - ta
        })
        return next
      })
      setText('')
      setShowEmoji(false)
    } catch (err) { toast(errText(err), 'err') } finally { setSending(false) }
  }

  const startEdit = (m) => {
    setEditingId(m.id)
    setEditText(m.content || '')
    setShowEmoji(false)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  const saveEdit = async (id) => {
    const content = editText.trim()
    if (!content || savingEdit) return
    setSavingEdit(true)
    try {
      const updated = await editMessage(id, content)
      screenSeq.current += 1
      signalChat('edit')
      setMessages((list) => (list || []).map((m) => (
        m.id === id ? { ...m, ...updated, sender: m.sender } : m
      )))
      setConversations((list) => (list ? list.map((c) => (
        c.last?.id === id ? { ...c, last: { ...c.last, ...updated } } : c
      )) : list))
      cancelEdit()
      toast('Signal ReSynced', 'ok')
    } catch (err) {
      toast(errText(err), 'err')
    } finally {
      setSavingEdit(false)
    }
  }

  const removeMsg = async (id) => {
    try {
      await deleteMessage(id)
      screenSeq.current += 1
      signalChat('delete')
      setMessages((list) => (list || []).filter((m) => m.id !== id))
      if (editingId === id) cancelEdit()
    } catch (e) { toast(errText(e), 'err') }
  }

  const insertEmoji = (em) => {
    setText((t) => t + em)
    inputRef.current?.focus()
  }

  const isSynced = (m) => Boolean(
    active?.otherLastReadAt
    && new Date(m.created_at).getTime() <= new Date(active.otherLastReadAt).getTime()
  )

  return (
    <Page className="messages-page">
      <div className="chat-shell panel cut">
        {/* conversation list */}
        <div className={`chat-list ${activeId ? 'chat-list-hidden' : ''}`}>
          <div className="rail-head mono accent-text chat-list-head">
            TRANSMISSIONS
            <button className="icon-btn" onClick={openPicker} title="New conversation" aria-label="New conversation"><Plus size={16} /></button>
          </div>
          {conversations === null ? (
            <Loading label="OPENING CHANNELS…" />
          ) : conversations.length === 0 ? (
            <div className="chat-list-empty mono dim">NO CHANNELS YET.<br />OPEN A FRIEND'S PROFILE → MESSAGE.</div>
          ) : conversations.map((c) => {
            const p = c.participants[0] || null
            const last = c.last
            return (
              <button
                key={c.id}
                className={`chat-list-row ${c.id === activeId ? 'active' : ''} ${c.unread > 0 ? 'has-unread' : ''}`}
                onClick={() => openConversation(c.id)}
              >
                <Avatar profile={p} size="m" showDot />
                <span className="chat-list-text">
                  <span className="chat-list-name">{p?.display_name || 'GHOST USER'}</span>
                  <span className="chat-list-last mono dim">
                    {last ? (last.content ? last.content.slice(0, 34) : '[IMAGE]') : 'NO SIGNALS YET'}
                  </span>
                </span>
                {last && <span className="mono dim chat-list-time">{timeAgo(last.created_at)}</span>}
                {c.unread > 0 && (
                  <span className="chat-unread" aria-label={`${c.unread} unread messages`}>
                    {c.unread > 99 ? '99+' : c.unread}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* chat pane */}
        <div className={`chat-pane ${activeId ? 'chat-pane-open' : ''}`}>
          {activeId === null || conversations === null ? (
            <div className="chat-none">
              <Empty icon="⌁" title="SELECT A CHANNEL" hint="Pick a conversation on the left, or start one from a friend's profile." />
            </div>
          ) : (
            <>
              <div className="chat-head">
                <button className="icon-btn chat-back" onClick={() => setActiveId(null)} aria-label="Back to conversations"><ChevronLeft size={18} /></button>
                <Avatar profile={other} size="s" showDot />
                <span className="chat-head-text">
                  <span className="chat-head-name">{other?.display_name || 'GHOST USER'}</span>
                  <span className={`mono chat-head-status ${otherTyping ? 'typing' : 'dim'}`}>
                    {otherTyping ? (
                      <><span className="typing-ring" aria-hidden="true" /> Signal Forming…</>
                    ) : other ? (
                      isOnline(other.last_seen) ? 'ONLINE' : 'OFFLINE'
                    ) : ''}
                  </span>
                </span>
              </div>

              <div className="chat-scroll">
                {messages === null ? (
                  <Loading label="DECRYPTING…" />
                ) : messages.length === 0 ? (
                  <div className="mono dim chat-empty-hint">CHANNEL OPEN — SAY SOMETHING FIRST.</div>
                ) : messages.map((m) => {
                  const mine = m.sender_id === userId
                  const sender = m.sender
                  const synced = isSynced(m)
                  return (
                    <div key={m.id} className={`chat-msg ${mine ? 'mine' : 'theirs'}`} title={fullTime(m.created_at)}>
                      {!mine && <Avatar profile={sender} size="xs" />}
                      <div className={`bubble ${editingId === m.id ? 'bubble-editing' : ''}`}>
                        {editingId === m.id ? (
                          <div className="bubble-edit">
                            <input
                              autoFocus
                              className="chat-input bubble-edit-input"
                              value={editText}
                              maxLength={2000}
                              onChange={(e) => setEditText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); saveEdit(m.id) }
                                if (e.key === 'Escape') cancelEdit()
                              }}
                            />
                            <div className="bubble-edit-actions">
                              <button type="button" className="btn btn-sm" onClick={() => saveEdit(m.id)} disabled={savingEdit || !editText.trim()}>
                                {savingEdit ? <Loader2 size={12} className="spinner" /> : 'ReSync'}
                              </button>
                              <button type="button" className="btn btn-sm btn-ghost" onClick={cancelEdit}>CANCEL</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {m.image_url && <img src={m.image_url} alt="Shared" className="bubble-img" loading="lazy" />}
                            {m.content && <div className="bubble-text">{m.content}</div>}
                            <div className="bubble-foot mono">
                              {m.edited_at && <span className="resync-tag">ReSynced</span>}
                              <span className="bubble-time">{timeAgo(m.created_at)}</span>
                              {mine && (
                                <span className={`msg-state ${synced ? 'is-synced' : ''}`}>
                                  {synced ? 'ViewSync' : 'Transmitted'}
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                      {mine && editingId !== m.id && (
                        <div className="bubble-actions">
                          <button className="icon-btn" onClick={() => startEdit(m)} title="ReSync" aria-label="ReSync message">
                            <RefreshCw size={12} />
                          </button>
                          <button className="icon-btn" onClick={() => removeMsg(m.id)} title="Delete message" aria-label="Delete message">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
                <div ref={endRef} />
              </div>

              {otherTyping && (
                <div className="typing-row" aria-live="polite">
                  <span className="typing-ring" aria-hidden="true" />
                  <span className="mono">Signal Forming…</span>
                </div>
              )}

              {showEmoji && (
                <div className="emoji-strip">
                  {EMOJIS.map((em) => (
                    <button key={em} type="button" className="emoji-btn" onClick={() => insertEmoji(em)}>{em}</button>
                  ))}
                </div>
              )}

              <form className="chat-input-row" onSubmit={send}>
                <button type="button" className="icon-btn" onClick={() => setShowEmoji((s) => !s)} aria-label="Toggle emoji strip">
                  <Smile size={18} />
                </button>
                <input
                  ref={inputRef}
                  className="chat-input"
                  placeholder="TYPE A SIGNAL…"
                  value={text}
                  maxLength={2000}
                  onChange={onChangeText}
                />
                <button className="btn btn-sm chat-send" type="submit" disabled={sending || !text.trim()} aria-label="Send">
                  {sending ? <Loader2 size={15} className="spinner" /> : <Send size={15} />}
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="START A CHANNEL">
        {friends.length === 0 ? (
          <div className="mono dim picker-empty">ADD FRIENDS FIRST — NO CHANNELS WITHOUT CREW.</div>
        ) : (
          <div className="picker-list">
            {friends.map((f) => (
              <button key={f.id} className="rail-row" onClick={() => startWith(f)}>
                <Avatar profile={f.other} size="s" showDot />
                <span className="rail-row-text">
                  <span className="rail-row-name">{f.other.display_name}</span>
                  <span className="rail-row-sub mono">@{f.other.username}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </Page>
  )
}
