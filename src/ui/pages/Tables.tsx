import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../App.tsx'
import { api, elapsed, money, type Table } from '../api.ts'

const CANVAS_W = 1000
const CANVAS_H = 600

/** Konum hiç verilmemişse (0,0) ızgara yerleşimine düş. */
function positionOf(t: Table, index: number) {
  if (t.x !== 0 || t.y !== 0) return { x: t.x, y: t.y, w: t.w, h: t.h }
  const col = index % 3
  const row = Math.floor(index / 3)
  return { x: 70 + col * 300, y: 60 + row * 185, w: 120, h: 110 }
}

export default function Tables() {
  const { boot, refresh } = useApp()
  const navigate = useNavigate()
  const [floorId, setFloorId] = useState<number | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const floors = boot?.floors ?? []
  const active = floors.find((f) => f.id === floorId) ?? floors[0]

  const stats = useMemo(() => {
    const all = floors.flatMap((f) => f.tables)
    const busyTables = all.filter((t) => t.order)
    return {
      total: all.length,
      busy: busyTables.length,
      open: busyTables.reduce((s, t) => s + (t.order?.total ?? 0), 0),
    }
  }, [floors])

  const openOrders = useMemo(
    () =>
      floors
        .flatMap((f) => f.tables.map((t) => ({ ...t, floor: f.name })))
        .filter((t) => t.order)
        .sort((a, b) => (a.order!.opened_at < b.order!.opened_at ? -1 : 1)),
    [floors],
  )

  const openTable = async (tableId: number, existingOrderId?: number) => {
    if (existingOrderId) return navigate(`/order/${existingOrderId}`)
    setBusy(tableId)
    try {
      const res = await api.createOrder(tableId)
      await refresh()
      navigate(`/order/${res.id}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">SALON DURUMU</p>
          <h1>Masalar</h1>
          <div className="sub">Salon durumunu tek bakışta takip et, masaya dokunarak adisyonu aç.</div>
        </div>
        <div className="head-actions">
          <div className="head-stat"><span>Dolu masa</span><b>{stats.busy}<small>/{stats.total}</small></b></div>
          <div className="head-stat"><span>Açık adisyon</span><b>{money(stats.open)}</b></div>
          {boot?.shift ? (
            <span className="pill ok live">Vardiya açık · {elapsed(boot.shift.opened_at)}</span>
          ) : (
            <span className="pill bad">Vardiya kapalı</span>
          )}
        </div>
      </div>

      <div className="floors">
        {floors.map((f) => (
          <button key={f.id} className={`floor-tab${f.id === active?.id ? ' on' : ''}`} onClick={() => setFloorId(f.id)}>
            {f.name}
            <span style={{ color: 'var(--dim)', marginLeft: 7, fontSize: 11 }}>
              {f.tables.filter((t) => t.order).length}/{f.tables.length}
            </span>
          </button>
        ))}
      </div>

      <div className="tables-layout">
        <div className="plan-wrap">
          <div className="plan-canvas pos-plan" role="region" aria-label={`${active?.name ?? 'Salon'} masa planı`}>
            <div className="plan-grid" />
            {(active?.tables ?? []).map((t, i) => {
              const p = positionOf(t, i)
              const o = t.order
              const cls = [
                'plan-table',
                'pos',
                t.shape === 'round' ? 'round' : t.shape === 'rect' ? 'rect' : 'square',
                o ? 'busy' : 'free',
                o && o.sent_lines > 0 ? 'sent' : '',
                busy === t.id ? 'loading' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <button
                  key={t.id}
                  className={cls}
                  style={{
                    left: `${(p.x / CANVAS_W) * 100}%`,
                    top: `${(p.y / CANVAS_H) * 100}%`,
                    width: `${(p.w / CANVAS_W) * 100}%`,
                    height: `${(p.h / CANVAS_H) * 100}%`,
                  }}
                  disabled={busy === t.id}
                  aria-label={`${t.name}${o ? `, ${money(o.total)} açık adisyon` : `, ${t.seats} kişilik boş masa`}`}
                  onClick={() => void openTable(t.id, o?.id)}
                >
                  <b>{t.name}</b>
                  {o ? (
                    <>
                      <span className="plan-total">{money(o.total)}</span>
                      <span className="plan-meta">
                        {o.line_count} ürün · {elapsed(o.opened_at)}
                      </span>
                    </>
                  ) : (
                    <span className="plan-meta">{t.seats} kişilik</span>
                  )}
                </button>
              )
            })}
            {(active?.tables ?? []).length === 0 && (
              <div className="plan-empty">
                Bu bölmede masa yok.
                <br />
                <span style={{ fontSize: 11.5 }}>Yönetim → Masa Düzeni’nden ekleyebilirsin.</span>
              </div>
            )}
          </div>
          <div className="plan-hint">
            <span>{active?.name} · {active?.tables.length ?? 0} masa · plan görünümü</span>
            <span className="plan-legend" aria-label="Masa durumları">
              <span><i className="legend-dot free" /> boş</span>
              <span><i className="legend-dot busy" /> açık</span>
              <span><i className="legend-dot sent" /> mutfakta</span>
            </span>
          </div>
        </div>

        <aside className="side-panel panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">CANLI SERVİS</p>
              <h3>Açık adisyonlar</h3>
            </div>
            <span className="pill">{openOrders.length}</span>
          </div>
          <div className="side-list">
            {openOrders.length === 0 && <div className="kds-empty">Açık adisyon yok</div>}
            {openOrders.map((t) => (
              <button key={t.id} className="open-row" onClick={() => navigate(`/order/${t.order!.id}`)}>
                <div className="open-row-main">
                  <b>{t.name}</b>
                  <small>
                    {t.floor} · {t.order!.guest_count} kişi · {elapsed(t.order!.opened_at)}
                  </small>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="open-row-total">{money(t.order!.total)}</div>
                  <small style={{ color: t.order!.sent_lines ? 'var(--ok)' : 'var(--accent-2)' }}>
                    {t.order!.sent_lines ? 'mutfakta' : 'gönderilmedi'}
                  </small>
                </div>
              </button>
            ))}
          </div>
          <div className="side-total">
            <span>Adisyon toplamı</span>
            <b>{money(stats.open)}</b>
          </div>
        </aside>
      </div>
    </div>
  )
}
