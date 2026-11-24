import { useRef, useState } from 'react'
import { Camera, Check } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { errText } from '../../lib/db'
import { uploadImage } from '../../lib/image'
import { supabase } from '../../lib/supabase'
import Avatar from './Avatar'
import { Spinner } from './Loading'

const ACCENTS = [
  { key: 'cyan', rgb: '0 240 255' },
  { key: 'purple', rgb: '178 107 255' },
  { key: 'green', rgb: '182 255 46' },
  { key: 'orange', rgb: '255 122 26' },
]

export default function ProfileEditForm({ onSaved }) {
  const { profile, updateMyProfile, userId } = useAuth()
  const { toast } = useToast()
  const [displayName, setDisplayName] = useState(profile?.display_name || '')
  const [bio, setBio] = useState(profile?.bio || '')
  const [status, setStatus] = useState(profile?.status || '')
  const [accent, setAccent] = useState(profile?.accent || 'cyan')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  const uploadAvatar = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadImage(supabase, 'avatars', file, userId)
      await updateMyProfile({ avatar_url: url })
      toast('AVATAR UPDATED', 'ok')
    } catch (err) {
      toast(errText(err), 'err')
    } finally {
      setUploading(false)
    }
  }

  const save = async (e) => {
    e?.preventDefault?.()
    if (busy) return
    if (!displayName.trim()) { toast('Display name cannot be empty', 'err'); return }
    setBusy(true)
    try {
      await updateMyProfile({
        display_name: displayName.trim().slice(0, 40),
        bio: bio.slice(0, 280),
        status: status.slice(0, 80),
        accent,
      })
      toast('IDENTITY UPDATED', 'ok')
      onSaved?.()
    } catch (err) {
      toast(errText(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="profile-edit" onSubmit={save}>
      <div className="avatar-edit">
        <Avatar profile={profile} size="xl" />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={uploadAvatar} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Spinner size={14} /> : <Camera size={14} />} CHANGE AVATAR
        </button>
      </div>

      <label className="field">
        <span className="mono">DISPLAY NAME</span>
        <input value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} />
      </label>

      <label className="field">
        <span className="mono">STATUS <span className="dim">{status.length}/80</span></span>
        <input value={status} maxLength={80} placeholder="What's your frequency?" onChange={(e) => setStatus(e.target.value)} />
      </label>

      <label className="field">
        <span className="mono">BIO <span className="dim">{bio.length}/280</span></span>
        <textarea value={bio} maxLength={280} rows={3} placeholder="Tell the universe who you are…" onChange={(e) => setBio(e.target.value)} />
      </label>

      <div className="field">
        <span className="mono">IDENTITY COLOUR</span>
        <div className="accent-picker">
          {ACCENTS.map((a) => (
            <button
              key={a.key}
              type="button"
              className={`accent-swatch acc-${a.key} ${accent === a.key ? 'active' : ''}`}
              style={{ '--swatch': `rgb(${a.rgb})` }}
              onClick={() => setAccent(a.key)}
              aria-label={`Accent ${a.key}`}
              aria-pressed={accent === a.key}
            >
              {accent === a.key && <Check size={14} />}
            </button>
          ))}
        </div>
      </div>

      <button className="btn" type="submit" disabled={busy}>
        {busy ? <Spinner size={14} /> : null} SAVE IDENTITY
      </button>
    </form>
  )
}
