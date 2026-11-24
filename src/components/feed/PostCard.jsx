import { useState } from 'react'
import { Globe, Users, Lock, Heart, MessageCircle, Trash2, ChevronDown } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { toggleLike, toggleReaction, deletePost, setPostVisibility, errText } from '../../lib/db'
import { timeAgo } from '../../lib/time'
import UserTag from '../ui/UserTag'
import Comments from './Comments'

const REACTIONS = ['🔥', '💜', '⚡', '😂']
const VIS_META = {
  public: { label: 'PUBLIC', icon: Globe, cls: 'vis-tag-public' },
  friends: { label: 'FRIENDS', icon: Users, cls: 'vis-tag-friends' },
  close: { label: 'CLOSE', icon: Lock, cls: 'vis-tag-close' },
}

export default function PostCard({ post, onChange, onRemove }) {
  const { profile, userId } = useAuth()
  const { toast } = useToast()
  const [showComments, setShowComments] = useState(false)
  const [editVis, setEditVis] = useState(false)
  const mine = post.author_id === userId
  const vis = VIS_META[post.visibility]

  const like = async () => {
    const liked = !post.liked
    onChange(post.id, (p) => ({ ...p, liked, likeCount: p.likeCount + (liked ? 1 : -1) }))
    try { await toggleLike(post.id, post.liked) } catch (e) {
      onChange(post.id, (p) => ({ ...p, liked: post.liked, likeCount: post.likeCount }))
      toast(errText(e), 'err')
    }
  }

  const react = async (emoji) => {
    const active = post.myReactions.has(emoji)
    onChange(post.id, (p) => {
      const my = new Set(p.myReactions)
      const counts = { ...p.reactionCounts }
      if (active) { my.delete(emoji); counts[emoji] = Math.max(0, (counts[emoji] || 1) - 1) }
      else { my.add(emoji); counts[emoji] = (counts[emoji] || 0) + 1 }
      return { ...p, myReactions: my, reactionCounts: counts }
    })
    try { await toggleReaction(post.id, emoji, active) } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const remove = async () => {
    if (!window.confirm('Delete this post forever?')) return
    try { await deletePost(post.id); onRemove(post.id); toast('POST DELETED', 'ok') }
    catch (e) { toast(errText(e), 'err') }
  }

  const changeVis = async (v) => {
    setEditVis(false)
    if (v === post.visibility) return
    const old = post.visibility
    onChange(post.id, (p) => ({ ...p, visibility: v }))
    try { await setPostVisibility(post.id, v); toast('VISIBILITY UPDATED', 'ok') }
    catch (e) { onChange(post.id, (p) => ({ ...p, visibility: old })); toast(errText(e), 'err') }
  }

  return (
    <article className={`post panel cut acc-${post.author?.accent || 'cyan'}`}>
      <div className="post-head">
        <UserTag profile={post.author} size="m" showDot />
        <div className="post-head-right">
          <span className="mono dim">{timeAgo(post.created_at)}</span>
          {mine ? (
            editVis ? (
              <span className="vis-edit">
                {Object.entries(VIS_META).map(([k, m]) => (
                  <button key={k} className={`vis-opt vis-${k} ${k === post.visibility ? 'active' : ''}`} onClick={() => changeVis(k)}>
                    <m.icon size={12} /> {m.label}
                  </button>
                ))}
                <button className="icon-btn" onClick={() => setEditVis(false)} aria-label="Cancel visibility change"><ChevronDown size={14} /></button>
              </span>
            ) : (
              <>
                <button className={`vis-tag ${vis.cls}`} onClick={() => setEditVis(true)} title="Change visibility">
                  <vis.icon size={12} /> {vis.label}
                </button>
                <button className="icon-btn" onClick={remove} title="Delete post" aria-label="Delete post"><Trash2 size={15} /></button>
              </>
            )
          ) : (
            <span className={`vis-tag ${vis.cls}`}><vis.icon size={12} /> {vis.label}</span>
          )}
        </div>
      </div>

      {post.content && <p className="post-content">{post.content}</p>}
      {post.image_url && (
        <img className="post-image" src={post.image_url} alt="" loading="lazy" />
      )}

      <div className="post-actions">
        <button className={`post-act ${post.liked ? 'liked' : ''}`} onClick={like}>
          <Heart size={16} fill={post.liked ? 'currentColor' : 'none'} />
          {post.likeCount > 0 && <span className="mono">{post.likeCount}</span>}
        </button>
        <button className="post-act" onClick={() => setShowComments((s) => !s)}>
          <MessageCircle size={16} />
          {post.commentCount > 0 && <span className="mono">{post.commentCount}</span>}
        </button>
        <div className="reaction-row">
          {REACTIONS.map((r) => (
            <button
              key={r}
              className={`react-btn ${post.myReactions.has(r) ? 'active' : ''}`}
              onClick={() => react(r)}
              aria-pressed={post.myReactions.has(r)}
              title={`React ${r}`}
            >
              {r}
              {post.reactionCounts[r] > 0 && <span className="mono">{post.reactionCounts[r]}</span>}
            </button>
          ))}
        </div>
      </div>

      {showComments && (
        <Comments
          postId={post.id}
          postAuthorId={post.author_id}
          onCount={(delta) => onChange(post.id, (p) => ({ ...p, commentCount: Math.max(0, p.commentCount + delta) }))}
        />
      )}
    </article>
  )
}
