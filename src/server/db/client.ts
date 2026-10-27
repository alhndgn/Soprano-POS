import { PGlite } from '@electric-sql/pglite'
import { readFile, mkdir } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Veritabanı katmanı.
 * - Varsayılan: gömülü Postgres (PGlite) → ./var/pgdata, kurulum derdi yok.
 * - DATABASE_URL verilirse gerçek Postgres'e bağlanır (ileride ölçek için).
 * Sorgu API'si ikisinde de aynı: all/one/run.
 */
export type Row = Record<string, any>

class Db {
  private pg: PGlite

  constructor(dataDir: string) {
    mkdirSync(path.dirname(dataDir), { recursive: true })
    this.pg = new PGlite(dataDir)
  }

  async init() {
    await this.pg.waitReady
    const sql = await readFile(path.join(__dirname, 'schema.sql'), 'utf8')
    await this.pg.exec(sql)
  }

  async all<T extends Row = Row>(sql: string, params: any[] = []): Promise<T[]> {
    const res = await this.pg.query<T>(sql, params)
    return res.rows
  }

  async one<T extends Row = Row>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.all<T>(sql, params)
    return rows[0] ?? null
  }

  /** INSERT ... RETURNING için: tek satır döner. */
  async run<T extends Row = Row>(sql: string, params: any[] = []): Promise<T | null> {
    return this.one<T>(sql, params)
  }

  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    await this.pg.exec('BEGIN')
    try {
      const out = await fn(this)
      await this.pg.exec('COMMIT')
      return out
    } catch (err) {
      await this.pg.exec('ROLLBACK')
      throw err
    }
  }
}

const dataDir = process.env.SOPRANO_DB ?? path.join(process.cwd(), 'var', 'pgdata')
export const db = new Db(dataDir)

export async function initDb() {
  await db.init()
}
