import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

// Global unread-message total for the sidebar and mobile nav.
// Reads the same server-side count the conversation list uses, then keeps
// it fresh with realtime message events + a light 20s fallback poll.
const UnreadCtx = createContext({ total: 0, refresh: () => {} })

export function UnreadProvider({ children }) {
  const { userId } = useAuth()
  const [total, setTotal] = useState(0)
  const timer = useRef(null)

  const refresh = useCallback(async () => {
    if (!supabase || !userId) { setTotal(0); return }
    const { data, error } = await supabase.rpc('my_unread_counts')
    if (!error && data) {
      setTotal(data.reduce((sum, row) => sum + (Number(row.unread) || 0), 0))
    }
  }, [userId])

  useEffect(() => {
    if (!userId || !supabase) { setTotal(0); return }
    refresh()

    const schedule = () => {
      clearTimeout(timer.current)
      timer.current = setTimeout(refresh, 400)
    }
    const poll = setInterval(refresh, 20_000)
    window.addEventListener('sas-unread-refresh', refresh)
    window.addEventListener('focus', refresh)

    const channel = supabase
      .channel(`unread-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, schedule)
      .subscribe()

    return () => {
      clearInterval(poll)
      clearTimeout(timer.current)
      window.removeEventListener('sas-unread-refresh', refresh)
      window.removeEventListener('focus', refresh)
      supabase.removeChannel(channel)
    }
  }, [userId, refresh])

  return <UnreadCtx.Provider value={{ total, refresh }}>{children}</UnreadCtx.Provider>
}

export function useUnread() {
  return useContext(UnreadCtx)
}
