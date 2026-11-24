import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  Home, User, Users, UserPlus, Heart, MessageCircle, Settings as SettingsIcon,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useUnread } from '../../context/UnreadContext'
import { supabase } from '../../lib/supabase'
import MusicToggle from '../ui/MusicToggle'
import Avatar from '../ui/Avatar'

export default function Sidebar() {
  const { profile } = useAuth()
  const { total: unreadMessages } = useUnread()
  const location = useLocation()
  const [requests, setRequests] = useState(0)

  useEffect(() => {
    let alive = true
    const load = async () => {
      if (!supabase) return
      const me = (await supabase.auth.getSession()).data.session?.user?.id
      if (!me) return
      const { count } = await supabase
        .from('friendships')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('addressee_id', me)
      if (alive && count != null) setRequests(count)
    }
    load()
    const t = setInterval(load, 30_000)
    return () => { alive = false; clearInterval(t) }
  }, [location.pathname])

  const isProfile = location.pathname.startsWith('/profile') && profile
  const items = [
    { to: '/', label: 'Home', icon: Home, end: true },
    { to: `/profile/${profile?.username || ''}`, label: 'My Profile', icon: User, active: isProfile },
    { to: '/friends', label: 'Friends', icon: Users },
    { to: '/requests', label: 'Requests', icon: UserPlus, badge: requests },
    { to: '/close', label: 'Close Friends', icon: Heart },
    { to: '/messages', label: 'Messages', icon: MessageCircle, badge: unreadMessages, signal: true },
    { to: '/settings', label: 'Settings', icon: SettingsIcon },
  ]

  return (
    <aside className="sidebar">
      <div className="sidebar-edge mono dim" aria-hidden="true">SOCIAL AFTER SPACE // 2040</div>

      <div className="logo-block">
        <div className="logo-mark">SAS</div>
        <div className="logo-sub mono">SOCIAL AFTER SPACE</div>
        <div className="barcode" aria-hidden="true" />
      </div>

      <nav className="side-nav">
        {items.map(({ to, label, icon: Icon, end, badge, active, signal }) => (
          <NavLink
            key={label}
            to={to}
            end={end}
            className={({ isActive }) => `nav-item ${active || isActive ? 'active' : ''}`}
          >
            <Icon size={17} />
            <span>{label}</span>
            {badge > 0 && (
              <span className={`badge ${signal ? 'badge-signal' : ''}`}>
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-foot">
        <MusicToggle />
        {profile && (
          <NavLink to={`/profile/${profile.username}`} className="user-chip">
            <Avatar profile={profile} size="s" showDot />
            <span className="user-chip-text">
              <span className="user-chip-name">{profile.display_name}</span>
              <span className="user-chip-handle mono">@{profile.username}</span>
            </span>
          </NavLink>
        )}
      </div>
    </aside>
  )
}
