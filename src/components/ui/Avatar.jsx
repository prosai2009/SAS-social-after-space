import { isOnline } from '../../lib/time'

// Cut-corner identity avatar with accent frame + optional presence dot.
export default function Avatar({ profile, size = 'm', showDot = false, className = '' }) {
  const accent = profile?.accent || 'cyan'
  const name = profile?.display_name || profile?.username || '?'
  return (
    <div className={`avatar size-${size} acc-${accent} ${className}`} aria-hidden="true">
      <div className="avatar-frame" />
      {profile?.avatar_url ? (
        <img className="avatar-img" src={profile.avatar_url} alt={name} loading="lazy" />
      ) : (
        <div className="avatar-img avatar-fallback">{name.slice(0, 1).toUpperCase()}</div>
      )}
      {showDot && (
        <span className={`dot ${isOnline(profile?.last_seen) ? 'on' : ''}`} title={isOnline(profile?.last_seen) ? 'Online' : 'Offline'} />
      )}
    </div>
  )
}
