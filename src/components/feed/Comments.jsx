import { useEffect, useState } from 'react'
import { Send, Trash2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { fetchComments, addComment, deleteComment, errText } from '../../lib/db'
import { timeAgo } from '../../lib/time'
import Avatar from '../ui/Avatar'
import { Spinner } from '../ui/Loading'

export default function Comments({ postId, postAuthorId, onCount }) {
  const { userId, profile } = useAuth()
  const { toast } = useToast()
  const [list, setList] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetchComments(postId)
      .then((d) => alive && setList(d))
      .catch((e) => { alive && setList([]); toast(errText(e), 'err') })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId])

  const submit = async (e) => {
    e.preventDefault()
    const content = text.trim()
    if (!content || busy) return
    setBusy(true)
    try {
      const c = await addComment(postId, content, postAuthorId)
      setList((l) => [...(l || []), c])
      setText('')
      onCount(1)
    } catch (err) {
      toast(errText(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id) => {
    try {
      await deleteComment(id)
      setList((l) => l.filter((c) => c.id !== id))
      onCount(-1)
    } catch (e) { toast(errText(e), 'err') }
  }

  return (
    <div className="comments">
      {list === null ? (
        <div className="comments-loading"><Spinner size={15} /></div>
      ) : list.map((c) => (
        <div key={c.id} className="comment">
          <Avatar profile={c.author} size="xs" />
          <div className="comment-body">
            <div className="comment-meta mono">
              <span className="comment-name">{c.author?.display_name || 'GHOST'}</span>
              <span className="dim">{timeAgo(c.created_at)}</span>
              {c.author_id === userId && (
                <button className="icon-btn" onClick={() => remove(c.id)} title="Delete comment" aria-label="Delete comment">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            <div className="comment-text">{c.content}</div>
          </div>
        </div>
      ))}
      {list !== null && list.length === 0 && <div className="mono dim comments-empty">NO REPLIES YET — BREAK THE SILENCE</div>}
      <form className="comment-form" onSubmit={submit}>
        <Avatar profile={profile} size="xs" />
        <input
          className="comment-input"
          placeholder="REPLY…"
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="icon-btn" type="submit" disabled={busy || !text.trim()} aria-label="Send reply">
          <Send size={15} />
        </button>
      </form>
    </div>
  )
}
