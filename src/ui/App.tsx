import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api, auth, type Bootstrap, type Me } from './api.ts'
import TeqStudio from './components/TeqStudio.tsx'
import Login from './pages/Login.tsx'
import Tables from './pages/Tables.tsx'
import OrderPage from './pages/Order.tsx'
import Kds from './pages/Kds.tsx'
import Reports from './pages/Reports.tsx'
import Admin from './pages/Admin.tsx'
import Shift from './pages/Shift.tsx'
import Takeaway from './pages/Takeaway.tsx'
import Accounts from './pages/Accounts.tsx'

type Ctx = {
  boot: Bootstrap | null
  me: Me | null
  refresh: () => Promise<void>
  loading: boolean
  error: string | null
  theme: 'light' | 'dark'
  setTheme: (t: 'light' | 'dark') => void
}

const AppCtx = createContext<Ctx>({
  boot: null,
  me: null,
  refresh: async () => {},
  loading: true,
  error: null,
  theme: 'light',
  setTheme: () => {},
})
export const useApp = () => useContext(AppCtx)

function Icon({ d }: { d: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

const NAV = [
  { to: '/tables', label: 'Masalar', icon: 'M4 6h16M4 12h16M4 18h16' },
  { to: '/kds', label: 'Mutfak', icon: 'M4 10h16M6 10V6h12v4M7 10v10M17 10v10' },
  { to: '/takeaway', label: 'Gel Al', icon: 'M6 8h12l-1 12H7L6 8zm3 0a3 3 0 016 0' },
  { to: '/accounts', label: 'Cari', icon: 'M4 7h16v11H4zM4 7l8-3 8 3M8 12h3' },
  { to: '/reports', label: 'Rapor', icon: 'M4 19V5m0 14h16M8 15v-4m4 4V8m4 7v-6' },
  { to: '/admin', label: 'Yönetim', icon: 'M12 4l2.1 4.3 4.7.7-3.4 3.3.8 4.7L12 15l-4.2 2 .8-4.7L5.2 9l4.7-.7L12 4z' },
]

type Theme = 'light' | 'dark'
const THEME_KEY = 'soprano_theme'

function initialTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'dark' || saved === 'light') return saved
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

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
    const es = new EventSource(`/api/events?token=${encodeURIComponent(auth.get() ?? '')}`)
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
  const value = useMemo(
    () => ({ boot, me, refresh, loading, error, theme, setTheme }),
    [boot, me, refresh, loading, error, theme],
  )

  const isLogin = location.pathname === '/login'
  if (!auth.get() && !isLogin) return <Navigate to="/login" replace />
  if (isLogin) return <Login onDone={() => void refresh()} />
  if (loading && !boot) return <div className="boot">Yükleniyor…</div>

  const role = me?.role
  const allowed = (to: string) => {
    if (role === 'manager') return true
    if (to === '/tables' || to === '/kds' || to === '/takeaway' || to === '/accounts') return true
    if (to === '/shift') return role === 'cashier'
    return role === 'cashier' && to === '/reports'
  }

  return (
    <AppCtx.Provider value={value}>
      <a className="skip-link" href="#main-content">Ana içeriğe geç</a>
      <div className="shell">
        <aside className="sidebar" aria-label="Ana navigasyon">
          <div className="sidebar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">S</span>
            <div className="brand-copy">
              <b>Soprano</b>
              <small>RESTORAN POS</small>
            </div>
          </div>
          <div className="sidebar-context">
            <span className={`status-dot${boot?.shift ? ' on' : ''}`} aria-hidden="true" />
            <div>
              <b>{boot?.shift ? 'Vardiya açık' : 'Vardiya kapalı'}</b>
              <small>{boot?.shift ? 'Operasyon devam ediyor' : 'İşleme başlamadan açın'}</small>
            </div>
          </div>
          <nav aria-label="Bölümler">
            {NAV.filter(
              (n) =>
                allowed(n.to) &&
                (n.to !== '/accounts' || boot?.prefs?.featureCari !== false) &&
                (n.to !== '/takeaway' || boot?.prefs?.featureGelAl !== false),
            ).map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <Icon d={n.icon} />
                <span className="nav-label">{n.label}</span>
              </NavLink>
            ))}
            {allowed('/shift') && (
              <NavLink to="/shift" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <Icon d="M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z" />
                <span className="nav-label">Vardiya</span>
              </NavLink>
            )}
          </nav>
          <div className="sidebar-foot">
            <div className="who">
              <div className="who-copy">
                <b>{me?.name}</b>
                <small>{me?.role === 'manager' ? 'Yönetici' : me?.role === 'cashier' ? 'Kasiyer' : 'Garson'}</small>
              </div>
            </div>
            {/* Tema seçimi Yönetim → Ayarlar'da; menüde yer kaplamasın. */}
            <button
              type="button"
              className="btn ghost sm"
              aria-label="Oturumu kapat"
              onClick={async () => {
                await api.logout().catch(() => {})
                auth.clear()
                navigate('/login', { replace: true })
              }}
            >
              Çıkış
            </button>
            <TeqStudio />
          </div>
          </div>
        </aside>

        <main className="main" id="main-content" tabIndex={-1}>
          {error && <div className="toast error" role="alert">{error}</div>}
          <div className="route-stage" key={location.pathname}>
          <Routes>
            <Route path="/tables" element={<Tables />} />
            <Route
              path="/takeaway"
              element={boot?.prefs?.featureGelAl === false ? <Navigate to="/tables" replace /> : <Takeaway />}
            />
            <Route path="/order/:id" element={<OrderPage />} />
            <Route path="/kds" element={<Kds />} />
            <Route
              path="/accounts"
              element={boot?.prefs?.featureCari === false ? <Navigate to="/tables" replace /> : <Accounts />}
            />
            <Route path="/reports" element={<Reports />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/shift" element={<Shift />} />
            <Route path="*" element={<Navigate to="/tables" replace />} />
          </Routes>
          </div>
        </main>
      </div>
    </AppCtx.Provider>
  )
}
