import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MessageCircle, UserPlus, Heart, CalendarDays, Pencil } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import {
  getProfileByUsername, fetchPosts, fetchFriendLists, fetchCloseFriends,
  sendFriendRequest, acceptFriendship, deleteFriendship, addCloseFriend,
  removeCloseFriend, getOrCreateConversation, errText,
} from '../lib/db'
import { joinedTime } from '../lib/time'
import Avatar from '../components/ui/Avatar'
import Page from '../components/ui/Page'
import Empty from '../components/ui/Empty'
import Modal from '../components/ui/Modal'
import PostCard from '../components/feed/PostCard'
import ProfileEditForm from '../components/ui/ProfileEditForm'
import { Loading } from '../components/ui/Loading'

export default function Profile() {
  const { username } = useParams()
  const navigate = useNavigate()
  const { profile: me } = useAuth()
  const { toast } = useToast()

  const [profile, setProfile] = useState(undefined) // undefined loading, null not found
  const [posts, setPosts] = useState(null)
  const [rel, setRel] = useState({ kind: 'none' })
  const [inCircle, setInCircle] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  const isMe = me?.username === username

  useEffect(() => {
    let alive = true
    setProfile(undefined)
    setPosts(null)
    getProfileByUsername(username)
      .then(async (p) => {
        if (!alive) return
        setProfile(p)
        if (!p) return
        try {
          const [lists, circle] = await Promise.all([fetchFriendLists(), fetchCloseFriends()])
          if (!alive) return
          setInCircle(circle.some((c) => c.friend_id === p.id))
          if (isMe) { setRel({ kind: 'me' }); return }
          const friendsSet = new Set(lists.friends.map((f) => f.other.id))
          if (friendsSet.has(p.id)) { setRel({ kind: 'friends' }); return }
          const inc = lists.incoming.find((f) => f.other.id === p.id)
          if (inc) { setRel({ kind: 'pending', outgoing: false, id: inc.id }); return }
          const out = lists.outgoing.find((f) => f.other.id === p.id)
          if (out) { setRel({ kind: 'pending', outgoing: true, id: out.id }); return }
          setRel({ kind: 'none' })
        } catch (e) { toast(errText(e), 'err') }
      })
      .catch((e) => { if (alive) { setProfile(null); toast(errText(e), 'err') } })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username])

  useEffect(() => {
    if (!profile) return
    let alive = true
    fetchPosts({ authorId: profile.id, limit: 30 })
      .then((d) => alive && setPosts(d))
      .catch((e) => { if (alive) { setPosts([]); toast(errText(e), 'err') } })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  const update = (id, fn) => setPosts((list) => list.map((p) => (p.id === id ? fn(p) : p)))
  const remove = (id) => setPosts((list) => list.filter((p) => p.id !== id))

  const addFriend = async () => {
    setBusy(true)
    try {
      await sendFriendRequest(profile.id)
      setRel({ kind: 'pending', outgoing: true })
      toast('REQUEST TRANSMITTED', 'ok')
    } catch (e) { toast(errText(e), 'err') } finally { setBusy(false) }
  }

  const acceptReq = async () => {
    setBusy(true)
    try {
      await acceptFriendship(rel.id)
      setRel({ kind: 'friends' })
      toast('FRIENDS NOW', 'ok')
    } catch (e) { toast(errText(e), 'err') } finally { setBusy(false) }
  }

  const removeFriend = async () => {
    if (!window.confirm('Remove this friend?')) return
    setBusy(true)
    try {
      await deleteFriendship(rel.id)
      setRel({ kind: 'none' })
      setInCircle(false)
      toast('REMOVED', 'ok')
    } catch (e) { toast(errText(e), 'err') } finally { setBusy(false) }
  }

  const toggleCircle = async () => {
    setBusy(true)
    try {
      if (inCircle) { await removeCloseFriend(profile.id); setInCircle(false); toast('REMOVED FROM CIRCLE', 'ok') }
      else { await addCloseFriend(profile.id); setInCircle(true); toast('ADDED TO CLOSE FRIENDS', 'ok') }
    } catch (e) { toast(errText(e), 'err') } finally { setBusy(false) }
  }

  const message = async () => {
    try {
      const id = await getOrCreateConversation(profile.id)
      navigate('/messages', { state: { conversationId: id } })
    } catch (e) { toast(errText(e), 'err') }
  }

  if (profile === undefined) return <Page><Loading label="LOADING IDENTITY…" /></Page>
  if (profile === null) {
    return (
      <Page>
        <Empty icon="[?]" title="USER NOT FOUND" hint={`No runner with handle @${username} exists in this dimension.`} />
      </Page>
    )
  }

  const stats = [
    { label: 'POSTS', value: posts ? posts.length : '…' },
  ]

  return (
    <Page>
      <div className={`id-card panel cut acc-${profile.accent}`}>
        <div className="id-banner">
          <div className="id-banner-grid" aria-hidden="true" />
          <span className="id-banner-tag mono">IDENTITY // {profile.username.toUpperCase()}</span>
        </div>

        <div className="id-body">
          <div className="id-avatar">
            <Avatar profile={profile} size="xl" showDot />
          </div>

          <div className="id-main">
            <h1 className="id-name">{profile.display_name}</h1>
            <div className="mono id-handle">@{profile.username}</div>
            {profile.status && <div className="id-status">“{profile.status}”</div>}
            {profile.bio && <p className="id-bio">{profile.bio}</p>}
            <div className="id-meta mono dim">
              <span><CalendarDays size={12} /> IN THE SPACE SINCE {joinedTime(profile.created_at).toUpperCase()}</span>
              {stats.map((s) => <span key={s.label}>{s.value} {s.label}</span>)}
            </div>

            <div className="id-actions">
              {isMe ? (
                <button className="btn" onClick={() => setEditing(true)}><Pencil size={14} /> EDIT IDENTITY</button>
              ) : (
                <>
                  {rel.kind === 'none' && (
                    <button className="btn" onClick={addFriend} disabled={busy}><UserPlus size={14} /> ADD FRIEND</button>
                  )}
                  {rel.kind === 'pending' && rel.outgoing && (
                    <button className="btn btn-ghost" onClick={removeFriend} disabled={busy}>CANCEL REQUEST</button>
                  )}
                  {rel.kind === 'pending' && !rel.outgoing && (
                    <>
                      <button className="btn" onClick={acceptReq} disabled={busy}>ACCEPT</button>
                      <button className="btn btn-ghost" onClick={removeFriend} disabled={busy}>DECLINE</button>
                    </>
                  )}
                  {rel.kind === 'friends' && (
                    <button className="btn btn-ghost" onClick={removeFriend} disabled={busy}>REMOVE FRIEND</button>
                  )}
                  {rel.kind === 'friends' && (
                    <button className="btn btn-ghost" onClick={message}><MessageCircle size={14} /> MESSAGE</button>
                  )}
                  {rel.kind === 'friends' && (
                    <button className={`btn ${inCircle ? 'btn-acid' : 'btn-ghost'}`} onClick={toggleCircle} disabled={busy}>
                      <Heart size={14} fill={inCircle ? 'currentColor' : 'none'} /> {inCircle ? 'CLOSE FRIEND ✓' : 'CLOSE FRIEND'}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="feed-head mono"><span className="accent-text">TRANSMISSIONS</span></div>

      {posts === null ? (
        <Loading label="LOADING TRANSMISSIONS…" />
      ) : posts.length === 0 ? (
        <Empty icon="▚▚▚" title={isMe ? 'NO POSTS YET' : 'NO VISIBLE POSTS'}
          hint={isMe ? 'Share your first signal from Home.' : 'Either this runner posts privately, or nothing exists yet.'} />
      ) : (
        <div className="feed">
          {posts.map((p) => <PostCard key={p.id} post={p} onChange={update} onRemove={remove} />)}
        </div>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} title="EDIT IDENTITY">
        <ProfileEditForm onSaved={async () => {
          const p = await getProfileByUsername(username)
          if (p) setProfile(p)
          setEditing(false)
        }} />
      </Modal>
    </Page>
  )
}
