import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type LayoutFloor, type LayoutTable, type TableShape } from '../api.ts'

const CANVAS_W = 1000
const CANVAS_H = 600

const SHAPE_LABEL: Record<TableShape, string> = { square: 'Kare', round: 'Yuvarlak', rect: 'Dikdörtgen' }

type Draft = { x: number; y: number; w: number; h: number; shape: TableShape }

export default function LayoutEditor({ onError }: { onError: (msg: string | null) => void }) {
  const [floors, setFloors] = useState<LayoutFloor[]>([])
  const [floorId, setFloorId] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [drag, setDrag] = useState<{ id: number; sx: number; sy: number; ox: number; oy: number } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const canvasRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.layout()
      setFloors(data)
      setFloorId((prev) => prev ?? data[0]?.id ?? null)
      setDrafts({})
      setDirty(false)
      onError(null)
    } catch (e: any) {
      onError(e.message)
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => {
    void load()
  }, [load])

  const floor = floors.find((f) => f.id === floorId) ?? floors[0]
  const tables = floor?.tables ?? []
  const selected = tables.find((t) => t.id === selectedId) ?? null

  const pos = (t: LayoutTable): Draft => drafts[t.id] ?? { x: t.x, y: t.y, w: t.w, h: t.h, shape: t.shape }

  // sürükleme
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const kx = CANVAS_W / rect.width
      const ky = CANVAS_H / rect.height
      const t = tables.find((x) => x.id === drag.id)
      if (!t) return
      const rawX = drag.ox + (e.clientX - drag.sx) * kx
      const rawY = drag.oy + (e.clientY - drag.sy) * ky
      const snap = (v: number) => Math.round(v / 5) * 5
      setDrafts((d) => ({
        ...d,
        [drag.id]: {
          ...pos(t),
          x: Math.max(0, Math.min(CANVAS_W - (pos(t).w ?? t.w), snap(rawX))),
          y: Math.max(0, Math.min(CANVAS_H - (pos(t).h ?? t.h), snap(rawY))),
        },
      }))
      setDirty(true)
    }
    const up = () => setDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, tables, drafts])

  const addTable = async (shape: TableShape) => {
    if (!floor) return
    try {
      const n = tables.length
      const t = await api.addTable({
        floorId: floor.id,
        shape,
        x: 60 + (n % 3) * 210,
        y: 60 + Math.floor(n / 3) * 170,
      })
      setSelectedId(t.id)
      await load()
      setSelectedId(t.id)
    } catch (e: any) {
      onError(e.message)
    }
  }

  const patchSelected = async (body: { name?: string; seats?: number; shape?: TableShape }) => {
    if (!selected) return
    try {
      await api.patchTable(selected.id, body)
      await load()
    } catch (e: any) {
      onError(e.message)
    }
  }

  const removeSelected = async () => {
    if (!selected) return
    if (!confirm(`${selected.name} silinsin mi?`)) return
    try {
      await api.deleteTable(selected.id)
      setSelectedId(null)
      await load()
    } catch (e: any) {
      onError(e.message)
    }
  }

  const addFloor = async () => {
    const name = prompt('Yeni bölme adı (ör. Dış Mekan, Teras, Üst Kat)')
    if (!name?.trim()) return
    try {
      const f = await api.addFloor(name.trim())
      await load()
      setFloorId(f.id)
    } catch (e: any) {
      onError(e.message)
    }
  }

  const renameFloor = async () => {
    if (!floor) return
    const name = prompt('Bölme adı', floor.name)
    if (!name?.trim() || name === floor.name) return
    try {
      await api.renameFloor(floor.id, name.trim())
      await load()
    } catch (e: any) {
      onError(e.message)
    }
  }

  const removeFloor = async () => {
    if (!floor) return
    if (!confirm(`"${floor.name}" bölmesi silinsin mi?`)) return
    try {
      await api.deleteFloor(floor.id)
      setFloorId(null)
      await load()
    } catch (e: any) {
      onError(e.message)
    }
  }

  const save = async () => {
    if (!floor) return
    setSaving(true)
    try {
      await api.saveLayout(
        floor.id,
        tables.map((t) => {
          const p = pos(t)
          return { id: t.id, x: p.x, y: p.y, w: p.w, h: p.h, shape: p.shape }
        }),
      )
      await load()
      onError(null)
    } catch (e: any) {
      onError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const stats = useMemo(
    () => ({
      tables: tables.length,
      seats: tables.reduce((s, t) => s + t.seats, 0),
      placed: tables.filter((t) => pos(t).x > 0 || pos(t).y > 0).length,
    }),
    [tables, drafts],
  )

  // üst üste binen masalar: kaza ile kaydetmeyi engellemek için uyarı
  const overlaps = useMemo(() => {
    const boxes = tables.map((t) => ({ id: t.id, ...pos(t) }))
    const hit = new Set<number>()
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (ox > 10 && oy > 10) {
          hit.add(a.id)
          hit.add(b.id)
        }
      }
    }
    return hit
  }, [tables, drafts])

  if (loading) return <div className="kds-empty">Yükleniyor…</div>

  return (
    <div className="layout-editor">
      <div className="layout-toolbar">
        <div className="floors" style={{ margin: 0 }}>
          {floors.map((f) => (
            <button
              key={f.id}
              className={`floor-tab${f.id === floor?.id ? ' on' : ''}`}
              onClick={() => {
                setFloorId(f.id)
                setSelectedId(null)
                setDrafts({})
                setDirty(false)
              }}
            >
              {f.name}
              <span style={{ marginLeft: 6, color: 'var(--dim)', fontSize: 11 }}>{f.tables.length}</span>
            </button>
          ))}
          <button className="floor-tab" onClick={() => void addFloor()} title="Yeni bölme">
            + Bölme
          </button>
        </div>

        <div className="head-actions">
          <button className="btn ghost sm" onClick={() => void renameFloor()}>
            Bölmeyi yeniden adlandır
          </button>
          <button className="btn ghost sm" onClick={() => void removeFloor()}>
            Bölmeyi sil
          </button>
          <button className="btn sm" onClick={() => void addTable('square')}>
            + Kare masa
          </button>
          <button className="btn sm" onClick={() => void addTable('round')}>
            + Yuvarlak
          </button>
          <button className={`btn sm ${dirty ? 'primary' : ''}`} disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Kaydediliyor…' : dirty ? 'Düzeni kaydet' : 'Kayıtlı'}
          </button>
        </div>
      </div>

      <div className="layout-body">
        <div className="plan-wrap">
          <div className="plan-canvas" ref={canvasRef} onPointerDown={() => setSelectedId(null)}>
            <div className="plan-grid" />
            {tables.map((t) => {
              const p = pos(t)
              return (
                <div
                  key={t.id}
                  className={`plan-table ${p.shape}${selectedId === t.id ? ' selected' : ''}${overlaps.has(t.id) ? ' overlap' : ''}`}
                  style={{
                    left: `${(p.x / CANVAS_W) * 100}%`,
                    top: `${(p.y / CANVAS_H) * 100}%`,
                    width: `${(p.w / CANVAS_W) * 100}%`,
                    height: `${(p.h / CANVAS_H) * 100}%`,
                    cursor: drag?.id === t.id ? 'grabbing' : 'grab',
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    setSelectedId(t.id)
                    setDrag({ id: t.id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y })
                  }}
                >
                  <b>{t.name}</b>
                  <small>{t.seats} kişi</small>
                </div>
              )
            })}
            {tables.length === 0 && (
              <div className="plan-empty">
                Bu bölmede masa yok. Yukarıdan <b>+ Kare masa</b> ile ekle.
              </div>
            )}
          </div>
          <div className="plan-hint">
            Masayı sürükleyerek taşı · seçili masayı sağdan düzenle · {stats.placed}/{stats.tables} masa konumlu ·{' '}
            {stats.seats} kişilik toplam
            {overlaps.size > 0 && (
              <span className="pill warn" style={{ marginLeft: 10 }}>
                {overlaps.size} masa üst üste
              </span>
            )}
          </div>
        </div>

        <aside className="panel layout-side">
          <div className="panel-head">
            <h3>{selected ? selected.name : 'Masa seç'}</h3>
            {selected && <span className="pill">{SHAPE_LABEL[pos(selected).shape]}</span>}
          </div>
          <div className="panel-body">
            {!selected && (
              <div className="kds-empty">
                Düzenlemek için plan üzerindeki bir masaya dokun.
                <br />
                Yeni masa eklemek için yukarıdaki butonları kullan.
              </div>
            )}
            {selected && (
              <>
                <div className="field">
                  <label>Masa adı</label>
                  <input
                    className="input"
                    defaultValue={selected.name}
                    key={`${selected.id}-${selected.name}`}
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      if (v && v !== selected.name) void patchSelected({ name: v })
                    }}
                  />
                </div>
                <div className="field">
                  <label>Kişi sayısı</label>
                  <div className="mod-chips">
                    {[2, 4, 6, 8, 10].map((s) => (
                      <button
                        key={s}
                        className={`chip${selected.seats === s ? ' on' : ''}`}
                        onClick={() => void patchSelected({ seats: s })}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>Şekil</label>
                  <div className="mod-chips">
                    {(['square', 'round', 'rect'] as TableShape[]).map((s) => (
                      <button
                        key={s}
                        className={`chip${pos(selected).shape === s ? ' on' : ''}`}
                        onClick={() => {
                          const w = s === 'rect' ? 170 : 120
                          setDrafts((d) => ({ ...d, [selected.id]: { ...pos(selected), shape: s, w, h: 110 } }))
                          setDirty(true)
                        }}
                      >
                        {SHAPE_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>Boyut</label>
                  <div className="mod-chips">
                    <button className="chip" onClick={() => { setDrafts((d) => ({ ...d, [selected.id]: { ...pos(selected), w: 120, h: 110 } })); setDirty(true) }}>
                      Normal
                    </button>
                    <button className="chip" onClick={() => { setDrafts((d) => ({ ...d, [selected.id]: { ...pos(selected), w: 150, h: 130 } })); setDirty(true) }}>
                      Büyük
                    </button>
                    <button className="chip" onClick={() => { setDrafts((d) => ({ ...d, [selected.id]: { ...pos(selected), w: 180, h: 100 } })); setDirty(true) }}>
                      Geniş
                    </button>
                  </div>
                </div>
                <button className="btn danger block" style={{ marginTop: 6 }} onClick={() => void removeSelected()}>
                  Masayı sil
                </button>
                <p style={{ color: 'var(--dim)', fontSize: 11.5, marginTop: 12, lineHeight: 1.5 }}>
                  Konum değişiklikleri <b>Düzeni kaydet</b> ile kalıcı olur. Açık adisyonu olan masa silinemez.
                </p>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
