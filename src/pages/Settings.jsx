import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Trash2, Palette, Bell, Shield, Ban, Search } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { searchUsers, blockUser, unblockUser, fetchBlocked, deleteMyAccount, errText } from '../lib/db'
import ProfileEditForm from '../components/ui/ProfileEditForm'
import Modal from '../components/ui/Modal'
import Avatar from '../components/ui/Avatar'
import Page from '../components/ui/Page'
import { Spinner } from '../components/ui/Loading'

const THEMES = [
  { key: 'cyan', label: 'ELECTRIC' },
  { key: 'purple', label: 'ULTRAVIOLET' },
  { key: 'green', label: 'ACID' },
  { key: 'orange', label: 'HEATWAVE' },
]
const NOTIF_TYPES = [
  { key: 'friend_request', label: 'Friend requests' },
  { key: 'friend_accepted', label: 'Accepted requests' },
  { key: 'post_like', label: 'Likes' },
  { key: 'post_comment', label: 'Comments' },
  { key: 'post_reaction', label: 'Reactions' },
]
const VIS_OPTIONS = [
  { key: 'public', label: 'PUBLIC' },
  { key: 'friends', label: 'FRIENDS' },
  { key: 'close', label: 'CLOSE' },
]

export default function Settings() {
  const { profile, signOut } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [theme, setTheme] = useState(() => localStorage.getItem('sas_theme') || 'cyan')
  const [motionOff, setMotionOff] = useState(() => localStorage.getItem('sas_motion') === 'off')
  const [prefs, setPrefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sas_notifprefs')) || {} } catch { return {} }
  })
  const [defVis, setDefVis] = useState(() => localStorage.getItem('sas_defaultvis') || 'public')
  const [blocked, setBlocked] = useState(null)
  const [search, setSearch] = useState('')
  const [found, setFound] = useState(null)
  const [searching, setSearching] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const loadBlocked = async () => {
    try { setBlocked(await fetchBlocked()) } catch (e) { toast(errText(e), 'err') }
  }
  useEffect(() => { loadBlocked() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // theme search (debounced)
  useEffect(() => {
    const q = search.trim()
    if (q.length < 2) { setFound(null); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try { setFound(await searchUsers(q)) } catch { setFound([]) } finally { setSearching(false) }
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  const applyTheme = (key) => {
    setTheme(key)
    localStorage.setItem('sas_theme', key)
    document.documentElement.dataset.accent = key
  }

  const applyMotion = (off) => {
    setMotionOff(off)
    localStorage.setItem('sas_motion', off ? 'off' : 'on')
    document.documentElement.dataset.motion = off ? 'off' : 'on'
  }

  const applyPref = (key, on) => {
    const next = { ...prefs, [key]: on }
    setPrefs(next)
    localStorage.setItem('sas_notifprefs', JSON.stringify(next))
  }

  const applyDefVis = (key) => {
    setDefVis(key)
    localStorage.setItem('sas_defaultvis', key)
  }

  const doBlock = async (u) => {
    try {
      await blockUser(u.id)
      toast(`BLOCKED @${u.username}`, 'ok')
      setSearch('')
      setFound(null)
      loadBlocked()
    } catch (e) { toast(errText(e), 'err') }
  }

  const doUnblock = async (b) => {
    try {
      await unblockUser(b.blocked_id)
      toast('UNBLOCKED', 'ok')
      loadBlocked()
    } catch (e) { toast(errText(e), 'err') }
  }

  const doLogout = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const doDelete = async () => {
    if (confirmText !== 'DELETE') return
    setDeleting(true)
    try {
      await deleteMyAccount()
      await signOut()
      navigate('/login', { replace: true })
    } catch (e) { toast(errText(e), 'err'); setDeleting(false) }
  }

  return (
    <Page>
      <div className="panel cut page-head">
        <h1 className="page-title">SETTINGS</h1>
        <p className="mono dim">SYSTEM CONTROL PANEL</p>
      </div>

      <section className="panel cut settings-section">
        <h2 className="section-title mono"><Palette size={14} /> IDENTITY</h2>
        {profile && <ProfileEditForm />}
      </section>

      <section className="panel cut settings-section">
        <h2 className="section-title mono"><Palette size={14} /> APPEARANCE</h2>
        <div className="field">
          <span className="mono">SYSTEM COLOUR</span>
          <div className="theme-row">
            {THEMES.map((t) => (
              <button key={t.key} className={`theme-chip acc-${t.key} ${theme === t.key ? 'active' : ''}`} onClick={() => applyTheme(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={motionOff} onChange={(e) => applyMotion(e.target.checked)} />
          <span>Reduce motion &amp; effects (better performance)</span>
        </label>
      </section>

      <section className="panel cut settings-section">
        <h2 className="section-title mono"><Bell size={14} /> ALERTS</h2>
        {NOTIF_TYPES.map((t) => (
          <label key={t.key} className="check-row">
            <input type="checkbox" checked={prefs[t.key] !== false} onChange={(e) => applyPref(t.key, e.target.checked)} />
            <span>{t.label}</span>
          </label>
        ))}
      </section>

      <section className="panel cut settings-section">
        <h2 className="section-title mono"><Shield size={14} /> PRIVACY</h2>
        <div className="field">
          <span className="mono">DEFAULT POST VISIBILITY</span>
          <div className="theme-row">
            {VIS_OPTIONS.map((v) => (
              <button key={v.key} className={`theme-chip ${defVis === v.key ? 'active' : ''}`} onClick={() => applyDefVis(v.key)}>
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="mono">BLOCK LIST</span>
          {blocked === null ? <Spinner size={15} /> : blocked.length === 0 ? (
            <p className="mono dim">NOBODY IS BLOCKED.</p>
          ) : (
            <div className="block-list">
              {blocked.map((b) => (
                <div key={b.blocked_id} className="block-row">
                  <Avatar profile={b.blocked} size="xs" />
                  <span className="mono">@{b.blocked?.username}</span>
                  <button className="btn btn-sm btn-ghost" onClick={() => doUnblock(b)}>UNBLOCK</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <label className="field search-field">
          <Ban size={15} className="dim" />
          <input className="search-input" placeholder="SEARCH A RUNNER TO BLOCK…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Search size={14} className="dim" />
        </label>
        {searching && <p className="mono dim">SCANNING…</p>}
        {found && found.length > 0 && (
          <div className="block-list">
            {found.map((u) => (
              <div key={u.id} className="block-row">
                <Avatar profile={u} size="xs" />
                <span className="mono">@{u.username} <span className="dim">{u.display_name}</span></span>
                <button className="btn btn-sm btn-danger" onClick={() => doBlock(u)}>BLOCK</button>
              </div>
            ))}
          </div>
        )}
        <p className="mono dim">Blocked runners cannot see restricted posts or message you — enforced server-side.</p>
      </section>

      <section className="panel cut settings-section danger-zone">
        <h2 className="section-title mono"><Trash2 size={14} /> DANGER ZONE</h2>
        <div className="danger-actions">
          <button className="btn btn-ghost" onClick={doLogout}><LogOut size={14} /> LOG OUT</button>
          <button className="btn btn-danger" onClick={() => setDeleteOpen(true)}><Trash2 size={14} /> DELETE ACCOUNT</button>
        </div>
      </section>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="DELETE ACCOUNT">
        <div className="delete-body">
          <p className="dim">
            This <b>permanently deletes</b> your account, profile, posts, comments, messages and
            friendships. There is no undo. Type <b>DELETE</b> to confirm.
          </p>
          <input className="delete-input mono" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
          <div className="danger-actions">
            <button className="btn btn-ghost" onClick={() => setDeleteOpen(false)}>CANCEL</button>
            <button className="btn btn-danger" disabled={confirmText !== 'DELETE' || deleting} onClick={doDelete}>
              {deleting ? <Spinner size={14} /> : <Trash2 size={14} />} DELETE FOREVER
            </button>
          </div>
        </div>
      </Modal>
    </Page>
  )
}
