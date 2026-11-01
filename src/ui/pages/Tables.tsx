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
  const { boot, refresh, me } = useApp()
  const navigate = useNavigate()
  const [floorId, setFloorId] = useState<number | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [moveOpen, setMoveOpen] = useState<{ orderId: number; tableId: number; tableName: string } | null>(null)
  const [moving, setMoving] = useState(false)
  const [guest, setGuest] = useState<{ tableId: number; tableName: string } | null>(null)
  const [guests, setGuests] = useState(2)
  const [opening, setOpening] = useState(false)

  const tableDetail = boot?.prefs?.tableDetail !== false
  const floors = boot?.floors ?? []
  const active = floors.find((f) => f.id === floorId) ?? floors[0]

  const stats = useMemo(() => {
    const all = floors.flatMap((f) => f.tables)
    const busyTables = all.filter((t) => t.order)
    const tableOpen = busyTables.reduce((s, t) => s + (t.order?.total ?? 0), 0)
    return { total: all.length, busy: busyTables.length, tableOpen }
  }, [floors])

  const tableOrders = useMemo(
    () =>
      floors
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
        }))
        .sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1)),
    [floors],
  )

  const openTable = (tableId: number, tableName: string, existingOrderId?: number) => {
    if (existingOrderId) return navigate(`/order/${existingOrderId}`)
    setGuests(2)
    setGuest({ tableId, tableName })
  }

  const confirmGuest = async () => {
    if (!guest || opening) return
    setOpening(true)
    setBusy(guest.tableId)
    try {
      const res = await api.createOrder(guest.tableId, guests)
      await refresh()
      const id = res.id
      setGuest(null)
      navigate(`/order/${id}`)
    } finally {
      setOpening(false)
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

  /** Basit modda hızlı masa ekleme. */
  const addTable = async () => {
    if (!active) return
    try {
      await api.addTable({ floorId: active.id, name: `Masa ${active.tables.length + 1}`, seats: 4, shape: 'square' })
      await refresh()
    } catch {
      /* yönetici değilse yoksay */
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="head-actions">
          <div className="head-stat"><span>Dolu masa</span><b>{stats.busy}<small>/{stats.total}</small></b></div>
          <div className="head-stat"><span>Açık adisyon</span><b>{money(stats.tableOpen)}</b></div>
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
        {!tableDetail && me?.role === 'manager' && (
          <button type="button" className="floor-tab add-table" onClick={() => void addTable()}>
            + Masa ekle
          </button>
        )}
      </div>

      <div className={`tables-layout${tableDetail ? '' : ' simple'}`}>
        <div className="plan-wrap">
          {tableDetail ? (
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
                    onClick={() => openTable(t.id, t.name, o?.id)}
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
          ) : (
            <div className="table-grid">
              {(active?.tables ?? []).map((t) => {
                const o = t.order
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`table-tile${o ? ' busy' : ''}${busy === t.id ? ' loading' : ''}`}
                    disabled={busy === t.id}
                    onClick={() => openTable(t.id, t.name, o?.id)}
                  >
                    <b>{t.name}</b>
                    {o ? (
                      <>
                        <span className="table-tile-total">{money(o.total)}</span>
                        <small>{o.guest_count} kişi · {elapsed(o.opened_at)}</small>
                      </>
                    ) : (
                      <small>{t.seats} kişilik · boş</small>
                    )}
                  </button>
                )
              })}
              {(active?.tables ?? []).length === 0 && (
                <div className="plan-empty">
                  Masa yok.
                  <br />
                  <span style={{ fontSize: 11.5 }}>Yukarıdaki “+ Masa ekle” ile başla.</span>
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="side-panel panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">CANLI SERVİS</p>
              <h3>Açık adisyonlar</h3>
            </div>
            <span className="pill">{tableOrders.length}</span>
          </div>
          <div className="side-list">
            {tableOrders.length === 0 && <div className="kds-empty">Açık adisyon yok</div>}
            {tableOrders.map((t) => (
              <div key={t.key} className="open-row">
                <button className="open-row-main" onClick={() => navigate(`/order/${t.orderId}`)}>
                  <div>
                    <b>{t.title}</b>
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
            <b>{money(stats.tableOpen)}</b>
          </div>
        </aside>
      </div>

      {guest && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setGuest(null)}>
          <div className="modal guest-modal" role="dialog" aria-modal="true" aria-label="Kaç kişi">
            <p className="panel-kicker">{guest.tableName}</p>
            <h3>Kaç kişi?</h3>
            <div className="guest-stepper">
              <button type="button" aria-label="Azalt" onClick={() => setGuests((n) => Math.max(1, n - 1))}>−</button>
              <input
                className="guest-input"
                type="number"
                min={1}
                max={30}
                value={guests}
                autoFocus
                onChange={(e) => setGuests(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void confirmGuest()
                }}
              />
              <button type="button" aria-label="Arttır" onClick={() => setGuests((n) => Math.min(30, n + 1))}>+</button>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setGuest(null)} disabled={opening}>Vazgeç</button>
              <button type="button" className="btn primary" onClick={() => void confirmGuest()} disabled={opening}>
                {opening ? 'Açılıyor…' : 'İleri'}
              </button>
            </div>
          </div>
        </div>
      )}

      {moveOpen && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setMoveOpen(null)}>
          <div className="modal table-move-modal" role="dialog" aria-modal="true" aria-label="Adisyonu masa taşı">
            <h3>{moveOpen.tableName} adisyonunu taşı</h3>
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
