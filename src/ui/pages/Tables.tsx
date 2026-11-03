import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../App.tsx'
import { api, elapsed, money, type Table } from '../api.ts'
import VoidOrderModal from '../components/VoidOrderModal.tsx'

const CANVAS_W = 1000
const CANVAS_H = 600

/** Konum hiç verilmemişse (0,0) ızgara yerleşimine düş. */
function positionOf(t: Table, index: number) {
  if (t.x !== 0 || t.y !== 0) return { x: t.x, y: t.y, w: t.w, h: t.h }
  const col = index % 3
  const row = Math.floor(index / 3)
  return { x: 70 + col * 300, y: 60 + row * 185, w: 120, h: 110 }
}

type MenuTarget = { tableId: number; tableName: string; orderId: number; total: number }
type PickTarget = { tableId: number; orderId: number; mode: 'merge' | 'transfer' }

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

  const [menuFor, setMenuFor] = useState<MenuTarget | null>(null)
  const [voidFor, setVoidFor] = useState<number | null>(null)
  const [pickFor, setPickFor] = useState<PickTarget | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const notify = (kind: 'ok' | 'err', text: string) => {
    setNotice({ kind, text })
    window.setTimeout(() => setNotice(null), 2600)
  }

  const tableSections = boot?.prefs?.tableSections !== false
  const tableDetail = boot?.prefs?.tableDetail !== false
  // Bölümler kapalıysa tüm masalar tek listede, plan/şekil yok.
  const simpleMode = !tableDetail || !tableSections
  const floors = boot?.floors ?? []
  const active = floors.find((f) => f.id === floorId) ?? floors[0]
  const allTables = useMemo(() => floors.flatMap((f) => f.tables), [floors])
  const shownTables = tableSections ? active?.tables ?? [] : allTables

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
      notify('ok', 'Masa değiştirildi')
    } catch (e: any) {
      notify('err', e.message)
    } finally {
      setMoving(false)
    }
  }

  const quickPay = async (target: MenuTarget) => {
    if (!window.confirm(`${target.tableName} · ${money(target.total)} nakit olarak tahsil edilsin mi?`)) return
    setActionBusy(true)
    try {
      await api.pay(target.orderId, [{ method: 'cash', amount: target.total }])
      await refresh()
      setMenuFor(null)
      notify('ok', `${target.tableName} ödemesi alındı`)
    } catch (e: any) {
      notify('err', e.message)
    } finally {
      setActionBusy(false)
    }
  }

  const printBill = async (target: MenuTarget) => {
    setActionBusy(true)
    try {
      await api.printOrder(target.orderId)
      setMenuFor(null)
      notify('ok', 'Ön hesap fişi kuyruğa girdi')
    } catch (e: any) {
      notify('err', e.message)
    } finally {
      setActionBusy(false)
    }
  }

  const pickTarget = async (table: Table) => {
    if (!pickFor) return
    setActionBusy(true)
    try {
      if (pickFor.mode === 'merge' || table.order) {
        await api.mergeOrders(pickFor.orderId, table.order?.id ?? 0)
        notify('ok', `${table.name} ile birleştirildi`)
      } else {
        await api.move(pickFor.orderId, table.id)
        notify('ok', `${table.name} masasına aktarıldı`)
      }
      await refresh()
      setPickFor(null)
    } catch (e: any) {
      notify('err', e.message)
    } finally {
      setActionBusy(false)
    }
  }

  const openAddTable = () => {
    const targetFloor = tableSections ? active : floors[0]
    setAddName(`Masa ${(targetFloor?.tables.length ?? 0) + 1}`)
    setAddOpen(true)
  }

  const submitAddTable = async () => {
    const targetFloor = tableSections ? active : floors[0]
    if (!targetFloor || actionBusy) return
    setActionBusy(true)
    try {
      await api.addTable({
        floorId: targetFloor.id,
        name: addName.trim() || `Masa ${targetFloor.tables.length + 1}`,
        seats: 4,
        shape: 'square',
      })
      await refresh()
      setAddOpen(false)
      notify('ok', 'Masa eklendi')
    } catch (e: any) {
      notify('err', e.message)
    } finally {
      setActionBusy(false)
    }
  }

  const menuButton = (t: Table, orderId: number, total: number, name: string) => (
    <button
      type="button"
      className="table-menu-trigger"
      aria-label={`${name} masa işlemleri`}
      title="Masa işlemleri"
      onClick={(e) => {
        e.stopPropagation()
        setMenuFor({ tableId: t.id, tableName: name, orderId, total })
      }}
    >
      ⋯
    </button>
  )

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

      {tableSections && (
        <div className="floors">
          {floors.map((f) => (
            <button key={f.id} className={`floor-tab${f.id === active?.id ? ' on' : ''}`} onClick={() => setFloorId(f.id)}>
              {f.name}
              <span style={{ color: 'var(--dim)', marginLeft: 7, fontSize: 11 }}>
                {f.tables.filter((t) => t.order).length}/{f.tables.length}
              </span>
            </button>
          ))}
          {me?.role === 'manager' && (
            <button type="button" className="floor-tab add-table" onClick={openAddTable}>
              + Masa ekle
            </button>
          )}
        </div>
      )}

      {!tableSections && me?.role === 'manager' && (
        <div className="floors">
          <button type="button" className="floor-tab add-table" onClick={openAddTable}>
            + Masa ekle
          </button>
        </div>
      )}

      <div className={`tables-layout${simpleMode ? ' simple' : ''}`}>
        <div className="plan-wrap">
          {tableDetail && tableSections ? (
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
                  <div
                    className="plan-cell"
                    key={t.id}
                    style={{
                      left: `${(p.x / CANVAS_W) * 100}%`,
                      top: `${(p.y / CANVAS_H) * 100}%`,
                      width: `${(p.w / CANVAS_W) * 100}%`,
                      height: `${(p.h / CANVAS_H) * 100}%`,
                    }}
                  >
                    <button
                      className={cls}
                      disabled={busy === t.id}
                      aria-label={`${t.name}${o ? `, ${money(o.total)} açık adisyon, ${elapsed(o.opened_at)}` : ', boş masa'}`}
                      onClick={() => openTable(t.id, t.name, o?.id)}
                    >
                      <b>{t.name}</b>
                      {o ? (
                        <>
                          <span className="plan-total">{money(o.total)}</span>
                          <span className="plan-meta plan-time">
                            <span aria-hidden="true">⏱</span> {elapsed(o.opened_at)}
                            {o.guest_count > 0 && <em> · {o.guest_count} kişi</em>}
                          </span>
                        </>
                      ) : (
                        <span className="plan-meta plan-free">Boş</span>
                      )}
                    </button>
                    {o && menuButton(t, o.id, o.total, t.name)}
                  </div>
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
              {shownTables.map((t) => {
                const o = t.order
                return (
                  <div className="table-cell" key={t.id}>
                    <button
                      type="button"
                      className={`table-tile${o ? ' busy' : ''}${busy === t.id ? ' loading' : ''}`}
                      disabled={busy === t.id}
                      onClick={() => openTable(t.id, t.name, o?.id)}
                    >
                      <b>{t.name}</b>
                      {o ? (
                        <>
                          <span className="table-tile-total">{money(o.total)}</span>
                          <small>⏱ {elapsed(o.opened_at)}{o.guest_count > 0 ? ` · ${o.guest_count} kişi` : ''}</small>
                        </>
                      ) : (
                        <small className="table-tile-free">Boş</small>
                      )}
                    </button>
                    {o && menuButton(t, o.id, o.total, t.name)}
                  </div>
                )
              })}
              {shownTables.length === 0 && (
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

      {notice && <div className={`toast ${notice.kind === 'err' ? 'error' : 'ok'}`} role="status">{notice.text}</div>}

      {menuFor && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setMenuFor(null)}>
          <div className="modal table-menu" role="dialog" aria-modal="true" aria-label={`${menuFor.tableName} işlemleri`}>
            <p className="panel-kicker">{menuFor.tableName}</p>
            <h3>{money(menuFor.total)} · açık adisyon</h3>
            <div className="table-menu-list">
              <button type="button" onClick={() => { navigate(`/order/${menuFor.orderId}?pay=1`); setMenuFor(null) }}>
                <b>Öde</b><small>ödeme ekranını aç</small>
              </button>
              <button type="button" disabled={actionBusy} onClick={() => void quickPay(menuFor)}>
                <b>Hızlı Öde</b><small>nakit, tam tutar</small>
              </button>
              <button type="button" className="danger" onClick={() => { setVoidFor(menuFor.orderId); setMenuFor(null) }}>
                <b>İptal</b><small>gerekçeli iptal</small>
              </button>
              <button type="button" disabled={actionBusy} onClick={() => void printBill(menuFor)}>
                <b>Yazdır</b><small>ön hesap fişi</small>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMoveOpen({ orderId: menuFor.orderId, tableId: menuFor.tableId, tableName: menuFor.tableName })
                  setMenuFor(null)
                }}
              >
                <b>Masa Değiştir</b><small>boş masaya taşı</small>
              </button>
              <button type="button" onClick={() => { setPickFor({ orderId: menuFor.orderId, tableId: menuFor.tableId, mode: 'merge' }); setMenuFor(null) }}>
                <b>Masaları Birleştir</b><small>dolu masa ile</small>
              </button>
              <button type="button" onClick={() => { setPickFor({ orderId: menuFor.orderId, tableId: menuFor.tableId, mode: 'transfer' }); setMenuFor(null) }}>
                <b>Adisyon Aktar</b><small>başka masaya</small>
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setMenuFor(null)}>Kapat</button>
            </div>
          </div>
        </div>
      )}

      {pickFor && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setPickFor(null)}>
          <div className="modal table-move-modal" role="dialog" aria-modal="true" aria-label="Hedef masa seç">
            <h3>{pickFor.mode === 'merge' ? 'Hangi masa ile birleştirilsin?' : 'Adisyon hangi masaya aktarılsın?'}</h3>
            <div className="move-table-grid">
              {floors.flatMap((floor) =>
                floor.tables
                  .filter((table) => table.id !== pickFor.tableId && (pickFor.mode === 'transfer' || table.order))
                  .map((table) => (
                    <button type="button" className="move-table-choice" key={table.id} disabled={actionBusy} onClick={() => void pickTarget(table)}>
                      <b>{table.name}</b>
                      <small>
                        {floor.name} · {table.order ? money(table.order.total) : 'boş'}
                      </small>
                    </button>
                  )),
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setPickFor(null)} disabled={actionBusy}>Vazgeç</button>
            </div>
          </div>
        </div>
      )}

      {voidFor !== null && (
        <VoidOrderModal
          orderId={voidFor}
          onClose={() => setVoidFor(null)}
          onDone={async () => {
            setVoidFor(null)
            await refresh()
            notify('ok', 'Adisyon iptal edildi')
          }}
          onError={(message) => notify('err', message)}
        />
      )}

      {addOpen && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setAddOpen(false)}>
          <div className="modal add-table-modal" role="dialog" aria-modal="true" aria-label="Masa ekle">
            <p className="panel-kicker">{tableSections ? active?.name : 'Masalar'}</p>
            <h3>Yeni masa</h3>
            <label className="field">
              <span>Masa adı</span>
              <input
                className="input"
                autoFocus
                maxLength={40}
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitAddTable()
                }}
                placeholder="Örn. Teras 3"
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setAddOpen(false)} disabled={actionBusy}>Vazgeç</button>
              <button type="button" className="btn success" onClick={() => void submitAddTable()} disabled={actionBusy}>
                {actionBusy ? 'Ekleniyor…' : 'Masa ekle'}
              </button>
            </div>
          </div>
        </div>
      )}

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
              <button type="button" className="btn success" onClick={() => void confirmGuest()} disabled={opening}>
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
                      <small>{floor.name} · boş</small>
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
