import { useState } from 'react'
import { useApp } from '../App.tsx'
import { api, elapsed, money } from '../api.ts'

export default function Shift() {
  const { boot, refresh } = useApp()
  const [openingFloat, setOpeningFloat] = useState('500')
  const [closingCount, setClosingCount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const shift = boot?.shift ?? null
  const cash = (boot?.floors ?? []).flatMap((f) => f.tables).reduce((s, t) => s + (t.order?.total ?? 0), 0)

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await refresh()
      setError(null)
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">CASH CONTROL</p>
          <h1>Vardiya & Kasa</h1>
          <div className="sub">{shift ? `Açık · ${elapsed(shift.opened_at)}` : 'Kapalı'}</div>
        </div>
        {shift ? <span className="pill ok live">açık</span> : <span className="pill bad">kapalı</span>}
      </div>

      {error && <div className="toast error" role="alert">{error}</div>}

      <div className="shift-grid">
        <div className="panel">
          <div className="panel-head">
            <h3>Açık adisyonlar</h3>
          </div>
          <div className="panel-body">
            <div className="totals-total">
              <span>Masadaki toplam</span>
              <b>{money(cash)}</b>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>
              Vardiya kapatmadan önce tüm adisyonlar ödenmiş olmalı.
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>{shift ? 'Vardiya kapat' : 'Vardiya aç'}</h3>
          </div>
          <div className="panel-body">
            {shift ? (
              <>
                <div className="field">
                  <label>Kasadaki nakit (₺)</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder="Örn: 2450.00"
                    value={closingCount}
                    onChange={(e) => setClosingCount(e.target.value)}
                  />
                </div>
                <button
                  className="btn danger block"
                  disabled={!closingCount}
                  onClick={() => void run(() => api.closeShift(Math.round(Number(closingCount.replace(',', '.')) * 100)))}
                >
                  Vardiyayı Kapat
                </button>
              </>
            ) : (
              <>
                <div className="field">
                  <label>Açılış kasadaki para (₺)</label>
                  <input className="input" inputMode="decimal" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} />
                </div>
                <button
                  className="btn primary block"
                  onClick={() => void run(() => api.openShift(Math.round(Number(openingFloat.replace(',', '.')) * 100) || 0))}
                >
                  Vardiya Aç
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
