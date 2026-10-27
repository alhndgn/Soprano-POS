/**
 * Demo/menü tohumlama. Idempotent: doluysa hiçbir şey yapmaz.
 * `npm run seed -- --reset` ile sıfırlanır (sadece geliştirmede).
 */
import { db, initDb } from './client.ts'
import { hashPin } from '../auth.ts'

type SeedProduct = {
  name: string
  vat?: number
  variants: [string, number][] // [ad, kuruş]
  groups?: string[]
}

const MOD_GROUPS: { name: string; min: number; max: number; mods: [string, number][] }[] = [
  {
    name: 'Hamur',
    min: 0,
    max: 1,
    mods: [
      ['İnce Hamur', 0],
      ['Orta Hamur', 0],
      ['Kalın Hamur', 0],
      ['Glutensiz', 2500],
    ],
  },
  {
    name: 'Ek Malzeme',
    min: 0,
    max: 6,
    mods: [
      ['Mantar', 2000],
      ['Sucuk', 2500],
      ['Mısır', 1500],
      ['Zeytin', 1500],
      ['Jalapeno', 2000],
      ['Ekstra Peynir', 3000],
      ['Tavuk', 3500],
      ['Soğan', 1000],
    ],
  },
  {
    name: 'Sos',
    min: 0,
    max: 1,
    mods: [
      ['Ranch', 1500],
      ['Barbekü', 1500],
      ['Acı Sos', 1000],
      ['Sarımsaklı', 1000],
    ],
  },
]

const CATEGORIES: { name: string; emoji: string; products: SeedProduct[] }[] = [
  {
    name: 'Pizzalar',
    emoji: '🍕',
    products: [
      { name: 'Margarita', variants: [['Küçük', 18000], ['Orta', 24000], ['Büyük', 30000]], groups: ['Hamur', 'Ek Malzeme', 'Sos'] },
      { name: 'Soprano Special', variants: [['Küçük', 20000], ['Orta', 27000], ['Büyük', 34000]], groups: ['Hamur', 'Ek Malzeme', 'Sos'] },
      { name: 'Pepperoni', variants: [['Küçük', 21000], ['Orta', 28000], ['Büyük', 35000]], groups: ['Hamur', 'Ek Malzeme', 'Sos'] },
      { name: 'Dört Peynirli', variants: [['Küçük', 22000], ['Orta', 29000], ['Büyük', 36000]], groups: ['Hamur', 'Ek Malzeme', 'Sos'] },
      { name: 'Vejetaryen', variants: [['Küçük', 19000], ['Orta', 26000], ['Büyük', 33000]], groups: ['Hamur', 'Ek Malzeme', 'Sos'] },
      { name: 'BBQ Tavuk', variants: [['Küçük', 21000], ['Orta', 28500], ['Büyük', 35500]], groups: ['Hamur', 'Ek Malzeme', 'Sos'] },
    ],
  },
  {
    name: 'Başlangıçlar',
    emoji: '🧄',
    products: [
      { name: 'Sarımsaklı Ekmek', variants: [['Standart', 9000]] },
      { name: 'Mozzarella Sticks', variants: [['Standart', 14000]] },
      { name: 'Patates Kızartması', variants: [['Standart', 8000]] },
      { name: 'Sezar Salata', variants: [['Standart', 12500]] },
    ],
  },
  {
    name: 'İçecekler',
    emoji: '🥤',
    products: [
      { name: 'Kola', vat: 20, variants: [['33cl', 4000]] },
      { name: 'Ayran', vat: 20, variants: [['30cl', 2500]] },
      { name: 'Su', vat: 20, variants: [['50cl', 1500]] },
      { name: 'Limonata', vat: 20, variants: [['40cl', 4500]] },
      { name: 'Türk Kahvesi', vat: 20, variants: [['Standart', 5000]] },
    ],
  },
  {
    name: 'Tatlılar',
    emoji: '🍰',
    products: [
      { name: 'Tiramisu', variants: [['Standart', 9500]] },
      { name: 'Brownie', variants: [['Standart', 9000]] },
      { name: 'Cheesecake', variants: [['Standart', 10000]] },
    ],
  },
]

const STAFF: { name: string; role: 'waiter' | 'cashier' | 'manager'; pin: string }[] = [
  { name: 'Alihan', role: 'manager', pin: '1234' },
  { name: 'Deniz', role: 'waiter', pin: '1111' },
  { name: 'Ece', role: 'cashier', pin: '2222' },
]

const TABLES: { floor: string; names: string[] }[] = [
  { floor: 'İç Salon', names: ['Masa 1', 'Masa 2', 'Masa 3', 'Masa 4', 'Masa 5', 'Masa 6'] },
  { floor: 'Bahçe', names: ['Bahçe 1', 'Bahçe 2', 'Bahçe 3'] },
]

export async function seed() {
  await initDb()
  const existing = await db.one<{ c: number }>(`SELECT count(*)::int AS c FROM users`)
  if (existing && existing.c > 0) return { seeded: false, reason: 'zaten dolu' }

  await db.one(`INSERT INTO outlets (name) VALUES ($1) RETURNING id`, ['Soprano Pizzeria'])

  // Personel
  for (const s of STAFF) {
    await db.one(`INSERT INTO users (name, role, pin_hash) VALUES ($1,$2,$3) RETURNING id`, [
      s.name,
      s.role,
      hashPin(s.pin),
    ])
  }

  // Katlar + masalar
  let floorSort = 0
  for (const f of TABLES) {
    const floor = await db.one<{ id: number }>(
      `INSERT INTO floors (name, sort) VALUES ($1,$2) RETURNING id`,
      [f.floor, floorSort++],
    )
    let tSort = 0
    for (const name of f.names) {
      await db.one(`INSERT INTO tables (floor_id, name, seats, sort) VALUES ($1,$2,$3,$4) RETURNING id`, [
        floor!.id,
        name,
        4,
        tSort++,
      ])
    }
  }

  // Modifier grupları
  const groupIds = new Map<string, number>()
  let gSort = 0
  for (const g of MOD_GROUPS) {
    const row = await db.one<{ id: number }>(
      `INSERT INTO modifier_groups (name, min_sel, max_sel, sort) VALUES ($1,$2,$3,$4) RETURNING id`,
      [g.name, g.min, g.max, gSort++],
    )
    groupIds.set(g.name, row!.id)
    let mSort = 0
    for (const [name, price] of g.mods) {
      await db.one(`INSERT INTO modifiers (group_id, name, price, sort) VALUES ($1,$2,$3,$4) RETURNING id`, [
        row!.id,
        name,
        price,
        mSort++,
      ])
    }
  }

  // Kategoriler + ürünler + varyantlar
  let cSort = 0
  for (const cat of CATEGORIES) {
    const c = await db.one<{ id: number }>(
      `INSERT INTO categories (name, emoji, sort) VALUES ($1,$2,$3) RETURNING id`,
      [cat.name, cat.emoji, cSort++],
    )
    let pSort = 0
    for (const p of cat.products) {
      const prod = await db.one<{ id: number }>(
        `INSERT INTO products (category_id, name, vat_rate, sort) VALUES ($1,$2,$3,$4) RETURNING id`,
        [c!.id, p.name, p.vat ?? 10, pSort++],
      )
      let vSort = 0
      for (const [vname, price] of p.variants) {
        await db.one(
          `INSERT INTO variants (product_id, name, price, sort) VALUES ($1,$2,$3,$4) RETURNING id`,
          [prod!.id, vname, price, vSort++],
        )
      }
      for (const gname of p.groups ?? []) {
        await db.one(`INSERT INTO product_modifier_groups (product_id, group_id) VALUES ($1,$2) RETURNING product_id`, [
          prod!.id,
          groupIds.get(gname)!,
        ])
      }
    }
  }

  await db.one(
    `INSERT INTO settings (key, value) VALUES ($1,$2) RETURNING key`,
    ['outlet', JSON.stringify({ name: 'Soprano Pizzeria', address: '', phone: '', footer: 'Afiyet olsun!' })],
  )

  return { seeded: true }
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seed()
    .then((r) => {
      console.log('seed:', r)
      process.exit(0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
