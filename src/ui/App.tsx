import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api, auth, type Bootstrap, type Me } from './api.ts'
import Login from './pages/Login.tsx'
import Tables from './pages/Tables.tsx'
import OrderPage from './pages/Order.tsx'
import Kds from './pages/Kds.tsx'
import Reports from './pages/Reports.tsx'
import Admin from './pages/Admin.tsx'
import Shift from './pages/Shift.tsx'

type Ctx = {
  boot: Bootstrap | null
  me: Me | null
  refresh: () => Promise<void>
  loading: boolean
  error: string | null
}

const AppCtx = createContext<Ctx>({ boot: null, me: null, refresh: async () => {}, loading: true, error: null })
export const useApp = () => useContext(AppCtx)

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

const NAV = [
  { to: '/tables', label: 'Masalar', icon: 'M4 6h16M4 12h16M4 18h16' },
  { to: '/kds', label: 'Mutfak', icon: 'M4 10h16M6 10V6h12v4M7 10v10M17 10v10' },
  { to: '/reports', label: 'Rapor', icon: 'M4 19V5m0 14h16M8 15v-4m4 4V8m4 7v-6' },
  { to: '/admin', label: 'Yönetim', icon: 'M12 4l2.1 4.3 4.7.7-3.4 3.3.8 4.7L12 15l-4.2 2 .8-4.7L5.2 9l4.7-.7L12 4z' },
]

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()

  const refresh = useCallback(async () => {
    if (!auth.get()) {
      setBoot(null)
      setLoading(false)
      return
    }
    try {
      const data = await api.bootstrap()
      setBoot(data)
      setError(null)
    } catch (e: any) {
      if (e.status === 401) {
        auth.clear()
        setBoot(null)
        navigate('/login', { replace: true })
      } else setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [navigate])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // canlı güncelleme: SSE + 15 sn yedek
  useEffect(() => {
    if (!auth.get()) return
    const es = new EventSource(`/api/events?token=${auth.get()}`)
    const onChange = () => void refresh()
    es.addEventListener('change', onChange)
    es.addEventListener('kds', onChange)
    es.addEventListener('kot', onChange)
    es.addEventListener('paid', onChange)
    const timer = setInterval(() => void refresh(), 15000)
    return () => {
      es.close()
      clearInterval(timer)
    }
  }, [refresh])

  const me = boot?.me ?? null
  const value = useMemo(() => ({ boot, me, refresh, loading, error }), [boot, me, refresh, loading, error])

  const isLogin = location.pathname === '/login'
  if (!auth.get() && !isLogin) return <Navigate to="/login" replace />
  if (isLogin) return <Login onDone={() => void refresh()} />
  if (loading && !boot) return <div className="boot">Yükleniyor…</div>

  const role = me?.role
  const allowed = (to: string) =>
    role === 'manager' ? true : to === '/tables' || to === '/kds' ? true : role === 'cashier' ? to !== '/admin' : false

  return (
    <AppCtx.Provider value={value}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">S</span>
            <div>
              <b>Soprano</b>
              <small>POS</small>
            </div>
          </div>
          <nav>
            {NAV.filter((n) => allowed(n.to)).map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <Icon d={n.icon} />
                <span>{n.label}</span>
              </NavLink>
            ))}
            <NavLink to="/shift" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Icon d="M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z" />
              <span>Vardiya</span>
            </NavLink>
          </nav>
          <div className="sidebar-foot">
            <div className="who">
              <span className="avatar">{me?.name?.[0]}</span>
              <div>
                <b>{me?.name}</b>
                <small>{me?.role === 'manager' ? 'Yönetici' : me?.role === 'cashier' ? 'Kasiyer' : 'Garson'}</small>
              </div>
            </div>
            <button
              className="btn ghost sm"
              onClick={async () => {
                await api.logout().catch(() => {})
                auth.clear()
                navigate('/login', { replace: true })
              }}
            >
              Çıkış
            </button>
          </div>
        </aside>

        <main className="main">
          {error && <div className="toast error">{error}</div>}
          <Routes>
            <Route path="/tables" element={<Tables />} />
            <Route path="/order/:id" element={<OrderPage />} />
            <Route path="/kds" element={<Kds />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/shift" element={<Shift />} />
            <Route path="*" element={<Navigate to="/tables" replace />} />
          </Routes>
        </main>
      </div>
    </AppCtx.Provider>
  )
}
