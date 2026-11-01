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
    type Group = {
      orderId: number
      table: string
      sentAt: string
      lines: KdsLine[]
      status: 'sent' | 'preparing' | 'ready'
    }
    const rank: Record<Group['status'], number> = { sent: 0, preparing: 1, ready: 2 }
    const map = new Map<number, Group>()
    for (const l of lines) {
      const current = map.get(l.order_id)
      if (!current) {
        map.set(l.order_id, {
          orderId: l.order_id,
          table: l.table_name ?? 'Masa',
          sentAt: l.sent_at,
          lines: [l],
          status: l.status,
        })
      } else {
        current.lines.push(l)
        if (rank[l.status] < rank[current.status]) current.status = l.status
        if (new Date(l.sent_at).getTime() < new Date(current.sentAt).getTime()) current.sentAt = l.sent_at
      }
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
          <h1>Mutfak</h1>
        </div>
        <div className="head-actions">
          <span className="pill ok live" role="status">{lines.length} aktif satır</span>
          <button type="button" className="btn ghost sm" aria-label="Mutfak ekranını tam ekran aç" onClick={() => void document.documentElement.requestFullscreen?.()}>
            Tam ekran
          </button>
        </div>
      </div>

      {error && <div className="toast error">{error}</div>}

      <div className="kds-board" aria-live="polite">
        {COLUMNS.map((col) => {
          const cards = [...grouped.values()].filter((group) => group.status === col.status)
          return (
            <section className={`kds-col kds-col-${col.status}`} key={col.status} aria-label={col.title}>
              <div className="kds-col-head">
                <h3>{col.title}</h3>
                <span className="pill">{cards.length}</span>
              </div>
              {cards.length === 0 && <div className="kds-empty">Bekleyen sipariş yok</div>}
              {cards.map((group) => (
                <div className={`kds-card ${col.status}`} key={group.orderId}>
                  <div className="kds-head">
                    <b>{group.table}</b>
                    <span className="kds-time">#{group.orderId} · {group.lines.length} satır · {elapsed(group.sentAt)}</span>
                  </div>
                  <div className="kds-items">
                    {group.lines.map((l) => (
                      <div className="kds-item" key={l.id}>
                        <b>{l.qty} ×</b> {l.name}
                        {l.modifiers.length > 0 && <small>{l.modifiers.map((m) => m.name).join(' · ')}</small>}
                        {l.status !== col.status && <small className={`kds-line-status ${l.status}`}>{l.status === 'preparing' ? 'hazırlanıyor' : l.status === 'ready' ? 'hazır' : 'yeni'}</small>}
                        {l.note && <div className="note">NOT: {l.note}</div>}
                      </div>
                    ))}
                  </div>
                  {col.action && (
                    <div className="kds-actions">
                      <button
                        className={`btn ${col.action.to === 'served' ? 'ghost' : 'primary'} sm`}
                        onClick={async () => {
                          for (const l of group.lines.filter((line) => line.status === col.status)) await move(l, col.action!.to)
                        }}
                      >
                        {col.action.label}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}
