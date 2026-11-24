import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  // undefined = still loading, null = signed out, object = session
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [lastEvent, setLastEvent] = useState(null)
  const heartbeatRef = useRef(null)

  useEffect(() => {
    if (!supabase) { setSession(null); return }
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      setLastEvent(event)
    })
    return () => subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id || null

  const loadProfile = useCallback(async (id) => {
    if (!id || !supabase) return
    // small retry: the signup trigger can lag a moment behind first session
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
      if (data) { setProfile(data); return }
      await new Promise((r) => setTimeout(r, 1200))
    }
  }, [])

  useEffect(() => {
    if (userId) {
      loadProfile(userId)
      // presence heartbeat: keeps last_seen fresh for online indicators
      const beat = () => {
        if (document.visibilityState === 'visible' && supabase) {
          supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', userId)
        }
      }
      beat()
      heartbeatRef.current = setInterval(beat, 40_000)
      document.addEventListener('visibilitychange', beat)
      return () => {
        clearInterval(heartbeatRef.current)
        document.removeEventListener('visibilitychange', beat)
      }
    }
    setProfile(null)
  }, [userId, loadProfile])

  const updateMyProfile = useCallback(async (patch) => {
    if (!userId) throw new Error('Not signed in')
    const { data, error } = await supabase
      .from('profiles').update(patch).eq('id', userId).select('*').single()
    if (error) throw error
    setProfile(data)
    return data
  }, [userId])

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut()
    setProfile(null)
  }, [])

  return (
    <AuthCtx.Provider value={{ session, userId, profile, lastEvent, updateMyProfile, loadProfile, signOut }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  return useContext(AuthCtx)
}
