import { useEffect, useMemo, useState } from 'react'
import { api, elapsed, type KdsLine } from '../api.ts'

const COLUMNS: { status: 'sent' | 'preparing' | 'ready'; title: string; action?: { to: 'preparing' | 'ready' | 'served'; label: string } }[] = [
  { status: 'sent', title: 'Yeni sipariş', action: { to: 'preparing', label: 'Başla' } },
  { status: 'preparing', title: 'Hazırlanıyor', action: { to: 'ready', label: 'Hazır' } },
  { status: 'ready', title: 'Hazır · servis bekliyor', action: { to: 'served', label: 'Servis edildi' } },
]

export default function Kds() {
  const [lines, setLines] = useState<KdsLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await api.kds()
        if (alive) {
          setLines(r.lines)
          setError(null)
        }
      } catch (e: any) {
        if (alive) setError(e.message)
      }
    }
    void load()
    const t = setInterval(load, 4000)
    const c = setInterval(() => setTick((x) => x + 1), 30000) // süreleri tazele
    return () => {
      alive = false
      clearInterval(t)
      clearInterval(c)
    }
  }, [])

  const grouped = useMemo(() => {
    const map = new Map<string, { orderId: number; table: string; sentAt: string; lines: KdsLine[] }>()
    for (const l of lines) {
      const key = `${l.order_id}-${l.status}`
      if (!map.has(key))
        map.set(key, { orderId: l.order_id, table: l.table_name ?? 'Masa', sentAt: l.sent_at, lines: [] })
      map.get(key)!.lines.push(l)
    }
    return map
  }, [lines, tick])

  const move = async (line: KdsLine, status: 'preparing' | 'ready' | 'served') => {
    setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, status: status as any } : l)))
    try {
      await api.kdsStatus(line.id, status)
    } catch {
      const r = await api.kds()
      setLines(r.lines)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Mutfak Ekranı</h1>
          <div className="sub">{lines.length} aktif satır · otomatik yenilenir</div>
        </div>
        <div className="head-actions">
          <span className="pill ok live">canlı</span>
          <button className="btn ghost sm" onClick={() => void document.documentElement.requestFullscreen?.()}>
            Tam ekran
          </button>
        </div>
      </div>

      {error && <div className="toast error">{error}</div>}

      <div className="kds-board">
        {COLUMNS.map((col) => {
          const cards = [...grouped.entries()].filter(([key]) => key.endsWith(`-${col.status}`))
          return (
            <div className="kds-col" key={col.status}>
              <div className="kds-col-head">
                <h3>{col.title}</h3>
                <span className="pill">{cards.length}</span>
              </div>
              {cards.length === 0 && <div className="kds-empty">Bekleyen sipariş yok</div>}
              {cards.map(([key, group]) => (
                <div className={`kds-card ${col.status}`} key={key}>
                  <div className="kds-head">
                    <b>{group.table}</b>
                    <span className="kds-time">#{group.orderId} · {elapsed(group.sentAt)}</span>
                  </div>
                  <div className="kds-items">
                    {group.lines.map((l) => (
                      <div className="kds-item" key={l.id}>
                        <b>{l.qty} ×</b> {l.name}
                        {l.modifiers.length > 0 && <small>{l.modifiers.map((m) => m.name).join(' · ')}</small>}
                        {l.note && <div className="note">NOT: {l.note}</div>}
                      </div>
                    ))}
                  </div>
                  {col.action && (
                    <div className="kds-actions">
                      <button
                        className={`btn ${col.action.to === 'served' ? 'ghost' : 'primary'} sm`}
                        onClick={async () => {
                          for (const l of group.lines) await move(l, col.action!.to)
                        }}
                      >
                        {col.action.label}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
