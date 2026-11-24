import { NavLink } from 'react-router-dom'
import { Home, User, Users, MessageCircle, Settings as SettingsIcon } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useUnread } from '../../context/UnreadContext'

export default function MobileNav() {
  const { profile } = useAuth()
  const { total: unread } = useUnread()
  const items = [
    { to: '/', label: 'Home', icon: Home, end: true },
    { to: `/profile/${profile?.username || ''}`, label: 'You', icon: User },
    { to: '/friends', label: 'Crew', icon: Users },
    { to: '/messages', label: 'Chat', icon: MessageCircle, signal: true },
    { to: '/settings', label: 'Sys', icon: SettingsIcon },
  ]
  return (
    <nav className="mobile-nav" aria-label="Main navigation">
      {items.map(({ to, label, icon: Icon, end, signal }) => (
        <NavLink key={label} to={to} end={end}
          className={({ isActive }) => `mnav-item ${isActive ? 'active' : ''}`}>
          <span className="mnav-ico">
            <Icon size={19} />
            {signal && unread > 0 && (
              <span className="mnav-badge">{unread > 99 ? '99+' : unread}</span>
            )}
          </span>
          <span className="mono">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
