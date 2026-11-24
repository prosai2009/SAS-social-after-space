import { useNavigate } from 'react-router-dom'
import Avatar from './Avatar'
import { isOnline } from '../../lib/time'

export default function UserTag({ profile, size = 's', showDot = false, showUsername = true, link = true, onClick }) {
  const navigate = useNavigate()
  if (!profile) {
    return <span className="usertag"><span className="dim mono">[ GHOST USER ]</span></span>
  }
  const handle = (e) => {
    if (!link) return
    e?.stopPropagation?.()
    navigate(`/profile/${profile.username}`)
  }
  return (
    <button
      className={`usertag ${link ? 'is-link' : ''}`}
      onClick={onClick || handle}
      type="button"
    >
      <Avatar profile={profile} size={size} showDot={showDot} />
      <span className="usertag-text">
        <span className="usertag-name">{profile.display_name}</span>
        {showUsername && <span className="usertag-handle mono">@{profile.username}</span>}
      </span>
      {showDot && isOnline(profile.last_seen) && <span className="mono online-label accent-text">ONLINE</span>}
    </button>
  )
}
