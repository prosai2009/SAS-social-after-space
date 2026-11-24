import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Check, X } from 'lucide-react'
import { useToast } from '../context/ToastContext'
import { fetchFriendLists, acceptFriendship, deleteFriendship, errText } from '../lib/db'
import { isOnline, timeAgo } from '../lib/time'
import Avatar from '../components/ui/Avatar'
import Page from '../components/ui/Page'
import Empty from '../components/ui/Empty'
import { Loading } from '../components/ui/Loading'

export default function Requests() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [lists, setLists] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = async () => {
    try { setLists(await fetchFriendLists()) } catch (e) { toast(errText(e), 'err') }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const withBusy = async (id, fn) => {
    setBusyId(id)
    try { await fn(); await load() } catch (e) { toast(errText(e), 'err') } finally { setBusyId(null) }
  }

  const Row = ({ f, direction }) => (
    <div className={`request-row panel cut acc-${f.other.accent}`}>
      <button className="friend-id" onClick={() => navigate(`/profile/${f.other.username}`)}>
        <Avatar profile={f.other} size="m" showDot />
        <span className="friend-text">
          <span className="friend-name">
            {direction === 'in' ? <ArrowDownLeft size={13} className="accent-text" /> : <ArrowUpRight size={13} className="dim" />}
            {' '}{f.other.display_name}
          </span>
          <span className="friend-handle mono">@{f.other.username}</span>
          <span className="friend-status mono dim">{timeAgo(f.since)} AGO {isOnline(f.other.last_seen) ? '· ONLINE' : ''}</span>
        </span>
      </button>
      <div className="friend-actions">
        {direction === 'in' ? (
          <>
            <button className="btn btn-sm" disabled={busyId === f.other.id} onClick={() => withBusy(f.other.id, () => acceptFriendship(f.id, f.other.id))}>
              <Check size={13} /> ACCEPT
            </button>
            <button className="btn btn-sm btn-ghost" disabled={busyId === f.other.id} onClick={() => withBusy(f.other.id, () => deleteFriendship(f.id))}>
              <X size={13} /> DECLINE
            </button>
          </>
        ) : (
          <button className="btn btn-sm btn-ghost" disabled={busyId === f.other.id} onClick={() => withBusy(f.other.id, () => deleteFriendship(f.id))}>
            CANCEL
          </button>
        )}
      </div>
    </div>
  )

  return (
    <Page>
      <div className="panel cut page-head">
        <h1 className="page-title">FRIEND REQUESTS</h1>
        <p className="mono dim">ACCEPT, DECLINE, CANCEL — YOUR CALL.</p>
      </div>

      {lists === null ? (
        <Loading label="LOADING REQUESTS…" />
      ) : (
        <>
          <div className="feed-head mono"><span className="accent-text">INCOMING — {lists.incoming.length}</span></div>
          {lists.incoming.length === 0 ? (
            <Empty icon="▢▢▢" title="NO INCOMING REQUESTS" hint="When someone wants to connect, they land here." />
          ) : (
            lists.incoming.map((f) => <Row key={f.id} f={f} direction="in" />)
          )}

          <div className="feed-head mono"><span className="accent-text">OUTGOING — {lists.outgoing.length}</span></div>
          {lists.outgoing.length === 0 ? (
            <Empty icon="▢▢▢" title="NO OUTGOING REQUESTS" hint="Find runners on the Friends page and ping them." />
          ) : (
            lists.outgoing.map((f) => <Row key={f.id} f={f} direction="out" />)
          )}
        </>
      )}
    </Page>
  )
}
