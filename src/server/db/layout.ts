import { db } from './client.ts'

/**
 * Yerleşim planı tohumlama.
 * Hiçbir masa konumlandırılmamışsa (hepsi 0,0) kat başına ızgara düzeni kurar.
 * Kullanıcı planı kaydettiğinde bir daha dokunmaz.
 */
const CANVAS_W = 1000
const CANVAS_H = 600
const COLS = 3
const CELL_W = 300
const CELL_H = 185
const TABLE_W = 120
const TABLE_H = 110

export async function ensureLayout(): Promise<{ placed: number }> {
  const floors = await db.all<{ id: number; name: string }>(`SELECT id, name FROM floors ORDER BY sort, id`)
  let placed = 0

  for (const floor of floors) {
    const tables = await db.all<{ id: number; x: number; y: number }>(
      `SELECT id, x, y FROM tables WHERE floor_id = $1 AND active = true ORDER BY sort, id`,
      [floor.id],
    )
    if (tables.length === 0) continue
    const untouched = tables.every((t) => t.x === 0 && t.y === 0)
    if (!untouched) continue

    for (const [i, t] of tables.entries()) {
      const col = i % COLS
      const row = Math.floor(i / COLS)
      const x = 70 + col * CELL_W + Math.round((CELL_W - TABLE_W) / 2)
      const y = 60 + row * CELL_H
      const w = TABLE_W
      const h = TABLE_H
      await db.one(
        `UPDATE tables SET x = $1, y = $2, w = $3, h = $4,
           shape = CASE WHEN $5 THEN 'round' ELSE shape END
         WHERE id = $6 RETURNING id`,
        [Math.min(x, CANVAS_W - w - 20), Math.min(y, CANVAS_H - h - 20), w, h, floor.name.toLowerCase().includes('bah'), t.id],
      )
      placed++
    }
  }
  return { placed }
}
