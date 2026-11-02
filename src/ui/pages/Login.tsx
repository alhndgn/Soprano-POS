import { useEffect, useState } from 'react'
import TeqStudio from '../components/TeqStudio.tsx'
import { useNavigate } from 'react-router-dom'
import { api, auth } from '../api.ts'

export default function Login({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)
  const [ver, setVer] = useState<{ version: string; commit: string } | null>(null)

  useEffect(() => {
    api.version().then(setVer).catch(() => {})
  }, [])
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (busy) return
      if (/^[0-9]$/.test(event.key)) press(event.key)
      else if (event.key === 'Backspace' || event.key === 'Delete') press('del')
      else if (event.key === 'Enter' && pin.length >= 4) press('ok')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, pin])

  const submit = async (value: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await api.login(value)
      auth.set(res.token)
      onDone()
      navigate('/tables', { replace: true })
    } catch (e: any) {
      setError(e.message ?? 'Giriş yapılamadı')
      setShake(true)
      setTimeout(() => setShake(false), 420)
      setTimeout(() => setPin(''), 250)
    } finally {
      setBusy(false)
    }
  }

  const press = (key: string) => {
    if (key === 'del') return setPin((p) => p.slice(0, -1))
    if (key === 'ok') return void submit(pin)
    const next = (pin + key).slice(0, 6)
    setPin(next)
    if (next.length >= 4) {
      // 4 hane girildiğinde otomatik doğrula
      setTimeout(() => void submit(next), 120)
    }
  }

  return (
    <main className="login-wrap" aria-label="Soprano POS giriş">
      <div className="login-card">
        <div className="brand-mark" aria-hidden="true">S</div>
        <p className="login-kicker">SOPRANO / RESTAURANT OPERATIONS</p>
        <h1>Operasyona giriş</h1>
        <p>Personel PIN kodunuzu girin.</p>

        <div className={`pin-display${shake ? ' shake' : ''}`} aria-label={`${pin.length} hane girildi}`}>
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i} className={`pin-dot${i < pin.length ? ' on' : ''}`} aria-hidden="true" />
          ))}
        </div>

        <div className="pin-pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
            <button type="button" key={k} className="pin-key" aria-label={`${k} gir`} onClick={() => press(k)} disabled={busy}>
              {k}
            </button>
          ))}
          <button type="button" className="pin-key ghost" aria-label="Son haneyi sil" onClick={() => press('del')}>
            Sil
          </button>
          <button type="button" className="pin-key" aria-label="0 gir" onClick={() => press('0')}>
            0
          </button>
          <button type="button" className="pin-key ghost" aria-label="Giriş yap" onClick={() => press('ok')} disabled={pin.length < 4 || busy}>
            Giriş
          </button>
        </div>

        <div className="pin-err" role="alert" aria-live="polite">{error || (busy ? 'Kontrol ediliyor…' : '')}</div>
        <div className="login-footnote">
          Yerel ağ üzerinde güvenli oturum
          {ver && <span className="login-version">v{ver.version} · {ver.commit}</span>}
        </div>
        <TeqStudio />
      </div>
    </main>
  )
}
