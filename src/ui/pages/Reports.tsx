import { useEffect, useMemo, useState } from 'react'
import { api, money } from '../api.ts'
import { reportCustomerName, reportPaymentLabel } from '../report.ts'

type RangeReport = Awaited<ReturnType<typeof api.reportRange>>

const iso = (d: Date) => d.toISOString().slice(0, 10)

function shift(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return iso(d)
}

const PRESETS: { label: string; from: () => string; to: () => string }[] = [
  { label: 'Bugün', from: () => shift(0), to: () => shift(0) },
  { label: 'Dün', from: () => shift(-1), to: () => shift(-1) },
  { label: 'Son 7 gün', from: () => shift(-6), to: () => shift(0) },
  { label: 'Bu ay', from: () => iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: () => shift(0) },
]

export default function Reports() {
  const [from, setFrom] = useState(shift(0))
  const [to, setTo] = useState(shift(0))
  const [rep, setRep] = useState<RangeReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    api
      .reportRange(from, to)
      .then(setRep)
      .catch((e) => setError(e.message))
  }, [from, to])

  const maxCat = Math.max(1, ...(rep?.byCategory ?? []).map((c) => c.revenue))
  const cash = rep?.byMethod.find((m) => m.method === 'cash')?.amount ?? 0
  const card = rep?.byMethod.find((m) => m.method === 'card')?.amount ?? 0
  const dine = rep?.byType.find((t) => t.order_type === 'dine_in')
  const take = rep?.byType.find((t) => t.order_type === 'takeaway')

  const rangeLabel = useMemo(() => {
    if (from === to) return from.split('-').reverse().join('.')
    return `${from.split('-').reverse().join('.')} – ${to.split('-').reverse().join('.')}`
  }, [from, to])

  return (
    <div className="page">
      <div className="page-head">
        <div className="head-actions report-filters">
          <div className="segmented" role="group" aria-label="Hızlı tarih aralığı">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className={from === p.from() && to === p.to() ? 'on' : ''}
                onClick={() => {
                  setFrom(p.from())
                  setTo(p.to())
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="range-inputs">
            <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <span>–</span>
            <input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <span className="pill">{rangeLabel}</span>
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
          <div className="label">Günlük ortalama</div>
          <div className="value" style={{ fontSize: 19 }}>
            {money(rep?.avgPerDay ?? 0)}
            <small className="kpi-sub">{rep?.days ?? 1} gün</small>
          </div>
        </div>
        <div className="kpi">
          <div className="label">Ortalama adisyon</div>
          <div className="value" style={{ fontSize: 19 }}>{money(rep?.avgTicket ?? 0)}</div>
        </div>
        <div className="kpi">
          <div className="label">Masada</div>
          <div className="value" style={{ fontSize: 19 }}>
            {money(dine?.revenue ?? 0)}
            <small className="kpi-sub">{dine?.orders ?? 0} adisyon</small>
          </div>
        </div>
        <div className="kpi">
          <div className="label">Gel Al</div>
          <div className="value" style={{ fontSize: 19 }}>
            {money(take?.revenue ?? 0)}
            <small className="kpi-sub">{take?.orders ?? 0} sipariş</small>
          </div>
        </div>
        <div className="kpi">
          <div className="label">İskonto</div>
          <div className="value" style={{ fontSize: 19 }}>{money(rep?.discountTotal ?? 0)}</div>
        </div>
        <div className="kpi">
          <div className="label">Nakit / Kart</div>
          <div className="value" style={{ fontSize: 17 }}>
            {money(cash)} <small className="kpi-sub">nakit</small>
            {money(card)} <small className="kpi-sub">kart</small>
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-head">
            <h3>Kategori bazlı satış</h3>
            <span className="pill">{(rep?.byCategory ?? []).length} kategori</span>
          </div>
          <div className="panel-body">
            {(rep?.byCategory ?? []).length === 0 && <div className="kds-empty">Bu aralıkta satış yok</div>}
            {(rep?.byCategory ?? []).map((c) => (
              <div className="bar-row" key={c.id}>
                <span style={{ color: 'var(--muted)', minWidth: 92 }}>{c.name}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Math.max(3, (c.revenue / maxCat) * 100)}%` }} />
                </div>
                <span className="bar-val">{money(c.revenue)}</span>
                <span className="bar-qty">{c.qty}</span>
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

      <div className="report-tables">
        <div className="panel report-table-panel">
          <div className="panel-head">
            <div>
              <h3>Ödenen adisyonlar</h3>
            </div>
            <span className="pill">{(rep?.paidOrders ?? []).length} adisyon</span>
          </div>
          <div className="report-table-scroll">
            {(rep?.paidOrders ?? []).length === 0 ? (
              <div className="kds-empty">Bu aralıkta ödenmiş adisyon yok</div>
            ) : (
              <table className="data-table report-table">
                <thead><tr><th>Adisyon</th><th>Müşteri</th><th>Ödeme</th><th>İskonto</th><th>Net</th></tr></thead>
                <tbody>
                  {(rep?.paidOrders ?? []).map((row) => (
                    <tr key={row.order_id}>
                      <td>
                        <b>#{row.order_id}</b>
                        <small>
                          {row.order_type === 'takeaway'
                            ? `Gel Al${row.customer_name ? ` · ${row.customer_name}` : ''}`
                            : row.table_name ?? 'Paket'}
                        </small>
                      </td>
                      <td>{reportCustomerName(row.customer_name)}</td>
                      <td>{reportPaymentLabel(row.payment_methods)}</td>
                      <td>{row.discount_amount ? money(row.discount_amount) : '—'}</td>
                      <td><b>{money(row.total)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="panel report-table-panel void-report-panel">
          <div className="panel-head">
            <div>
              <h3>İptal edilen adisyonlar</h3>
            </div>
            <span className="pill danger-pill">{(rep?.voidedOrders ?? []).length} iptal</span>
          </div>
          <div className="report-table-scroll">
            {(rep?.voidedOrders ?? []).length === 0 ? (
              <div className="kds-empty">Bu aralıkta iptal yok</div>
            ) : (
              <table className="data-table report-table">
                <thead><tr><th>Adisyon</th><th>Müşteri</th><th>Neden / personel</th><th>Tutar</th></tr></thead>
                <tbody>
                  {(rep?.voidedOrders ?? []).map((row) => (
                    <tr key={row.order_id}>
                      <td>
                        <b>#{row.order_id}</b>
                        <small>{row.order_type === 'takeaway' ? 'Gel Al' : row.table_name ?? 'Paket'}</small>
                      </td>
                      <td>{reportCustomerName(row.customer_name)}</td>
                      <td><b>{row.reason}</b><small>{row.voided_by ?? '—'}</small></td>
                      <td><b>{money(row.total)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
