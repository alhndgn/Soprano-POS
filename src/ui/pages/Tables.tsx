import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../App.tsx'
import { api, elapsed, money } from '../api.ts'

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
          <h1>Masalar</h1>
          <div className="sub">
            {stats.busy}/{stats.total} masa dolu · açık adisyon {money(stats.open)}
          </div>
        </div>
        <div className="head-actions">
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
        <div className="table-grid">
          {(active?.tables ?? []).map((t) => {
            const o = t.order
            const sent = o ? o.sent_lines > 0 : false
            return (
              <button
                key={t.id}
                className={`table-card${o ? ' busy' : ''}${sent ? ' sent' : ''}`}
                disabled={busy === t.id}
                onClick={() => void openTable(t.id, o?.id)}
              >
                <div className="table-top">
                  <div>
                    <div className="table-name">{t.name}</div>
                    <div className="table-meta">{t.seats} kişilik</div>
                  </div>
                  {o ? <span className="pill warn">{elapsed(o.opened_at)}</span> : <span className="pill">Boş</span>}
                </div>
                <div className="table-foot">
                  {o ? (
                    <>
                      <div className="table-total">{money(o.total)}</div>
                      <span className="pill ok">{o.line_count} ürün</span>
                    </>
                  ) : (
                    <span className="table-empty">Dokun → adisyon aç</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        <aside className="side-panel panel">
          <div className="panel-head">
            <h3>Açık adisyonlar</h3>
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
