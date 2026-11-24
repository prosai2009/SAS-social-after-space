import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart, MessageCircle, Smile, UserPlus, Check, Bell } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { fetchFriendLists, fetchNotifications, fetchRecentFriendPosts, markNotificationRead, markAllNotificationsRead, errText } from '../../lib/db'
import { isOnline, timeAgo } from '../../lib/time'
import Avatar from '../ui/Avatar'
import { useToast } from '../../context/ToastContext'

const TYPE_META = {
  friend_request: { icon: UserPlus, label: 'sent a friend request' },
  friend_accepted: { icon: Check, label: 'accepted your request' },
  post_like: { icon: Heart, label: 'liked your post' },
  post_comment: { icon: MessageCircle, label: 'commented on your post' },
  post_reaction: { icon: Smile, label: 'reacted to your post' },
}

function notifPrefs() {
  try { return JSON.parse(localStorage.getItem('sas_notifprefs')) || {} } catch { return {} }
}

export default function RightRail() {
  const { profile } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [friends, setFriends] = useState([])
  const [activity, setActivity] = useState([])
  const [notifs, setNotifs] = useState([])

  useEffect(() => {
    if (!profile) return
    let alive = true
    const load = async () => {
      try {
        const lists = await fetchFriendLists()
        if (!alive) return
        setFriends(lists.friends)
        setActivity(await fetchRecentFriendPosts(lists.friends.map((f) => f.other.id)))
        setNotifs(await fetchNotifications())
      } catch (e) {
        if (alive) toast(errText(e), 'err')
      }
    }
    load()
    const t = setInterval(load, 60_000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { alive = false; clearInterval(t); window.removeEventListener('focus', onFocus) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  if (!profile) return null

  const prefs = notifPrefs()
  const visibleNotifs = notifs.filter((n) => prefs[n.type] !== false)
  const online = friends.filter((f) => isOnline(f.other.last_seen))
  const unread = visibleNotifs.filter((n) => !n.read).length

  const openNotif = async (n) => {
    try {
      if (!n.read) await markNotificationRead(n.id)
      setNotifs((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      if (n.type === 'friend_request' || n.type === 'friend_accepted') navigate('/requests')
      else if (n.actor?.username) navigate(`/profile/${n.actor.username}`)
    } catch (e) { toast(errText(e), 'err') }
  }

  return (
    <aside className="rail">
      <div className="rail-panel panel cut">
        <div className="rail-head mono accent-text"><span className="pulse-dot" /> ONLINE NOW</div>
        {online.length === 0 ? (
          <div className="rail-empty mono dim">NO SIGNALS DETECTED</div>
        ) : online.map((f) => (
          <button key={f.id} className="rail-row" onClick={() => navigate(`/profile/${f.other.username}`)}>
            <Avatar profile={f.other} size="s" showDot />
            <span className="rail-row-text">
              <span className="rail-row-name">{f.other.display_name}</span>
              <span className="rail-row-sub mono">@{f.other.username}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="rail-panel panel cut">
        <div className="rail-head mono">RECENT ACTIVITY</div>
        {activity.length === 0 ? (
          <div className="rail-empty mono dim">THE AIRWAVES ARE QUIET</div>
        ) : activity.map((p) => (
          <button key={p.id} className="rail-row" onClick={() => navigate(`/profile/${p.author.username}`)}>
            <Avatar profile={p.author} size="xs" />
            <span className="rail-row-text">
              <span className="rail-row-name">{p.author.display_name}</span>
              <span className="rail-row-sub">{p.content ? (p.content.length > 44 ? p.content.slice(0, 44) + '…' : p.content) : 'shared an image'}</span>
            </span>
            <span className="mono dim rail-time">{timeAgo(p.created_at)}</span>
          </button>
        ))}
      </div>

      <div className="rail-panel panel cut">
        <div className="rail-head mono">
          TRANSMISSIONS {unread > 0 && <span className="badge">{unread}</span>}
          {unread > 0 && (
            <button className="linkish mono" onClick={async () => {
              try { await markAllNotificationsRead(); setNotifs((l) => l.map((n) => ({ ...n, read: true }))) }
              catch (e) { toast(errText(e), 'err') }
            }}>clear</button>
          )}
        </div>
        {visibleNotifs.length === 0 ? (
          <div className="rail-empty mono dim"><Bell size={14} /> NOTHING ON THE WIRE</div>
        ) : visibleNotifs.slice(0, 8).map((n) => {
          const meta = TYPE_META[n.type] || TYPE_META.post_like
          const Icon = meta.icon
          return (
            <button key={n.id} className={`rail-row ${n.read ? '' : 'unread'}`} onClick={() => openNotif(n)}>
              <span className="rail-ico"><Icon size={14} /></span>
              <span className="rail-row-text">
                <span className="rail-row-name">{n.actor?.display_name || 'UNKNOWN'} <span className="dim">{meta.label}</span></span>
              </span>
              <span className="mono dim rail-time">{timeAgo(n.created_at)}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
