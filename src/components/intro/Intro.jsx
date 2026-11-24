import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'

// INTRODUCTION EXPERIENCE
// - dark screen, animated SAS logo, "WELCOME TO ANOTHER SPACE"
// - auto-advances if the user waits; never replays on navigation
//   (guarded by sessionStorage in App.jsx)
export default function Intro({ onDone }) {
  const [leaving, setLeaving] = useState(false)

  const leave = () => {
    if (leaving) return
    setLeaving(true)
    onDone()
  }

  useEffect(() => {
    const t = setTimeout(leave, 5600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <motion.div
      className="intro"
      exit={{ opacity: 0, clipPath: 'inset(0 0 100% 0)' }}
      transition={{ duration: 0.8, ease: [0.7, 0, 0.2, 1] }}
    >
      <div className="intro-grid" />
      <div className="intro-glow intro-glow-cyan" />
      <div className="intro-glow intro-glow-purple" />

      {/* rotating dashed rings */}
      <svg className="intro-ring ring-a" viewBox="0 0 400 400" aria-hidden="true">
        <circle cx="200" cy="200" r="188" fill="none" stroke="rgba(0,240,255,.35)" strokeWidth="1" strokeDasharray="4 14" />
      </svg>
      <svg className="intro-ring ring-b" viewBox="0 0 400 400" aria-hidden="true">
        <circle cx="200" cy="200" r="150" fill="none" stroke="rgba(178,107,255,.4)" strokeWidth="1" strokeDasharray="40 22" />
      </svg>

      <div className="intro-center">
        <motion.div
          className="intro-logo glitch"
          data-text="SAS"
          initial={{ opacity: 0, scale: 0.82, filter: 'blur(14px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          transition={{ duration: 1.1, ease: [0.22, 0.9, 0.3, 1] }}
        >
          SAS
        </motion.div>

        <motion.div
          className="intro-full mono"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.8 }}
        >
          SOCIAL&nbsp;AFTER&nbsp;SPACE
        </motion.div>

        <motion.div
          className="intro-scanline"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.7, duration: 0.9, ease: 'easeOut' }}
        />

        <motion.h2
          className="intro-welcome"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9, duration: 0.8 }}
        >
          WELCOME TO <span className="accent-text">ANOTHER</span> SPACE
        </motion.h2>

        <motion.div
          className="intro-tagline mono dim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.3, duration: 0.8 }}
        >
          YOUR PEOPLE. YOUR SPACE. YOUR UNIVERSE.
        </motion.div>

        <motion.div
          className="intro-actions"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.7, duration: 0.7 }}
        >
          <button className="btn btn-lg" onClick={leave} autoFocus>
            ENTER THE SPACE <ChevronRight size={17} />
          </button>
          <div className="intro-alt mono">
            <button type="button" className="linkish" onClick={leave}>skip intro</button>
          </div>
        </motion.div>
      </div>

      <div className="intro-corner mono dim">SYS.2040 // NODE: SOL-3</div>
      <div className="intro-corner-b mono dim">V1.0 — SIGNAL LOCKED</div>
    </motion.div>
  )
}
