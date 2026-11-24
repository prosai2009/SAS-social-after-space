import { useEffect, useRef, useState } from 'react'
import { Music } from 'lucide-react'

// Built-in city theme — "phonk relaxing loop" by alexzavesa (Pixabay license,
// free for commercial use, no attribution required).
//
// Behaviour:
// - ON by default (a saved OFF choice is remembered).
// - Starts automatically after login; if the browser blocks autoplay it
//   starts on the very first click/keypress instead.
// - Fades out slowly when the tab/window loses focus (alt-tab, another site)
//   and fades back in when you return.
// - The button is the only sound control: no second sound system.
const VOLUME = 0.45

export default function MusicToggle() {
  const audioRef = useRef(null)
  const fadeRef = useRef(null)
  const onRef = useRef(false)
  const [on, setOn] = useState(() => localStorage.getItem('sas_music') !== 'off')

  useEffect(() => { onRef.current = on }, [on])

  // Smooth volume ramp. Uses elapsed time, so it still finishes correctly if
  // the browser throttles timers in a background tab.
  const fadeTo = (target, ms, done) => {
    const a = audioRef.current
    if (!a) return
    if (fadeRef.current) clearInterval(fadeRef.current)
    const from = a.volume
    const started = Date.now()
    fadeRef.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - started) / ms)
      a.volume = Math.max(0, Math.min(1, from + (target - from) * p))
      if (p >= 1) {
        clearInterval(fadeRef.current)
        fadeRef.current = null
        if (done) done()
      }
    }, 40)
  }

  // One shared audio element for the whole session.
  useEffect(() => {
    const a = new Audio('/city-theme.mp3')
    a.loop = true
    a.volume = 0
    a.preload = 'auto'
    audioRef.current = a
    return () => {
      if (fadeRef.current) clearInterval(fadeRef.current)
      a.pause()
      audioRef.current = null
    }
  }, [])

  // ON: play + fade in (retrying on the first gesture if autoplay is blocked).
  // OFF: fade out then pause.
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    if (!on) {
      if (!a.paused) fadeTo(0, 500, () => a.pause())
      return
    }

    let cancelled = false
    let armed = false

    const disarm = () => {
      window.removeEventListener('pointerdown', retry)
      window.removeEventListener('keydown', retry)
      window.removeEventListener('touchstart', retry)
      armed = false
    }

    const arm = () => {
      if (armed || cancelled) return
      armed = true
      window.addEventListener('pointerdown', retry)
      window.addEventListener('keydown', retry)
      window.addEventListener('touchstart', retry)
    }

    const start = () => {
      if (cancelled || document.visibilityState === 'hidden') return
      a.volume = 0
      const p = a.play()
      if (p && typeof p.then === 'function') {
        p.then(() => { if (!cancelled) fadeTo(VOLUME, 900) }).catch(arm)
      } else {
        fadeTo(VOLUME, 900)
      }
    }

    const retry = () => {
      disarm()
      start()
    }

    start()
    return () => {
      cancelled = true
      disarm()
    }
  }, [on])

  // Fade away when leaving the tab/window, fade back on return.
  useEffect(() => {
    const a = audioRef.current
    if (!a) return

    const leave = () => {
      if (!onRef.current || a.paused) return
      fadeTo(0, 1400, () => a.pause())
    }

    const back = () => {
      if (!onRef.current || document.visibilityState === 'hidden') return
      if (!a.paused) {
        // still playing (or mid fade-out) — just bring the volume back up
        if (a.volume < VOLUME) fadeTo(VOLUME, 800)
        return
      }
      a.volume = 0
      a.play().then(() => fadeTo(VOLUME, 1400)).catch(() => {})
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') leave()
      else back()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', leave)
    window.addEventListener('focus', back)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', leave)
      window.removeEventListener('focus', back)
    }
  }, [])

  const toggle = () => {
    setOn((prev) => {
      const next = !prev
      localStorage.setItem('sas_music', next ? 'on' : 'off')
      return next
    })
  }

  return (
    <button
      className={`sound-toggle music-toggle ${on ? 'is-on' : ''}`}
      onClick={toggle}
      title="Theme: alexzavesa — Pixabay"
      aria-pressed={on}
    >
      <Music size={13} />
      <span>MUSIC: {on ? 'ON' : 'OFF'}</span>
    </button>
  )
}
