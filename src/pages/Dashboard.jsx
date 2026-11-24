import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Radio, Zap } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { fetchPosts, errText } from '../lib/db'
import { clockTime } from '../lib/time'
import Composer from '../components/feed/Composer'
import PostCard from '../components/feed/PostCard'
import Page from '../components/ui/Page'
import Empty from '../components/ui/Empty'
import { Loading } from '../components/ui/Loading'
import { useToast } from '../context/ToastContext'

export default function Dashboard() {
  const { profile } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [posts, setPosts] = useState(null)
  const [time, setTime] = useState(clockTime())

  useEffect(() => {
    const t = setInterval(() => setTime(clockTime()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let alive = true
    fetchPosts({ limit: 30 })
      .then((d) => alive && setPosts(d))
      .catch((e) => { if (alive) { setPosts([]); toast(errText(e), 'err') } })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = (id, fn) => setPosts((list) => list.map((p) => (p.id === id ? fn(p) : p)))
  const remove = (id) => setPosts((list) => list.filter((p) => p.id !== id))

  return (
    <Page>
      <header className="hero panel cut">
        <div className="hero-deco" aria-hidden="true">
          <span className="cross cross-a" />
          <span className="cross cross-b" />
          <span className="cross cross-c" />
        </div>
        <div className="sticker acc-cyan"><Radio size={12} /> LIVE FEED // {time}</div>
        <h1 className="hero-title">
          WELCOME BACK,<br /><span className="hero-name accent-text">{(profile?.display_name || 'RUNNER').toUpperCase()}</span>
        </h1>
        <p className="hero-sub mono dim">YOUR PEOPLE. YOUR SPACE. YOUR UNIVERSE.</p>
      </header>

      <Composer onCreated={(post) => setPosts((list) => [post, ...(list || [])])} />

      <div className="feed-head mono">
        <span className="accent-text"><Zap size={13} /> SHARED FEED</span>
        <button className="linkish mono" onClick={() => navigate('/close')}>visibility guide</button>
      </div>

      {posts === null ? (
        <Loading label="SYNCING FEED…" />
      ) : posts.length === 0 ? (
        <Empty
          icon="▚▚▚"
          title="THE FEED IS EMPTY"
          hint="Be the first to transmit a signal, or add friends to fill your universe."
        >
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/friends')}>FIND FRIENDS</button>
        </Empty>
      ) : (
        <div className="feed">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} onChange={update} onRemove={remove} />
          ))}
        </div>
      )}
    </Page>
  )
}
