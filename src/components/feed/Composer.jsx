import { useState } from 'react'
import { Globe, Users, Lock, Send } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { createPost, errText } from '../../lib/db'
import Avatar from '../ui/Avatar'
import { Spinner } from '../ui/Loading'

const VIS = [
  { key: 'public', label: 'PUBLIC', icon: Globe },
  { key: 'friends', label: 'FRIENDS', icon: Users },
  { key: 'close', label: 'CLOSE', icon: Lock },
]

export default function Composer({ onCreated }) {
  const { profile } = useAuth()
  const { toast } = useToast()
  const [content, setContent] = useState('')
  const [visibility, setVisibility] = useState(() => localStorage.getItem('sas_defaultvis') || 'public')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (busy || !content.trim()) return
    setBusy(true)
    try {
      const post = await createPost({ content: content.trim(), imageUrl: null, visibility })
      onCreated(post)
      setContent('')
      toast('SIGNAL TRANSMITTED', 'ok')
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="composer panel cut">
      <div className="composer-top">
        <Avatar profile={profile} size="m" />
        <textarea
          className="composer-input"
          placeholder="TRANSMIT A SIGNAL TO YOUR UNIVERSE…"
          value={content}
          maxLength={2000}
          rows={content.length > 80 ? 4 : 2}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>

      <div className="composer-bar">
        <div className="vis-picker" role="radiogroup" aria-label="Post visibility">
          {VIS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              className={`vis-opt vis-${key} ${visibility === key ? 'active' : ''}`}
              onClick={() => setVisibility(key)}
              aria-pressed={visibility === key}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        <div className="composer-actions">
          <span className="mono dim">{content.length}/2000</span>
          <button className="btn btn-sm" onClick={submit} disabled={busy || !content.trim()}>
            {busy ? <Spinner size={14} /> : <Send size={14} />} POST
          </button>
        </div>
      </div>
    </div>
  )
}
