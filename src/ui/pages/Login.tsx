import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, auth } from '../api.ts'

export default function Login({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)
  const navigate = useNavigate()

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
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand-mark">S</div>
        <h1>Soprano POS</h1>
        <p>Personel PIN kodunuzu girin</p>

        <div className={`pin-display${shake ? ' shake' : ''}`}>
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i} className={`pin-dot${i < pin.length ? ' on' : ''}`} />
          ))}
        </div>

        <div className="pin-pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
            <button key={k} className="pin-key" onClick={() => press(k)} disabled={busy}>
              {k}
            </button>
          ))}
          <button className="pin-key ghost" onClick={() => press('del')}>
            Sil
          </button>
          <button className="pin-key" onClick={() => press('0')}>
            0
          </button>
          <button className="pin-key ghost" onClick={() => press('ok')} disabled={pin.length < 4 || busy}>
            Giriş
          </button>
        </div>

        <div className="pin-err">{error || (busy ? 'Kontrol ediliyor…' : '')}</div>
      </div>
    </div>
  )
}
