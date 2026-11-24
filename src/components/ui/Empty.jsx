export default function Empty({ icon = '▢▢▢', title, hint, children }) {
  return (
    <div className="empty-state panel">
      <div className="empty-icon mono">{icon}</div>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {children}
    </div>
  )
}
