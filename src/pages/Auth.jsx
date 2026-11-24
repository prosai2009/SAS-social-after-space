import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Eye, EyeOff, ArrowRight, ShieldAlert } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { isUsernameTaken, errText } from '../lib/db'
import { useToast } from '../context/ToastContext'
import { Spinner } from '../components/ui/Loading'

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

export default function Auth({ mode = 'login' }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [tab, setTab] = useState(mode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [usernameState, setUsernameState] = useState(null) // null | 'free' | 'taken' | 'invalid'
  const [showPass, setShowPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [awaitConfirm, setAwaitConfirm] = useState(false)

  const checkUsername = async (value) => {
    const v = value.toLowerCase()
    if (!USERNAME_RE.test(v)) { setUsernameState('invalid'); return }
    try {
      setUsernameState(await isUsernameTaken(v) ? 'taken' : 'free')
    } catch { setUsernameState(null) }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      if (tab === 'signup') {
        const uname = username.toLowerCase()
        if (!USERNAME_RE.test(uname)) throw new Error('Username: 3–20 chars, lowercase letters, numbers, underscores only')
        if (await isUsernameTaken(uname)) throw new Error('That username is already taken')
        if (password.length < 8) throw new Error('Password must be at least 8 characters')
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { username: uname, display_name: displayName.trim() || uname },
            emailRedirectTo: window.location.origin + '/',
          },
        })
        if (error) throw error
        if (!data.session) {
          setAwaitConfirm(true) // email confirmation is enabled on this project
        } else {
          navigate('/', { replace: true })
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) {
          if (error.message?.toLowerCase().includes('invalid login')) throw new Error('Wrong email or password')
          throw error
        }
        navigate('/', { replace: true })
      }
    } catch (err) {
      toast(errText(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  const sendReset = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin + '/reset',
      })
      if (error) throw error
      toast('RECOVERY LINK SENT — CHECK YOUR INBOX', 'ok')
      setForgot(false)
    } catch (err) {
      toast(errText(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-left">
        <div className="auth-logo glitch" data-text="SAS">SAS</div>
        <div className="auth-logo-sub mono">SOCIAL AFTER SPACE</div>
        <div className="barcode" aria-hidden="true" />
        <div className="auth-tags">
          <span className="sticker">YOUR PEOPLE</span>
          <span className="sticker sticker-b">YOUR SPACE</span>
          <span className="sticker">YOUR UNIVERSE</span>
        </div>
        <div className="auth-vertical mono dim" aria-hidden="true">UNDERGROUND NETWORK // EST. 2040</div>
      </div>

      <div className="auth-right">
        <div className="auth-panel panel cut">
          {awaitConfirm ? (
            <div className="auth-confirm">
              <ShieldAlert size={28} className="accent-text" />
              <h2 className="auth-title">CONFIRM YOUR SIGNAL</h2>
              <p className="dim">
                We beamed a confirmation link to <b>{email}</b>. Click it, then come back and jack in.
              </p>
              <button className="btn" onClick={() => setAwaitConfirm(false)}>BACK TO LOGIN</button>
            </div>
          ) : forgot ? (
            <form className="auth-form" onSubmit={sendReset}>
              <h2 className="auth-title">RECOVER ACCESS</h2>
              <p className="dim auth-sub">Enter your email and we will send a recovery link.</p>
              <label className="field">
                <span className="mono">EMAIL</span>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@thegrid.net" />
              </label>
              <button className="btn" type="submit" disabled={busy}>
                {busy ? <Spinner size={15} /> : null} SEND RECOVERY LINK
              </button>
              <button type="button" className="linkish mono" onClick={() => setForgot(false)}>← back to login</button>
            </form>
          ) : (
            <>
              <div className="auth-tabs mono">
                <button className={tab === 'login' ? 'active' : ''} onClick={() => setTab('login')}>LOGIN</button>
                <button className={tab === 'signup' ? 'active' : ''} onClick={() => setTab('signup')}>SIGN UP</button>
                <span className="auth-tabs-line" aria-hidden="true" />
              </div>

              <form className="auth-form" onSubmit={submit}>
                {tab === 'signup' && (
                  <>
                    <label className="field">
                      <span className="mono">USERNAME</span>
                      <div className="username-wrap">
                        <span className="mono dim">@</span>
                        <input
                          value={username}
                          required
                          autoComplete="off"
                          placeholder="lowercase_runner"
                          onChange={(e) => { setUsername(e.target.value.toLowerCase()); setUsernameState(null) }}
                          onBlur={() => username && checkUsername(username)}
                        />
                        {usernameState === 'free' && <span className="mono ustate ustate-ok">FREE ✓</span>}
                        {usernameState === 'taken' && <span className="mono ustate ustate-bad">TAKEN ✕</span>}
                        {usernameState === 'invalid' && <span className="mono ustate ustate-bad">INVALID</span>}
                      </div>
                    </label>
                    <label className="field">
                      <span className="mono">DISPLAY NAME</span>
                      <input value={displayName} required maxLength={40} placeholder="Neon Runner" onChange={(e) => setDisplayName(e.target.value)} />
                    </label>
                  </>
                )}

                <label className="field">
                  <span className="mono">EMAIL</span>
                  <input type="email" required value={email} autoComplete="email" placeholder="you@thegrid.net" onChange={(e) => setEmail(e.target.value)} />
                </label>

                <label className="field">
                  <span className="mono">PASSWORD</span>
                  <div className="password-wrap">
                    <input
                      type={showPass ? 'text' : 'password'}
                      required
                      value={password}
                      minLength={tab === 'signup' ? 8 : 0}
                      autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
                      placeholder="••••••••"
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button type="button" className="icon-btn" onClick={() => setShowPass((s) => !s)} aria-label="Toggle password visibility">
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </label>

                <button className="btn btn-lg" type="submit" disabled={busy}>
                  {busy ? <Spinner size={15} /> : null}
                  {tab === 'signup' ? 'CREATE NEW ID' : 'JACK IN'} <ArrowRight size={16} />
                </button>

                <div className="auth-links mono">
                  <button type="button" className="linkish" onClick={() => setForgot(true)}>FORGOT PASSWORD?</button>
                  {tab === 'login'
                    ? <Link to="/signup">CREATE NEW ID →</Link>
                    : <Link to="/login">ALREADY RUNNER? LOGIN →</Link>}
                </div>
              </form>
            </>
          )}
        </div>
        <div className="auth-footer mono dim">SAS V1.0 // A PRIVATE SOCIAL UNIVERSE</div>
      </div>
    </div>
  )
}
