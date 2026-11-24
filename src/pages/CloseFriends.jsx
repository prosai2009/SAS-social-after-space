import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart, Lock, Check } from 'lucide-react'
import { useToast } from '../context/ToastContext'
import { fetchFriendLists, fetchCloseFriends, addCloseFriend, removeCloseFriend, errText } from '../lib/db'
import Avatar from '../components/ui/Avatar'
import Page from '../components/ui/Page'
import Empty from '../components/ui/Empty'
import { Loading } from '../components/ui/Loading'

export default function CloseFriends() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [friends, setFriends] = useState(null)
  const [circle, setCircle] = useState(null)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    let alive = true
    Promise.all([fetchFriendLists(), fetchCloseFriends()])
      .then(([l, c]) => {
        if (!alive) return
        setFriends(l.friends)
        setCircle(new Set(c.map((x) => x.friend_id)))
      })
      .catch((e) => { if (alive) toast(errText(e), 'err') })
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (f) => {
    setBusyId(f.other.id)
    try {
      if (circle.has(f.other.id)) {
        await removeCloseFriend(f.other.id)
        setCircle((s) => { const n = new Set(s); n.delete(f.other.id); return n })
        toast('REMOVED FROM CIRCLE', 'ok')
      } else {
        await addCloseFriend(f.other.id)
        setCircle((s) => new Set(s).add(f.other.id))
        toast('ADDED TO CIRCLE', 'ok')
      }
    } catch (e) { toast(errText(e), 'err') } finally { setBusyId(null) }
  }

  const inCircleFriends = (friends || []).filter((f) => circle?.has(f.other.id))

  return (
    <Page>
      <div className="panel cut page-head">
        <h1 className="page-title">CLOSE FRIENDS</h1>
        <p className="mono dim">
          <Lock size={12} /> THE INNER CIRCLE. POSTS MARKED "CLOSE" ARE ONLY VISIBLE TO THEM —
          ENFORCED ON THE SERVER, NOT JUST HIDDEN.
        </p>
      </div>

      {friends === null || circle === null ? (
        <Loading label="LOADING CIRCLE…" />
      ) : (
        <>
          <div className="feed-head mono"><span className="accent-text">IN THE CIRCLE — {inCircleFriends.length}</span></div>
          {inCircleFriends.length === 0 ? (
            <Empty icon="◇" title="CIRCLE IS EMPTY" hint="Add accepted friends below to unlock Close-Friends posts." />
          ) : (
            <div className="friend-grid">
              {inCircleFriends.map((f) => (
                <div key={f.id} className="friend-card panel cut acc-green">
                  <button className="friend-id" onClick={() => navigate(`/profile/${f.other.username}`)}>
                    <Avatar profile={f.other} size="m" showDot />
                    <span className="friend-text">
                      <span className="friend-name">{f.other.display_name}</span>
                      <span className="friend-handle mono">@{f.other.username}</span>
                    </span>
                  </button>
                  <div className="friend-state mono accent-text"><Heart size={12} fill="currentColor" /> CIRCLE</div>
                  <div className="friend-actions">
                    <button className="btn btn-sm btn-ghost" disabled={busyId === f.other.id} onClick={() => toggle(f)}>REMOVE</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="feed-head mono"><span className="accent-text">ALL FRIENDS — {friends.length}</span></div>
          {friends.length === 0 ? (
            <Empty icon="▢▢▢" title="NO FRIENDS YET" hint="Add friends first, then promote your favourites." />
          ) : (
            <div className="friend-grid">
              {friends.map((f) => {
                const inC = circle.has(f.other.id)
                return (
                  <div key={f.id} className="friend-card panel cut acc-cyan">
                    <button className="friend-id" onClick={() => navigate(`/profile/${f.other.username}`)}>
                      <Avatar profile={f.other} size="m" showDot />
                      <span className="friend-text">
                        <span className="friend-name">{f.other.display_name}</span>
                        <span className="friend-handle mono">@{f.other.username}</span>
                      </span>
                    </button>
                    <div className="friend-state mono dim">{inC ? 'IN CIRCLE' : 'FRIEND'}</div>
                    <div className="friend-actions">
                      <button className={`btn btn-sm ${inC ? 'btn-acid' : ''}`} disabled={busyId === f.other.id} onClick={() => toggle(f)}>
                        {inC ? <><Check size={13} /> IN</> : <><Heart size={13} /> ADD</>}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </Page>
  )
}
