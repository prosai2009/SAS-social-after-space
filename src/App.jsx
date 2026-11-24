import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { isConfigured } from './lib/supabase'
import { ToastProvider } from './context/ToastContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import SetupScreen from './components/SetupScreen'
import Intro from './components/intro/Intro'
import AppLayout from './components/layout/AppLayout'
import { BootScreen } from './components/ui/Loading'
import Auth from './pages/Auth'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import Friends from './pages/Friends'
import Requests from './pages/Requests'
import CloseFriends from './pages/CloseFriends'
import Messages from './pages/Messages'
import Settings from './pages/Settings'

const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'

// Watches /version.json, which is regenerated on every `npm run build`.
// When a new deploy is live, the open tab reloads itself — no more
// Ctrl+Shift+R after every update.
function VersionGuard() {
  useEffect(() => {
    let reloading = false

    const check = async () => {
      if (reloading || document.visibilityState === 'hidden') return
      try {
        const res = await fetch('/version.json', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (!data?.v || data.v === BUILD_ID) return

        // never yank the page away mid-sentence
        const el = document.activeElement
        const typing = el && (
          el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
        )
        if (typing) return

        // guard against a reload loop while a fresh deploy propagates
        const lastReload = Number(sessionStorage.getItem('sas_version_reload') || 0)
        if (Date.now() - lastReload < 15_000) return
        sessionStorage.setItem('sas_version_reload', String(Date.now()))

        reloading = true
        window.location.reload()
      } catch { /* offline or local dev — ignore */ }
    }

    const interval = setInterval(check, 30_000)
    const first = setTimeout(check, 3_000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(interval)
      clearTimeout(first)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])

  return null
}

function RequireAuth() {
  const { session } = useAuth()
  if (session === undefined) return <BootScreen />
  if (session === null) return <Navigate to="/login" replace />
  return <Outlet />
}

function LoginGate({ mode = 'login' }) {
  const { session } = useAuth()
  if (session === undefined) return <BootScreen />
  if (session) return <Navigate to="/" replace />
  return <Auth mode={mode} />
}

function IntroGate() {
  const [done, setDone] = useState(() => sessionStorage.getItem('sas_intro') === '1')
  if (done) return null
  return (
    <AnimatePresence>
      <Intro
        key="intro"
        onDone={() => {
          sessionStorage.setItem('sas_intro', '1')
          setDone(true)
        }}
      />
    </AnimatePresence>
  )
}

export default function App() {
  if (!isConfigured) {
    return (
      <ToastProvider>
        <SetupScreen />
      </ToastProvider>
    )
  }

  return (
    <ToastProvider>
      <AuthProvider>
        <VersionGuard />
        <IntroGate />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginGate />} />
            <Route path="/signup" element={<LoginGate mode="signup" />} />
            <Route path="/reset" element={<ResetPassword />} />

            <Route element={<RequireAuth />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/profile/:username" element={<Profile />} />
                <Route path="/friends" element={<Friends />} />
                <Route path="/requests" element={<Requests />} />
                <Route path="/close" element={<CloseFriends />} />
                <Route path="/messages" element={<Messages />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  )
}
