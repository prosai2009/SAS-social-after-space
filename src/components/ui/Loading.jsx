import { Loader2 } from 'lucide-react'

export function Spinner({ size = 18 }) {
  return <Loader2 className="spinner" size={size} strokeWidth={2.4} aria-label="Loading" />
}

export function Loading({ label = 'LOADING SPACE…' }) {
  return (
    <div className="loading-block">
      <Spinner size={22} />
      <span className="mono dim">{label}</span>
    </div>
  )
}

export function BootScreen() {
  return (
    <div className="boot-screen">
      <div className="boot-logo">SAS</div>
      <div className="mono dim boot-line">ESTABLISHING UPLINK…</div>
      <div className="boot-bar"><span /></div>
    </div>
  )
}
