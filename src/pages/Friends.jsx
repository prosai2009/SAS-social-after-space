import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, UserPlus, MessageCircle, Heart, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import {
  fetchFriendLists, fetchCloseFriends, searchUsers, sendFriendRequest, acceptFriendship,
  deleteFriendship, addCloseFriend, removeCloseFriend, getOrCreateConversation, errText,
} from '../lib/db'
import { isOnline } from '../lib/time'
import Avatar from '../components/ui/Avatar'
import Page from '../components/ui/Page'
import Empty from '../components/ui/Empty'
import { Loading } from '../components/ui/Loading'

export default function Friends() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const { profile: me } = useAuth()
  const [lists, setLists] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [circle, setCircle] = useState(new Set())
  const [busyId, setBusyId] = useState(null)
  const [searching, setSearching] = useState(false)

  const reload = async () => {
    try {
      const [l, c] = await Promise.all([fetchFriendLists(), fetchCloseFriends()])
      setLists(l)
      setCircle(new Set(c.map((x) => x.friend_id)))
    } catch (e) { toast(errText(e), 'err') }
  }

  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // username search (debounced)
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults(null); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const found = await searchUsers(q)
        setResults(found)
      } catch (e) { toast(errText(e), 'err') } finally { setSearching(false) }
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const relationFor = (userId) => {
    if (!lists) return { kind: 'none' }
    if (lists.friends.some((f) => f.other.id === userId)) return { kind: 'friends' }
    const inc = lists.incoming.find((f) => f.other.id === userId)
    if (inc) return { kind: 'pending', outgoing: false, id: inc.id }
    const out = lists.outgoing.find((f) => f.other.id === userId)
    if (out) return { kind: 'pending', outgoing: true, id: out.id }
    return { kind: 'none' }
  }

  const act = async (userId, fn, after) => {
    setBusyId(userId)
    try {
      await fn()
      await reload()
      if (after) after()
    } catch (e) { toast(errText(e), 'err') } finally { setBusyId(null) }
  }

  const add = (u) => act(u.id, async () => {
    await sendFriendRequest(u.id)
    toast(`REQUEST SENT TO @${u.username}`, 'ok')
  })
  const accept = (r) => act(r.other.id, () => acceptFriendship(r.id, r.other.id))
  const cancelOut = (r) => act(r.other.id, () => deleteFriendship(r.id))
  const remove = (r) => {
    if (!window.confirm(`Remove ${r.other.display_name} from friends?`)) return
    return act(r.other.id, async () => {
      await deleteFriendship(r.id)
      toast('REMOVED', 'ok')
    })
  }
  const toggleCircleFor = (u) => act(u.id, async () => {
    if (circle.has(u.id)) { await removeCloseFriend(u.id); setCircle((s) => { const n = new Set(s); n.delete(u.id); return n }) }
    else { await addCloseFriend(u.id); setCircle((s) => new Set(s).add(u.id)) }
  })
  const message = async (u) => {
    try {
      const id = await getOrCreateConversation(u.id)
      navigate('/messages', { state: { conversationId: id } })
    } catch (e) { toast(errText(e), 'err') }
  }

  const isBusy = (id) => busyId === id

  // friend card with contextual actions
  const FriendRow = ({ f }) => (
    <div className={`friend-card panel cut acc-${f.other.accent}`}>
      <button className="friend-id" onClick={() => navigate(`/profile/${f.other.username}`)}>
        <Avatar profile={f.other} size="m" showDot />
        <span className="friend-text">
          <span className="friend-name">{f.other.display_name}</span>
          <span className="friend-handle mono">@{f.other.username}</span>
          {f.other.status && <span className="friend-status mono dim">“{f.other.status}”</span>}
        </span>
      </button>
      <div className="friend-state mono">
        {isOnline(f.other.last_seen) ? <span className="accent-text">● ONLINE</span> : <span className="dim">OFFLINE</span>}
      </div>
      <div className="friend-actions">
        <button className="icon-btn" title="Message" aria-label={`Message ${f.other.display_name}`} onClick={() => message(f.other)}><MessageCircle size={15} /></button>
        <button className={`icon-btn ${circle.has(f.other.id) ? 'is-acid' : ''}`} title="Toggle close friend" aria-label="Toggle close friend" onClick={() => toggleCircleFor(f.other)} disabled={isBusy(f.other.id)}>
          <Heart size={15} fill={circle.has(f.other.id) ? 'currentColor' : 'none'} />
        </button>
        <button className="icon-btn" title="Remove friend" aria-label="Remove friend" onClick={() => remove(f)} disabled={isBusy(f.other.id)}><X size={15} /></button>
      </div>
    </div>
  )

  // search result card with full request lifecycle
  const ResultRow = ({ u }) => {
    const rel = relationFor(u.id)
    return (
      <div className={`friend-card panel cut acc-${u.accent}`}>
        <button className="friend-id" onClick={() => navigate(`/profile/${u.username}`)}>
          <Avatar profile={u} size="m" showDot />
          <span className="friend-text">
            <span className="friend-name">{u.display_name}</span>
            <span className="friend-handle mono">@{u.username}</span>
            {u.status && <span className="friend-status mono dim">“{u.status}”</span>}
          </span>
        </button>
        <div className="friend-state mono">
          {rel.kind === 'friends' ? <span className="accent-text">FRIENDS</span>
            : rel.kind === 'pending' ? <span className="dim">{rel.outgoing ? 'REQUEST SENT' : 'WANTS TO CONNECT'}</span>
            : <span className="dim">RUNNER</span>}
        </div>
        <div className="friend-actions">
          {rel.kind === 'none' && (
            <button className="btn btn-sm" onClick={() => add(u)} disabled={isBusy(u.id)}><UserPlus size={13} /> ADD</button>
          )}
          {rel.kind === 'pending' && !rel.outgoing && (
            <button className="btn btn-sm" onClick={() => act(u.id, () => acceptFriendship(rel.id, u.id))} disabled={isBusy(u.id)}>ACCEPT</button>
          )}
          {rel.kind === 'pending' && rel.outgoing && (
            <button className="btn btn-sm btn-ghost" onClick={() => act(u.id, () => deleteFriendship(rel.id))} disabled={isBusy(u.id)}>CANCEL</button>
          )}
          {rel.kind === 'friends' && (
            <button className="btn btn-sm btn-ghost" onClick={() => message(u)}><MessageCircle size={13} /> CHAT</button>
          )}
        </div>
      </div>
    )
  }

  return (
    <Page>
      <div className="panel cut page-head">
        <h1 className="page-title">FRIENDS</h1>
        <p className="mono dim">SEARCH THE GRID. BUILD YOUR CREW.</p>
        <label className="field search-field">
          <Search size={16} className="dim" />
          <input
            className="search-input"
            placeholder="SEARCH BY USERNAME OR NAME…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && <button className="icon-btn" onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}
        </label>
      </div>

      {searching && <Loading label="SCANNING GRID…" />}

      {query.trim().length >= 2 && !searching && (
        <div className="feed-head mono"><span className="accent-text">SEARCH RESULTS</span></div>
      )}
      {query.trim().length >= 2 && results !== null && (
        results.length === 0 ? (
          <Empty icon="[0]" title="NO RUNNERS FOUND" hint="Try a different handle." />
        ) : (
          <div className="friend-grid">
            {results.map((u) => <ResultRow key={u.id} u={u} />)}
          </div>
        )
      )}

      <div className="feed-head mono"><span className="accent-text">MY CREW {lists ? `— ${lists.friends.length}` : ''}</span></div>
      {lists === null ? (
        <Loading label="LOADING CREW…" />
      ) : lists.friends.length === 0 ? (
        <Empty icon="▢▢▢" title="NO FRIENDS YET" hint={`Search for ${me ? 'other runners' : 'people'} above and send your first request.`} />
      ) : (
        <div className="friend-grid">
          {lists.friends.map((f) => <FriendRow key={f.id} f={f} />)}
        </div>
      )}
    </Page>
  )
}
