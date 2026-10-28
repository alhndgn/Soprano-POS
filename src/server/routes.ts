import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { db } from './db/client.ts'
import { hashPin, loginWithPin, logout, requireRole, userForToken, type AuthUser } from './auth.ts'
import { orderTotals, type PricedLine } from './money.ts'

// ---------- SSE yayını ----------
const subscribers = new Set<any>()
export function broadcast(event = 'change') {
  for (const res of subscribers) {
    try {
      res.write(`event: ${event}\ndata: {}\n\n`)
    } catch {
      subscribers.delete(res)
    }
  }
}

// ---------- yardımcılar ----------
const openShift = () =>
  db.one<{ id: number; opened_at: string; opening_float: number }>(
    `SELECT id, opened_at, opening_float FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1`,
  )

type LineRow = {
  id: number
  order_id: number
  name: string
  qty: number
  unit_price: number
  vat_rate: number
  note: string | null
  status: string
  modifiers: { name: string; price: number }[]
}

async function loadOrder(orderId: number) {
  const order = await db.one<any>(
    `SELECT o.*, t.name AS table_name, u.name AS staff_name
     FROM orders o
     LEFT JOIN tables t ON t.id = o.table_id
     JOIN users u ON u.id = o.opened_by
     WHERE o.id = $1`,
    [orderId],
  )
  if (!order) return null
  const lines = await db.all<LineRow>(
    `SELECT ol.id, ol.order_id, ol.name, ol.qty, ol.unit_price, ol.vat_rate, ol.note, ol.status,
            COALESCE((SELECT json_agg(json_build_object('id', lm.modifier_id, 'name', lm.name, 'price', lm.price) ORDER BY lm.id)
                      FROM line_modifiers lm WHERE lm.line_id = ol.id), '[]'::json) AS modifiers
     FROM order_lines ol
     WHERE ol.order_id = $1 AND ol.status <> 'void'
     ORDER BY ol.id`,
    [orderId],
  )
  const payments = await db.all(
    `SELECT id, method, amount, created_at FROM payments WHERE order_id = $1 ORDER BY id`,
    [orderId],
  )
  const live: PricedLine[] = lines.map((l) => ({
    qty: l.qty,
    unitPrice: l.unit_price,
    vatRate: l.vat_rate,
    modifiers: l.modifiers,
  }))
  const totals = orderTotals(live)
  const paid = payments.reduce((s: number, p: any) => s + p.amount, 0)
  return { ...order, lines, payments, totals, paid }
}

function sessionToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7)
  const cookieToken = (req as any).cookies?.soprano_token
  if (cookieToken) return cookieToken
  // EventSource header gönderemez → token query'den gelir
  const q = (req.query as any)?.token
  return typeof q === 'string' && q.length > 0 ? q : undefined
}

async function authHook(req: FastifyRequest, reply: FastifyReply) {
  const user = await userForToken(sessionToken(req))
  if (!user) return reply.code(401).send({ error: 'Oturum gerekli' })
  ;(req as any).user = user
}

const user = (req: FastifyRequest): AuthUser => (req as any).user

export async function registerRoutes(app: FastifyInstance) {
  // ---------- auth ----------
  app.post('/api/auth/pin', async (req) => {
    const { pin } = z.object({ pin: z.string().min(3).max(12) }).parse(req.body)
    const authed = await loginWithPin(pin)
    if (!authed) {
      const err: any = new Error('PIN hatalı')
      err.statusCode = 401
      throw err
    }
    const token = await db.one<{ token: string }>(
      `SELECT token FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [authed.id],
    )
    return { user: authed, token: token?.token }
  })

  app.post('/api/auth/logout', async (req) => {
    const t = sessionToken(req)
    if (t) await logout(t)
    return { ok: true }
  })

  // ---------- korumalı alan ----------
  await app.register(async (scope) => {
    scope.addHook('preHandler', authHook)

    scope.get('/api/auth/me', async (req) => user(req))

    scope.get('/api/bootstrap', async (req) => {
      const me = user(req)
      const outlet = await db.one<any>(
        `SELECT value FROM settings WHERE key = 'outlet'`,
      )
      const floors = await db.all<any>(`SELECT id, name FROM floors ORDER BY sort, id`)
      const tables = await db.all<any>(
        `SELECT id, floor_id, name, seats, shape, x, y, w, h
         FROM tables WHERE active = true ORDER BY sort, id`,
      )
      const openOrders = await db.all<any>(
        `SELECT o.id, o.table_id, o.guest_count, o.opened_at, o.status,
                COALESCE(SUM((ol.unit_price + COALESCE((SELECT SUM(lm.price) FROM line_modifiers lm WHERE lm.line_id = ol.id), 0)) * ol.qty), 0)::int AS total,
                COUNT(ol.id) FILTER (WHERE ol.status = 'sent')::int AS sent_lines,
                COUNT(ol.id)::int AS line_count
         FROM orders o
         LEFT JOIN order_lines ol ON ol.order_id = o.id AND ol.status <> 'void'
         WHERE o.status = 'open'
         GROUP BY o.id`,
      )
      const categories = await db.all<any>(`SELECT id, name, emoji FROM categories ORDER BY sort, id`)
      const products = await db.all<any>(
        `SELECT id, category_id, name, vat_rate, image_url FROM products WHERE active = true ORDER BY sort, id`,
      )
      const variants = await db.all<any>(
        `SELECT id, product_id, name, price FROM variants WHERE active = true ORDER BY sort, id`,
      )
      const groups = await db.all<any>(`SELECT id, name, min_sel, max_sel FROM modifier_groups ORDER BY sort, id`)
      const mods = await db.all<any>(`SELECT id, group_id, name, price FROM modifiers WHERE active = true ORDER BY sort, id`)
      const pmg = await db.all<any>(`SELECT product_id, group_id FROM product_modifier_groups`)
      const shift = await openShift()

      const orderByTable = new Map(openOrders.map((o) => [o.table_id, o]))
      return {
        me,
        outlet: outlet?.value ?? {},
        shift,
        floors: floors.map((f) => ({
          ...f,
          tables: tables
            .filter((t) => t.floor_id === f.id)
            .map((t) => ({ ...t, order: orderByTable.get(t.id) ?? null })),
        })),
        menu: categories.map((c) => ({
          id: c.id,
          name: c.name,
          emoji: c.emoji,
          products: products
            .filter((p) => p.category_id === c.id)
            .map((p) => ({
              id: p.id,
              name: p.name,
              vatRate: p.vat_rate,
              imageUrl: p.image_url,
              variants: variants.filter((v) => v.product_id === p.id),
              groups: pmg
                .filter((x) => x.product_id === p.id)
                .map((x) => {
                  const g = groups.find((g2) => g2.id === x.group_id)
                  return {
                    id: g.id,
                    name: g.name,
                    min: g.min_sel,
                    max: g.max_sel,
                    modifiers: mods.filter((m) => m.group_id === g.id),
                  }
                }),
            })),
        })),
      }
    })

    // ---------- vardiya ----------
    scope.get('/api/shift/current', async () => openShift())

    scope.post('/api/shift/open', async (req) => {
      requireRole(user(req), ['cashier', 'manager'])
      if (await openShift()) {
        const e: any = new Error('Zaten açık bir vardiya var')
        e.statusCode = 400
        throw e
      }
      const { openingFloat = 0 } = z.object({ openingFloat: z.number().int().min(0).default(0) }).parse(req.body ?? {})
      return db.one(`INSERT INTO shifts (opened_by, opening_float) VALUES ($1,$2) RETURNING *`, [user(req).id, openingFloat])
    })

    scope.post('/api/shift/close', async (req) => {
      requireRole(user(req), ['cashier', 'manager'])
      const shift = await openShift()
      if (!shift) {
        const e: any = new Error('Açık vardiya yok')
        e.statusCode = 400
        throw e
      }
      const { closingCount } = z.object({ closingCount: z.number().int().min(0) }).parse(req.body)
      const openOrders = await db.one<{ c: number }>(`SELECT count(*)::int AS c FROM orders WHERE status='open'`)
      if (openOrders && openOrders.c > 0) {
        const e: any = new Error(`Açık adisyon var (${openOrders.c}) — önce hepsini kapat`)
        e.statusCode = 400
        throw e
      }
      return db.one(
        `UPDATE shifts SET closed_by=$1, closed_at=now(), closing_count=$2 WHERE id=$3 RETURNING *`,
        [user(req).id, closingCount, shift.id],
      )
    })

    // ---------- adisyon ----------
    scope.post('/api/orders', async (req) => {
      const { tableId, guestCount = 1, note } = z
        .object({ tableId: z.number().int().positive(), guestCount: z.number().int().min(1).max(30).default(1), note: z.string().max(200).optional() })
        .parse(req.body)
      const table = await db.one(`SELECT id FROM tables WHERE id=$1 AND active=true`, [tableId])
      if (!table) {
        const e: any = new Error('Masa bulunamadı')
        e.statusCode = 404
        throw e
      }
      const existing = await db.one<{ id: number }>(`SELECT id FROM orders WHERE table_id=$1 AND status='open'`, [tableId])
      if (existing) return { id: existing.id, existing: true }
      const shift = await openShift()
      const order = await db.one<any>(
        `INSERT INTO orders (table_id, shift_id, opened_by, guest_count, note) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [tableId, shift?.id ?? null, user(req).id, guestCount, note ?? null],
      )
      broadcast()
      return order
    })

    scope.get('/api/orders/:id', async (req) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const order = await loadOrder(id)
      if (!order) {
        const e: any = new Error('Adisyon bulunamadı')
        e.statusCode = 404
        throw e
      }
      return order
    })

    scope.post('/api/orders/:id/lines', async (req) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const body = z
        .object({
          productId: z.number().int(),
          variantId: z.number().int().nullable().optional(),
          qty: z.number().int().min(1).max(99).default(1),
          modifierIds: z.array(z.number().int()).default([]),
          note: z.string().max(200).optional(),
        })
        .parse(req.body)

      const order = await db.one<any>(`SELECT * FROM orders WHERE id=$1`, [id])
      if (!order || order.status !== 'open') {
        const e: any = new Error('Adisyon açık değil')
        e.statusCode = 400
        throw e
      }
      const product = await db.one<any>(`SELECT * FROM products WHERE id=$1`, [body.productId])
      if (!product) {
        const e: any = new Error('Ürün bulunamadı')
        e.statusCode = 404
        throw e
      }
      let variant = body.variantId
        ? await db.one<any>(`SELECT * FROM variants WHERE id=$1 AND product_id=$2`, [body.variantId, body.productId])
        : await db.one<any>(`SELECT * FROM variants WHERE product_id=$1 ORDER BY sort LIMIT 1`, [body.productId])
      if (!variant) {
        const e: any = new Error('Ürün varyantı bulunamadı')
        e.statusCode = 400
        throw e
      }

      const mods = body.modifierIds.length
        ? await db.all<any>(
            `SELECT m.id, m.name, m.price FROM modifiers m WHERE m.id = ANY($1::int[])`,
            [`{${body.modifierIds.join(',')}}`],
          )
        : []

      return db.tx(async (tx) => {
        const line = await tx.one<any>(
          `INSERT INTO order_lines (order_id, product_id, variant_id, name, qty, unit_price, vat_rate, note, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'new') RETURNING *`,
          [id, product.id, variant.id, `${product.name} (${variant.name})`, body.qty, variant.price, product.vat_rate, body.note ?? null],
        )
        for (const m of mods) {
          await tx.one(`INSERT INTO line_modifiers (line_id, modifier_id, name, price) VALUES ($1,$2,$3,$4) RETURNING id`, [
            line!.id,
            m.id,
            m.name,
            m.price,
          ])
        }
        broadcast()
        return loadOrder(Number(id))
      })
    })

    scope.patch('/api/orders/lines/:lineId', async (req) => {
      const { lineId } = z.object({ lineId: z.coerce.number().int() }).parse(req.params)
      const body = z
        .object({
          qty: z.number().int().min(1).max(99).optional(),
          note: z.string().max(200).nullable().optional(),
          status: z.enum(['new', 'sent', 'preparing', 'ready', 'served']).optional(),
          void: z.boolean().optional(),
        })
        .parse(req.body)
      const line = await db.one<any>(`SELECT * FROM order_lines WHERE id=$1`, [lineId])
      if (!line) {
        const e: any = new Error('Satır bulunamadı')
        e.statusCode = 404
        throw e
      }
      if (body.void) {
        requireRole(user(req), ['manager'])
        await db.one(`UPDATE order_lines SET status='void' WHERE id=$1 RETURNING id`, [lineId])
      } else {
        if (body.qty !== undefined)
          await db.one(`UPDATE order_lines SET qty=$1 WHERE id=$2 RETURNING id`, [body.qty, lineId])
        if (body.note !== undefined)
          await db.one(`UPDATE order_lines SET note=$1 WHERE id=$2 RETURNING id`, [body.note, lineId])
        if (body.status) {
          await db.one(`UPDATE order_lines SET status=$1 WHERE id=$2 RETURNING id`, [body.status, lineId])
        }
      }
      broadcast()
      return loadOrder(line.order_id)
    })

    // Mutfağa gönder → KOT fişi
    scope.post('/api/orders/:id/send', async (req) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const order = await loadOrder(id)
      if (!order || order.status !== 'open') {
        const e: any = new Error('Adisyon açık değil')
        e.statusCode = 400
        throw e
      }
      const newLines = order.lines.filter((l: LineRow) => l.status === 'new')
      if (!newLines.length) return order

      await db.all(`UPDATE order_lines SET status='sent', sent_at=now() WHERE order_id=$1 AND status='new'`, [id])
      await db.one(
        `INSERT INTO print_jobs (kind, device, order_id, payload) VALUES ('kot','kitchen',$1,$2) RETURNING id`,
        [
          id,
          JSON.stringify({
            orderId: order.id,
            tableName: order.table_name ?? 'Paket',
            staffName: order.staff_name,
            timeISO: new Date().toISOString(),
            lines: newLines.map((l: LineRow) => ({
              name: l.name,
              qty: l.qty,
              note: l.note,
              modifiers: l.modifiers.map((m) => m.name),
            })),
          }),
        ],
      )
      broadcast('kot')
      return loadOrder(id)
    })

    scope.post('/api/orders/:id/move', async (req) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const { tableId } = z.object({ tableId: z.number().int() }).parse(req.body)
      const clash = await db.one(`SELECT id FROM orders WHERE table_id=$1 AND status='open' AND id<>$2`, [tableId, id])
      if (clash) {
        const e: any = new Error('Hedef masa dolu')
        e.statusCode = 400
        throw e
      }
      await db.one(`UPDATE orders SET table_id=$1 WHERE id=$2 RETURNING id`, [tableId, id])
      broadcast()
      return loadOrder(id)
    })

    // Yanlış açılan adisyonu iptal et (yönetici, ödeme alınmamışsa)
    scope.post('/api/orders/:id/void', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const order = await db.one<any>(`SELECT * FROM orders WHERE id=$1`, [id])
      if (!order) {
        const e: any = new Error('Adisyon bulunamadı')
        e.statusCode = 404
        throw e
      }
      if (order.status !== 'open') {
        const e: any = new Error('Adisyon açık değil')
        e.statusCode = 400
        throw e
      }
      const paid = await db.one<{ c: number }>(`SELECT count(*)::int AS c FROM payments WHERE order_id=$1`, [id])
      if (paid && paid.c > 0) {
        const e: any = new Error('Ödeme alınmış adisyon iptal edilemez')
        e.statusCode = 400
        throw e
      }
      await db.one(`UPDATE orders SET status='void', closed_at=now() WHERE id=$1 RETURNING id`, [id])
      broadcast()
      return { ok: true, orderId: id }
    })

    scope.post('/api/orders/:id/pay', async (req) => {
      requireRole(user(req), ['cashier', 'manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const { payments } = z
        .object({
          payments: z
            .array(z.object({ method: z.enum(['cash', 'card', 'other']), amount: z.number().int().positive() }))
            .min(1),
        })
        .parse(req.body)
      const order = await loadOrder(id)
      if (!order || order.status !== 'open') {
        const e: any = new Error('Adisyon açık değil')
        e.statusCode = 400
        throw e
      }
      const tendered = payments.reduce((s, p) => s + p.amount, 0)
      const total = order.totals.total
      if (tendered < total) {
        const e: any = new Error('Ödeme tutarı yetersiz')
        e.statusCode = 400
        throw e
      }
      // Para üstü ciroya yazılmaz: her ödeme kalan borçla sınırlanır.
      let due = total
      const applied: { method: 'cash' | 'card' | 'other'; amount: number }[] = []
      for (const p of payments) {
        const amount = Math.min(p.amount, due)
        if (amount > 0) {
          applied.push({ method: p.method, amount })
          due -= amount
        }
      }
      const changeDue = tendered - total
      const meta = (await db.one<any>(`SELECT value FROM settings WHERE key='outlet'`))?.value ?? {}

      await db.tx(async (tx) => {
        for (const p of applied) {
          await tx.one(
            `INSERT INTO payments (order_id, method, amount, taken_by) VALUES ($1,$2,$3,$4) RETURNING id`,
            [id, p.method, p.amount, user(req).id],
          )
        }
        await tx.one(`UPDATE orders SET status='paid', closed_at=now() WHERE id=$1 RETURNING id`, [id])
        await tx.one(
          `INSERT INTO print_jobs (kind, device, order_id, payload) VALUES ('receipt','receipt',$1,$2) RETURNING id`,
          [
            id,
            JSON.stringify({
              outletName: meta.name ?? 'Soprano',
              orderId: order.id,
              tableName: order.table_name ?? 'Paket',
              staffName: user(req).name,
              dateISO: new Date().toISOString(),
              lines: order.lines.map((l: LineRow) => ({
                name: l.name,
                qty: l.qty,
                unitPrice: l.unit_price,
                modifiers: l.modifiers.map((m) => m.name),
                total: (l.unit_price + l.modifiers.reduce((s, m) => s + m.price, 0)) * l.qty,
              })),
              subtotal: order.totals.subtotal,
              vatLines: order.totals.vatLines,
              total: order.totals.total,
              payments: applied,
              change: changeDue,
              footer: meta.footer ?? '',
            }),
          ],
        )
      })
      broadcast('paid')
      return { ok: true, change: changeDue, orderId: id }
    })

    // ---------- mutfak ----------
    scope.get('/api/kds', async () => {
      const lines = await db.all<any>(
        `SELECT ol.id, ol.order_id, ol.name, ol.qty, ol.note, ol.status, ol.sent_at,
                t.name AS table_name,
                COALESCE((SELECT json_agg(json_build_object('name', lm.name) ORDER BY lm.id)
                          FROM line_modifiers lm WHERE lm.line_id = ol.id), '[]'::json) AS modifiers
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
         LEFT JOIN tables t ON t.id = o.table_id
         WHERE ol.status IN ('sent','preparing','ready') AND o.status='open'
         ORDER BY ol.sent_at ASC, ol.id ASC`,
      )
      return { lines }
    })

    scope.post('/api/kds/lines/:id/status', async (req) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const { status } = z.object({ status: z.enum(['preparing', 'ready', 'served']) }).parse(req.body)
      await db.one(`UPDATE order_lines SET status=$1 WHERE id=$2 RETURNING id`, [status, id])
      broadcast('kds')
      return { ok: true }
    })

    // ---------- raporlar ----------
    scope.get('/api/reports/daily', async (req) => {
      requireRole(user(req), ['manager'])
      const { date } = z.object({ date: z.string().optional() }).parse(req.query)
      const day = date ?? new Date().toISOString().slice(0, 10)
      const byMethod = await db.all<any>(
        `SELECT p.method, SUM(p.amount)::int AS amount, count(*)::int AS count
         FROM payments p WHERE p.created_at::date = $1::date GROUP BY p.method`,
        [day],
      )
      const orderCount = await db.one<any>(
        `SELECT count(*)::int AS c, COALESCE(SUM(total),0)::int AS revenue FROM (
           SELECT o.id, COALESCE(SUM((ol.unit_price + COALESCE((SELECT SUM(lm.price) FROM line_modifiers lm WHERE lm.line_id=ol.id),0)) * ol.qty),0)::int AS total
           FROM orders o LEFT JOIN order_lines ol ON ol.order_id=o.id AND ol.status<>'void'
           WHERE o.status='paid' AND o.closed_at::date = $1::date GROUP BY o.id
         ) x`,
        [day],
      )
      const topProducts = await db.all<any>(
        `SELECT ol.name, SUM(ol.qty)::int AS qty, SUM((ol.unit_price + COALESCE((SELECT SUM(lm.price) FROM line_modifiers lm WHERE lm.line_id=ol.id),0)) * ol.qty)::int AS revenue
         FROM order_lines ol JOIN orders o ON o.id=ol.order_id
         WHERE o.status='paid' AND o.closed_at::date=$1::date AND ol.status<>'void'
         GROUP BY ol.name ORDER BY qty DESC LIMIT 8`,
        [day],
      )
      const hourly = await db.all<any>(
        `SELECT extract(hour FROM p.created_at)::int AS hour, SUM(p.amount)::int AS amount
         FROM payments p WHERE p.created_at::date=$1::date GROUP BY 1 ORDER BY 1`,
        [day],
      )
      return { day, byMethod, orders: orderCount?.c ?? 0, revenue: orderCount?.revenue ?? 0, topProducts, hourly }
    })

    // ---------- yönetim (okuma) ----------
    scope.get('/api/admin/menu', async (req) => {
      requireRole(user(req), ['manager'])
      const products = await db.all<any>(
        `SELECT p.id, p.name, p.vat_rate, p.image_url, c.name AS category, c.id AS category_id
         FROM products p JOIN categories c ON c.id=p.category_id ORDER BY c.sort, p.sort`,
      )
      const variants = await db.all<any>(`SELECT id, product_id, name, price FROM variants ORDER BY product_id, sort`)
      return products.map((p) => ({ ...p, variants: variants.filter((v) => v.product_id === p.id) }))
    })

    scope.get('/api/admin/staff', async (req) => {
      requireRole(user(req), ['manager'])
      return db.all(`SELECT id, name, role, active FROM users ORDER BY id`)
    })

    scope.post('/api/admin/staff', async (req) => {
      requireRole(user(req), ['manager'])
      const body = z.object({ name: z.string().min(2), role: z.enum(['waiter', 'cashier', 'manager']), pin: z.string().min(3).max(12) }).parse(req.body)
      return db.one(`INSERT INTO users (name, role, pin_hash) VALUES ($1,$2,$3) RETURNING id, name, role`, [body.name, body.role, hashPin(body.pin)])
    })

    // ---------- masa düzeni (bölmeler + masalar) ----------
    const CANVAS_W = 1000
    const CANVAS_H = 600

    scope.get('/api/admin/layout', async (req) => {
      requireRole(user(req), ['manager'])
      const floors = await db.all<any>(`SELECT id, name, sort FROM floors ORDER BY sort, id`)
      const tables = await db.all<any>(
        `SELECT id, floor_id, name, seats, shape, x, y, w, h, sort
         FROM tables WHERE active = true ORDER BY floor_id, sort, id`,
      )
      return floors.map((f) => ({ ...f, tables: tables.filter((t) => t.floor_id === f.id) }))
    })

    scope.post('/api/admin/floors', async (req) => {
      requireRole(user(req), ['manager'])
      const { name } = z.object({ name: z.string().min(1).max(40) }).parse(req.body)
      const sort = await db.one<{ n: number }>(`SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM floors`)
      return db.one(`INSERT INTO floors (name, sort) VALUES ($1,$2) RETURNING *`, [name, sort!.n])
    })

    scope.patch('/api/admin/floors/:id', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const { name } = z.object({ name: z.string().min(1).max(40) }).parse(req.body)
      return db.one(`UPDATE floors SET name=$1 WHERE id=$2 RETURNING *`, [name, id])
    })

    scope.delete('/api/admin/floors/:id', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const used = await db.one<{ c: number }>(`SELECT count(*)::int AS c FROM tables WHERE floor_id=$1 AND active=true`, [id])
      if (used && used.c > 0) {
        const e: any = new Error(`Bu bölmede ${used.c} masa var — önce masaları sil`)
        e.statusCode = 400
        throw e
      }
      const total = await db.one<{ c: number }>(`SELECT count(*)::int AS c FROM floors`)
      if (total && total.c <= 1) {
        const e: any = new Error('Son bölme silinemez')
        e.statusCode = 400
        throw e
      }
      await db.one(`DELETE FROM floors WHERE id=$1 RETURNING id`, [id])
      return { ok: true }
    })

    scope.post('/api/admin/tables', async (req) => {
      requireRole(user(req), ['manager'])
      const body = z
        .object({
          floorId: z.number().int().positive(),
          name: z.string().min(1).max(30).optional(),
          seats: z.number().int().min(1).max(30).default(4),
          shape: z.enum(['square', 'round', 'rect']).default('square'),
          x: z.number().int().min(0).max(CANVAS_W).default(60),
          y: z.number().int().min(0).max(CANVAS_H).default(60),
        })
        .parse(req.body)
      const size = body.shape === 'rect' ? { w: 170, h: 110 } : { w: 120, h: 110 }
      const count = await db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM tables WHERE floor_id=$1 AND active=true`,
        [body.floorId],
      )
      const name = body.name?.trim() || `Masa ${(count?.n ?? 0) + 1}`
      return db.one(
        `INSERT INTO tables (floor_id, name, seats, shape, x, y, w, h, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [body.floorId, name, body.seats, body.shape, body.x, body.y, size.w, size.h, (count?.n ?? 0) + 1],
      )
    })

    scope.patch('/api/admin/tables/:id', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const body = z
        .object({
          name: z.string().min(1).max(30).optional(),
          seats: z.number().int().min(1).max(30).optional(),
          shape: z.enum(['square', 'round', 'rect']).optional(),
          floorId: z.number().int().positive().optional(),
        })
        .parse(req.body)
      const current = await db.one<any>(`SELECT * FROM tables WHERE id=$1`, [id])
      if (!current) {
        const e: any = new Error('Masa bulunamadı')
        e.statusCode = 404
        throw e
      }
      const shape = body.shape ?? current.shape
      const size =
        body.shape && body.shape !== current.shape
          ? body.shape === 'rect'
            ? { w: 170, h: 110 }
            : { w: 120, h: 110 }
          : { w: current.w, h: current.h }
      return db.one(
        `UPDATE tables SET name=$1, seats=$2, shape=$3, floor_id=$4, w=$5, h=$6 WHERE id=$7 RETURNING *`,
        [body.name ?? current.name, body.seats ?? current.seats, shape, body.floorId ?? current.floor_id, size.w, size.h, id],
      )
    })

    scope.delete('/api/admin/tables/:id', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const open = await db.one<{ c: number }>(
        `SELECT count(*)::int AS c FROM orders WHERE table_id=$1 AND status='open'`,
        [id],
      )
      if (open && open.c > 0) {
        const e: any = new Error('Masada açık adisyon var — önce ödemeyi al')
        e.statusCode = 400
        throw e
      }
      await db.one(`UPDATE tables SET active=false WHERE id=$1 RETURNING id`, [id])
      return { ok: true }
    })

    // Sürükle-bırak sonrası toplu konum kaydı
    scope.put('/api/admin/layout', async (req) => {
      requireRole(user(req), ['manager'])
      const body = z
        .object({
          floorId: z.number().int().positive(),
          tables: z
            .array(
              z.object({
                id: z.number().int().positive(),
                x: z.number().int(),
                y: z.number().int(),
                w: z.number().int().min(60).max(400),
                h: z.number().int().min(60).max(400),
                shape: z.enum(['square', 'round', 'rect']).optional(),
              }),
            )
            .max(200),
        })
        .parse(req.body)

      for (const t of body.tables) {
        const x = Math.max(0, Math.min(t.x, CANVAS_W - t.w))
        const y = Math.max(0, Math.min(t.y, CANVAS_H - t.h))
        await db.one(
          `UPDATE tables SET x=$1, y=$2, w=$3, h=$4, shape=COALESCE($5, shape)
           WHERE id=$6 AND floor_id=$7 RETURNING id`,
          [x, y, t.w, t.h, t.shape ?? null, t.id, body.floorId],
        )
      }
      broadcast()
      return { ok: true, saved: body.tables.length }
    })

    // ---------- ürün görseli ----------
    const IMAGE_TYPES: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    }

    scope.post('/api/admin/products/:id/image', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const product = await db.one<any>(`SELECT id, name, image_url FROM products WHERE id=$1`, [id])
      if (!product) {
        const e: any = new Error('Ürün bulunamadı')
        e.statusCode = 404
        throw e
      }
      const file = await (req as any).file()
      if (!file) {
        const e: any = new Error('Dosya gelmedi')
        e.statusCode = 400
        throw e
      }
      const ext = IMAGE_TYPES[file.mimetype]
      if (!ext) {
        const e: any = new Error('Sadece JPEG, PNG veya WEBP yüklenebilir')
        e.statusCode = 400
        throw e
      }
      const dir = path.join(process.cwd(), 'var', 'uploads', 'products')
      await mkdir(dir, { recursive: true })
      const filename = `p${id}-${Date.now()}.${ext}`
      await pipeline(file.file, createWriteStream(path.join(dir, filename)))
      const url = `/uploads/products/${filename}`
      await db.one(`UPDATE products SET image_url=$1 WHERE id=$2 RETURNING id`, [url, id])
      if (product.image_url?.startsWith('/uploads/')) {
        const old = path.join(process.cwd(), 'var', product.image_url.replace(/^\/uploads\//, 'uploads/'))
        unlink(old).catch(() => {})
      }
      return { ok: true, imageUrl: url }
    })

    scope.delete('/api/admin/products/:id/image', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const product = await db.one<any>(`SELECT image_url FROM products WHERE id=$1`, [id])
      await db.one(`UPDATE products SET image_url=NULL WHERE id=$1 RETURNING id`, [id])
      if (product?.image_url?.startsWith('/uploads/')) {
        const old = path.join(process.cwd(), 'var', product.image_url.replace(/^\/uploads\//, 'uploads/'))
        unlink(old).catch(() => {})
      }
      return { ok: true }
    })

    // ---------- canlı olaylar ----------
    scope.get('/api/events', (req, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      reply.raw.write('retry: 3000\n\n')
      subscribers.add(reply.raw)
      const ping = setInterval(() => {
        try {
          reply.raw.write(': ping\n\n')
        } catch {
          /* yoksay */
        }
      }, 25000)
      req.raw.on('close', () => {
        clearInterval(ping)
        subscribers.delete(reply.raw)
      })
    })
  })

  // ---------- yazıcı köprüsü (LAN; BRIDGE_TOKEN verilirse zorunlu) ----------
  const bridgeGuard = async (req: FastifyRequest, reply: FastifyReply) => {
    const expected = process.env.BRIDGE_TOKEN
    if (!expected) return
    if (req.headers['x-bridge-token'] !== expected) return reply.code(401).send({ error: 'Köprü token hatalı' })
  }

  app.get('/api/print/jobs', { preHandler: bridgeGuard }, async (req) => {
    const { device } = z.object({ device: z.enum(['receipt', 'kitchen']).optional() }).parse(req.query)
    const rows = await db.all<any>(
      `SELECT id, kind, device, payload FROM print_jobs
       WHERE status='queued' ${device ? 'AND device=$1' : ''} ORDER BY id LIMIT 20`,
      device ? [device] : [],
    )
    return rows
  })

  app.post('/api/print/jobs/:id/done', { preHandler: bridgeGuard }, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
    const { ok, error } = z.object({ ok: z.boolean(), error: z.string().optional() }).parse(req.body)
    await db.one(`UPDATE print_jobs SET status=$1, error=$2 WHERE id=$3 RETURNING id`, [ok ? 'printed' : 'failed', error ?? null, id])
    return { ok: true }
  })
}
