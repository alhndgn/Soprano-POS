/**
 * Test kalıntısı ürünleri temizler.
 *
 * Yalnızca adı "Test " ile başlayan, pasif ve hiçbir adisyonda kullanılmamış
 * ürünleri siler. Sunucu kapalıyken çalıştırılmalı (PGlite tek süreç).
 *
 *   npx tsx scripts/clean_test_products.ts
 */
import { db } from '../src/server/db/client.ts'

await db.init()

const rows = await db.all<{ id: number; name: string }>(
  `SELECT p.id, p.name FROM products p
   WHERE p.name LIKE 'Test %'
     AND p.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM order_lines ol WHERE ol.product_id = p.id)`,
)

for (const row of rows) {
  await db.run(`DELETE FROM product_modifier_groups WHERE product_id=$1`, [row.id])
  await db.run(`DELETE FROM product_ingredients WHERE product_id=$1`, [row.id])
  await db.run(`DELETE FROM variants WHERE product_id=$1`, [row.id])
  await db.run(`DELETE FROM products WHERE id=$1`, [row.id])
  console.log(`silindi: #${row.id} ${row.name}`)
}

// Adisyonda kullanılmış test ürünleri silinmez (geçmiş bozulmasın), yalnız gizlenir.
const used = await db.all<{ id: number; name: string }>(
  `SELECT p.id, p.name FROM products p
   WHERE p.name LIKE 'Test %' AND p.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM order_lines ol WHERE ol.product_id = p.id)`,
)
for (const row of used) {
  await db.run(`UPDATE products SET active=false, deleted_at=now() WHERE id=$1`, [row.id])
  console.log(`gizlendi (adisyonda kullanılmış): #${row.id} ${row.name}`)
}

console.log(`toplam ${rows.length} test ürünü silindi, ${used.length} tanesi gizlendi`)
process.exit(0)
