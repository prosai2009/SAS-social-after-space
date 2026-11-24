import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { errText } from '../lib/db'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { BootScreen } from '../components/ui/Loading'

// Password recovery: Supabase emails a link to /reset, the URL exchange
// grants a session, and this page sets the new password.
export default function ResetPassword() {
  const { session } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  if (session === undefined) return <BootScreen />
  if (session === null) return <Navigate to="/login" replace />

  const submit = async (e) => {
    e.preventDefault()
    if (password.length < 8) { toast('Password must be at least 8 characters', 'err'); return }
    if (password !== confirm) { toast('Passwords do not match', 'err'); return }
    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      toast('PASSWORD UPDATED — WELCOME BACK', 'ok')
      navigate('/', { replace: true })
    } catch (err) {
      toast(errText(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-right auth-right-center">
        <div className="auth-panel panel cut">
          <h2 className="auth-title">SET NEW PASSWORD</h2>
          <form className="auth-form" onSubmit={submit}>
            <label className="field">
              <span className="mono">NEW PASSWORD</span>
              <input type="password" required value={password} minLength={8} placeholder="••••••••" onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label className="field">
              <span className="mono">CONFIRM PASSWORD</span>
              <input type="password" required value={confirm} placeholder="••••••••" onChange={(e) => setConfirm(e.target.value)} />
            </label>
            <button className="btn" type="submit" disabled={busy}>UPDATE PASSWORD</button>
          </form>
        </div>
      </div>
    </div>
  )
}
