/**
 * Yayın paketi hazırlığı: menüyü/ayarları korur, işlem verisini temizler.
 *
 * Silinenler: ödemeler, adisyon satırları, adisyonlar, vardiyalar, yazdırma işleri.
 * Korunanlar: ürünler, kategoriler, seçenek grupları, masalar, personel, ayarlar, görseller.
 *
 * Sunucu KAPALIYKEN çalıştır:  npx tsx scripts/prepare_release.ts
 */
import { initDb, db } from '../src/server/db/client.ts'

await initDb()

const before = await db.one<{ orders: number; payments: number }>(
  `SELECT (SELECT count(*)::int FROM orders) AS orders, (SELECT count(*)::int FROM payments) AS payments`,
)

await db.run(`DELETE FROM payment_allocations`)
await db.run(`DELETE FROM payments`)
await db.run(`DELETE FROM line_modifiers`)
await db.run(`DELETE FROM line_ingredients`)
await db.run(`DELETE FROM order_lines`)
await db.run(`DELETE FROM print_jobs`)
await db.run(`DELETE FROM orders`)
await db.run(`UPDATE shifts SET closed_at = COALESCE(closed_at, now()), closing_count = COALESCE(closing_count, 0)`)

const after = await db.one<any>(
  `SELECT (SELECT count(*)::int FROM orders) AS orders,
          (SELECT count(*)::int FROM products) AS products,
          (SELECT count(*)::int FROM tables) AS tables,
          (SELECT count(*)::int FROM users) AS users`,
)
console.log('temizlendi:', before, '→', after)
process.exit(0)
