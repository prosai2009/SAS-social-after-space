// Time + online-status helpers

export function timeAgo(iso) {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'NOW'
  if (s < 3600) return `${Math.floor(s / 60)}M`
  if (s < 86400) return `${Math.floor(s / 3600)}H`
  if (s < 604800) return `${Math.floor(s / 86400)}D`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function fullTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function joinedTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function clockTime() {
  return new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// Someone counts as online when seen in the last 90 seconds
export const ONLINE_WINDOW_MS = 90_000

export function isOnline(lastSeenIso) {
  if (!lastSeenIso) return false
  return Date.now() - new Date(lastSeenIso).getTime() < ONLINE_WINDOW_MS
}
