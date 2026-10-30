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
  const [moveOpen, setMoveOpen] = useState<{ orderId: number; tableId: number; tableName: string } | null>(null)
  const [moving, setMoving] = useState(false)
  const [takeawayOpen, setTakeawayOpen] = useState(false)
  const [takeawayForm, setTakeawayForm] = useState({ name: '', phone: '' })
  const [takeawayBusy, setTakeawayBusy] = useState(false)

  const floors = boot?.floors ?? []
  const active = floors.find((f) => f.id === floorId) ?? floors[0]

  const stats = useMemo(() => {
    const all = floors.flatMap((f) => f.tables)
    const busyTables = all.filter((t) => t.order)
    const takeawayTotal = (boot?.takeaway ?? []).reduce((s, o) => s + o.total, 0)
    return {
      total: all.length,
      busy: busyTables.length,
      open: busyTables.reduce((s, t) => s + (t.order?.total ?? 0), 0) + takeawayTotal,
      takeaway: boot?.takeaway?.length ?? 0,
    }
  }, [floors, boot?.takeaway])

  const openOrders = useMemo(() => {
    const fromTables = floors
      .flatMap((f) => f.tables.map((t) => ({ ...t, floor: f.name })))
      .filter((t) => t.order)
      .map((t) => ({
        key: `table-${t.id}`,
        orderId: t.order!.id,
        tableId: t.id as number | null,
        title: t.name,
        subtitle: `${t.floor} · ${t.order!.guest_count} kişi`,
        total: t.order!.total,
        sentLines: t.order!.sent_lines,
        openedAt: t.order!.opened_at,
        takeaway: false,
      }))
    const fromTakeaway = (boot?.takeaway ?? []).map((o) => ({
      key: `takeaway-${o.id}`,
      orderId: o.id,
      tableId: null as number | null,
      title: o.customer_name ? `Gel Al · ${o.customer_name}` : 'Gel Al',
      subtitle: o.customer_phone ? `Gel Al · ${o.customer_phone}` : 'Gel Al · paket',
      total: o.total,
      sentLines: o.sent_lines,
      openedAt: o.opened_at,
      takeaway: true,
    }))
    return [...fromTables, ...fromTakeaway].sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1))
  }, [floors, boot?.takeaway])

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

  const moveTo = async (tableId: number) => {
    if (!moveOpen || moving) return
    setMoving(true)
    try {
      await api.move(moveOpen.orderId, tableId)
      await refresh()
      setMoveOpen(null)
    } finally {
      setMoving(false)
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
          <button type="button" className="btn primary" onClick={() => setTakeawayOpen(true)}>
            + Gel Al
          </button>
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
              <div key={t.key} className={`open-row${t.takeaway ? ' is-takeaway' : ''}`}>
                <button className="open-row-main" onClick={() => navigate(`/order/${t.orderId}`)}>
                  <div>
                    <b>
                      {t.takeaway && <span className="takeaway-badge">GEL AL</span>}
                      {t.takeaway ? t.title.replace('Gel Al · ', '') : t.title}
                    </b>
                    <small>
                      {t.subtitle} · {elapsed(t.openedAt)}
                    </small>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="open-row-total">{money(t.total)}</div>
                    <small style={{ color: t.sentLines ? 'var(--ok)' : 'var(--accent-2)' }}>
                      {t.sentLines ? 'mutfakta' : 'gönderilmedi'}
                    </small>
                  </div>
                </button>
                {t.tableId && (
                  <button
                    type="button"
                    className="open-row-move"
                    aria-label={`${t.title} adisyonunu taşı`}
                    title="Adisyonu başka masaya taşı"
                    onClick={() => setMoveOpen({ orderId: t.orderId, tableId: t.tableId!, tableName: t.title })}
                  >
                    ↔
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="side-total">
            <span>Adisyon toplamı</span>
            <b>{money(stats.open)}</b>
          </div>
        </aside>
      </div>

      {takeawayOpen && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setTakeawayOpen(false)}>
          <div className="modal takeaway-modal" role="dialog" aria-modal="true" aria-label="Gel al siparişi aç">
            <p className="eyebrow">GEL AL</p>
            <h3>Paket / gel al siparişi</h3>
            <div className="sub">Müşteri adı zorunlu değil; fişte ve mutfak KOT'unda görünür.</div>
            <label className="field" style={{ marginTop: 14 }}>
              <span>Müşteri adı (opsiyonel)</span>
              <input
                className="input"
                value={takeawayForm.name}
                maxLength={60}
                autoFocus
                placeholder="Örn. Ahmet"
                onChange={(e) => setTakeawayForm({ ...takeawayForm, name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Telefon (opsiyonel)</span>
              <input
                className="input"
                value={takeawayForm.phone}
                maxLength={24}
                placeholder="05xx xxx xx xx"
                onChange={(e) => setTakeawayForm({ ...takeawayForm, phone: e.target.value })}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setTakeawayOpen(false)} disabled={takeawayBusy}>
                Vazgeç
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={takeawayBusy}
                onClick={async () => {
                  setTakeawayBusy(true)
                  try {
                    const res = await api.createTakeaway({
                      customerName: takeawayForm.name.trim() || undefined,
                      customerPhone: takeawayForm.phone.trim() || undefined,
                    })
                    await refresh()
                    setTakeawayOpen(false)
                    setTakeawayForm({ name: '', phone: '' })
                    navigate(`/order/${res.id}`)
                  } finally {
                    setTakeawayBusy(false)
                  }
                }}
              >
                {takeawayBusy ? 'Açılıyor…' : 'Siparişi aç'}
              </button>
            </div>
          </div>
        </div>
      )}

      {moveOpen && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setMoveOpen(null)}>
          <div className="modal table-move-modal" role="dialog" aria-modal="true" aria-label="Adisyonu masa taşı">
            <p className="eyebrow">MASA İŞLEMİ</p>
            <h3>{moveOpen.tableName} adisyonunu taşı</h3>
            <div className="sub">Boş bir masa seç</div>
            <div className="move-table-grid">
              {floors.flatMap((floor) =>
                floor.tables
                  .filter((table) => table.id !== moveOpen.tableId && !table.order)
                  .map((table) => (
                    <button type="button" className="move-table-choice" key={table.id} disabled={moving} onClick={() => void moveTo(table.id)}>
                      <b>{table.name}</b>
                      <small>{floor.name} · {table.seats} kişilik</small>
                    </button>
                  )),
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setMoveOpen(null)} disabled={moving}>Vazgeç</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
