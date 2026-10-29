import { useEffect, useState } from 'react'
import { api, money } from '../api.ts'

type Report = Awaited<ReturnType<typeof api.report>>

export default function Reports() {
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10))
  const [rep, setRep] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .report(day)
      .then(setRep)
      .catch((e) => setError(e.message))
  }, [day])

  const maxHour = Math.max(1, ...(rep?.hourly ?? []).map((h) => h.amount))
  const avg = rep && rep.orders > 0 ? Math.round(rep.revenue / rep.orders) : 0

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">GÜNLÜK PERFORMANS</p>
          <h1>Günlük Rapor</h1>
          <div className="sub">{rep?.orders ?? 0} adisyon · ortalama {money(avg)}</div>
        </div>
        <div className="head-actions">
          <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: 170 }} />
        </div>
      </div>

      {error && <div className="toast error" role="alert">{error}</div>}

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">Ciro</div>
          <div className="value accent">{money(rep?.revenue ?? 0)}</div>
        </div>
        <div className="kpi">
          <div className="label">Adisyon</div>
          <div className="value">{rep?.orders ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="label">Ortalama adisyon</div>
          <div className="value">{money(avg)}</div>
        </div>
        <div className="kpi">
          <div className="label">Nakit / Kart</div>
          <div className="value" style={{ fontSize: 19 }}>
            {(rep?.byMethod ?? []).map((m) => `${m.method === 'cash' ? 'N' : m.method === 'card' ? 'K' : 'D'}: ${money(m.amount)}`).join(' · ') || '—'}
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-head">
            <h3>Saatlik ciro</h3>
            <span className="pill">{(rep?.hourly ?? []).length} saat</span>
          </div>
          <div className="panel-body">
            {(rep?.hourly ?? []).length === 0 && <div className="kds-empty">Bu gün için satış yok</div>}
            {(rep?.hourly ?? []).map((h) => (
              <div className="bar-row" key={h.hour}>
                <span style={{ color: 'var(--muted)' }}>{String(h.hour).padStart(2, '0')}:00</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Math.max(3, (h.amount / maxHour) * 100)}%` }} />
                </div>
                <span className="bar-val">{money(h.amount)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>En çok satanlar</h3>
            <span className="pill">adet</span>
          </div>
          <div className="panel-body">
            {(rep?.topProducts ?? []).length === 0 && <div className="kds-empty">Veri yok</div>}
            {(rep?.topProducts ?? []).map((p, i) => (
              <div className="rank-row" key={p.name}>
                <span className="rank-no">{i + 1}</span>
                <span className="rank-name">{p.name}</span>
                <span className="rank-qty">{p.qty} adet</span>
                <span className="rank-rev">{money(p.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
