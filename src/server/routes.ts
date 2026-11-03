import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { db } from './db/client.ts'
import { charsForPaper } from './print/escpos.ts'
import { describePrinter, normalizePrinter, type PrinterConfig } from './print/routing.ts'
import { hashPin, loginWithPin, logout, requireRole, userForToken, type AuthUser } from './auth.ts'
import {
  allocateDiscount,
  allocatePayment,
  discountAmount,
  lineGross,
  orderTotals,
  vatBreakdown,
  type PaymentDueLine,
  type PricedLine,
} from './money.ts'

let versionCache: { version: string; commit: string } | null = null

/** package.json sürümü + git kısa commit (güncelleme geldi mi diye bakmak için). */
async function appVersion(): Promise<{ version: string; commit: string }> {
  if (versionCache) return versionCache
  let version = '0.0.0'
  let commit = 'bilinmiyor'
  try {
    const pkg = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'))
    version = String(pkg.version ?? '0.0.0')
  } catch {
    /* yoksay */
  }
  try {
    const { stdout } = await promisify(execFile)('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: process.cwd(),
      timeout: 5000,
      windowsHide: true,
    })
    commit = stdout.trim() || 'bilinmiyor'
  } catch {
    /* git yoksa sorun değil */
  }
  versionCache = { version, commit }
  return versionCache
}

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Arayüz tercihleri (settings tablosunda 'prefs' anahtarı). */
type Prefs = {
  vatIncluded: boolean
  productDetail: boolean
  orderDetail: boolean
  tableDetail: boolean
  tableSections: boolean
  paymentPreselect: boolean
  theme: 'light' | 'dark'
}

const DEFAULT_PREFS: Prefs = {
  vatIncluded: true,
  productDetail: true,
  orderDetail: true,
  tableDetail: true,
  tableSections: true,
  paymentPreselect: false,
  theme: 'light',
}

async function getPrefs(): Promise<Prefs> {
  const row = await db.one<any>(`SELECT value FROM settings WHERE key='prefs'`)
  const saved = row?.value ?? {}
  return {
    vatIncluded: saved.vatIncluded !== false,
    productDetail: saved.productDetail !== false,
    orderDetail: saved.orderDetail !== false,
    tableDetail: saved.tableDetail !== false,
    tableSections: saved.tableSections !== false,
    paymentPreselect: saved.paymentPreselect === true,
    theme: saved.theme === 'dark' ? 'dark' : 'light',
  }
}

async function savePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  const next = { ...(await getPrefs()), ...patch }
  await db.run(
    `INSERT INTO settings (key, value) VALUES ('prefs', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value=$1::jsonb`,
    [JSON.stringify(next)],
  )
  return next
}

/** Tüm yazıcı tanımları (rol sırasıyla). */
const listPrinters = () => db.all<PrinterConfig>(`SELECT * FROM printers ORDER BY device, id`)

/** Bu rol için aktif yazıcı var mı? Yoksa iş kuyruğa hiç girmez. */
async function hasPrinter(device: 'receipt' | 'kitchen'): Promise<boolean> {
  const row = await db.one(`SELECT 1 AS ok FROM printers WHERE device=$1 AND enabled LIMIT 1`, [device])
  return Boolean(row)
}

/** PowerShell tam yolu: PATH kısa olduğunda (çift tıklanan .bat) da çalışsın. */
function powershellPath(): string {
  const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
  const full = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(full) ? full : 'powershell.exe'
}

/** HTTP hata yardımcısı: setErrorHandler statusCode'a bakar. */
function httpError(status: number, message: string) {
  const err: any = new Error(message)
  err.statusCode = status
  return err
}

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
  paid_amount: number
  paid_qty: number
  modifiers: { name: string; price: number }[]
  ingredients: { name: string; price: number; mode: 'removed' | 'added' }[]
}

/** Fiş/KOT başlığı: masada ise masa adı, gel al ise müşteri adı. */
function orderLabel(o: { order_type?: string | null; table_name?: string | null; customer_name?: string | null }): string {
  if (o.order_type === 'takeaway') return o.customer_name ? `Gel Al - ${o.customer_name}` : 'Gel Al'
  return o.table_name ?? 'Paket'
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
            COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa
                      JOIN payments p ON p.id = pa.payment_id
                      WHERE pa.line_id = ol.id AND p.order_id = ol.order_id), 0)::int AS paid_amount,
            COALESCE((SELECT SUM(pa.qty) FROM payment_allocations pa
                      JOIN payments p ON p.id = pa.payment_id
                      WHERE pa.line_id = ol.id AND p.order_id = ol.order_id), 0)::int AS paid_qty,
            COALESCE((SELECT json_agg(json_build_object('id', lm.modifier_id, 'name', lm.name, 'price', lm.price) ORDER BY lm.id)
                      FROM line_modifiers lm WHERE lm.line_id = ol.id), '[]'::json) AS modifiers,
            COALESCE((SELECT json_agg(json_build_object('name', li.name, 'price', li.price, 'mode', li.mode) ORDER BY li.id)
                      FROM line_ingredients li WHERE li.line_id = ol.id), '[]'::json) AS ingredients
     FROM order_lines ol
     WHERE ol.order_id = $1 AND ol.status <> 'void'
     ORDER BY ol.id`,
    [orderId],
  )
  const payments = await db.all(
    `SELECT id, method, amount, tendered, change_amount, created_at FROM payments WHERE order_id = $1 ORDER BY id`,
    [orderId],
  )
  const live: PricedLine[] = lines.map((l) => ({
    qty: l.qty,
    unitPrice: l.unit_price,
    vatRate: l.vat_rate,
    modifiers: l.modifiers,
    ingredients: (l.ingredients ?? []).filter((i) => i.mode === 'added'),
  }))
  const grossByLine = live.map((l) => lineGross(l))
  const grossTotal = grossByLine.reduce((sum, gross) => sum + gross, 0)
  const discount = {
    type: (order.discount_type ?? 'none') as 'none' | 'percent' | 'fixed',
    value: Number(order.discount_value ?? 0),
  }
  const appliedDiscount = Math.min(Number(order.discount_amount ?? discountAmount(grossTotal, discount)), grossTotal)
  const discountParts = allocateDiscount(grossByLine, appliedDiscount)
  const discountedVatLines = vatBreakdown(
    live.map((line, index) => ({ gross: grossByLine[index] - discountParts[index], rate: line.vatRate })),
  )
  const total = discountedVatLines.reduce((sum, line) => sum + line.gross, 0)
  const vat = discountedVatLines.reduce((sum, line) => sum + line.vat, 0)
  const totals = { subtotal: total - vat, vat, total, vatLines: discountedVatLines }
  const paid = payments.reduce((s: number, p: any) => s + Number(p.amount), 0)
  const decoratedLines = lines.map((line, index) => {
    const paidAmount = Number(line.paid_amount ?? 0)
    const lineTotal = grossByLine[index] - discountParts[index]
    const remainingAmount = Math.max(0, lineTotal - paidAmount)
    const paidQty = Math.min(line.qty, Number(line.paid_qty ?? 0))
    return {
      ...line,
      paid_amount: paidAmount,
      paid_qty: paidQty,
      gross_amount: grossByLine[index],
      discount_amount: discountParts[index],
      remaining_amount: remainingAmount,
      payment_status: paidQty >= line.qty || remainingAmount === 0 ? 'paid' : paidQty > 0 || paidAmount > 0 ? 'partial' : 'unpaid',
    }
  })
  return {
    ...order,
    lines: decoratedLines,
    payments,
    totals,
    paid,
    remaining: Math.max(0, total - paid),
    discount: { ...discount, amount: appliedDiscount },
  }
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

  // ---------- sürüm (giriş gerektirmez) ----------
  app.get('/api/version', async () => appVersion())

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
        `SELECT o.id, o.table_id, o.order_type, o.customer_name, o.customer_phone,
                o.guest_count, o.opened_at, o.status,
                COALESCE(SUM((ol.unit_price
                  + COALESCE((SELECT SUM(lm.price) FROM line_modifiers lm WHERE lm.line_id = ol.id), 0)
                  + COALESCE((SELECT SUM(li.price) FROM line_ingredients li WHERE li.line_id = ol.id AND li.mode = 'added'), 0)
                ) * ol.qty), 0)::int AS total,
                COUNT(ol.id) FILTER (WHERE ol.status = 'sent')::int AS sent_lines,
                COUNT(ol.id)::int AS line_count
         FROM orders o
         LEFT JOIN order_lines ol ON ol.order_id = o.id AND ol.status <> 'void'
         WHERE o.status = 'open'
         GROUP BY o.id`,
      )
      const categories = await db.all<any>(`SELECT id, name, emoji, image_url FROM categories ORDER BY sort, id`)
      const products = await db.all<any>(
        `SELECT id, category_id, name, vat_rate, image_url, description
         FROM products WHERE active = true AND deleted_at IS NULL ORDER BY sort, id`,
      )
      const ingredients = await db.all<any>(
        `SELECT id, product_id, name, price, included FROM product_ingredients WHERE active = true ORDER BY sort, id`,
      )
      const variants = await db.all<any>(
        `SELECT id, product_id, name, price FROM variants WHERE active = true ORDER BY sort, id`,
      )
      const groups = await db.all<any>(`SELECT id, name, min_sel, max_sel FROM modifier_groups ORDER BY sort, id`)
      const mods = await db.all<any>(`SELECT id, group_id, name, price FROM modifiers WHERE active = true ORDER BY sort, id`)
      const pmg = await db.all<any>(`SELECT product_id, group_id FROM product_modifier_groups`)
      const shift = await openShift()

      const orderByTable = new Map(openOrders.filter((o) => o.table_id).map((o) => [o.table_id, o]))
      return {
        me,
        version: await appVersion(),
        prefs: await getPrefs(),
        outlet: outlet?.value ?? {},
        shift,
        // Masaya bağlı olmayan gel al adisyonları
        takeaway: openOrders.filter((o) => o.order_type === 'takeaway'),
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
          imageUrl: c.image_url,
          products: products
            .filter((p) => p.category_id === c.id)
            .map((p) => ({
              id: p.id,
              name: p.name,
              vatRate: p.vat_rate,
              imageUrl: p.image_url,
              description: p.description,
              ingredients: ingredients
                .filter((i) => i.product_id === p.id)
                .map((i) => ({ id: i.id, name: i.name, price: i.price, included: i.included })),
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
      const { tableId, guestCount = 1, note, orderType = 'dine_in', customerName, customerPhone } = z
        .object({
          tableId: z.number().int().positive().nullish(),
          guestCount: z.number().int().min(1).max(30).default(1),
          note: z.string().max(200).optional(),
          orderType: z.enum(['dine_in', 'takeaway']).default('dine_in'),
          customerName: z.string().trim().max(60).optional(),
          customerPhone: z.string().trim().max(24).optional(),
        })
        .parse(req.body)

      const shift = await openShift()

      // ---- Gel al: masa yok, müşteri adı/telefon opsiyonel ----
      if (orderType === 'takeaway') {
        const order = await db.one<any>(
          `INSERT INTO orders (table_id, shift_id, opened_by, guest_count, note, order_type, customer_name, customer_phone)
           VALUES (NULL,$1,$2,1,$3,'takeaway',$4,$5) RETURNING *`,
          [shift?.id ?? null, user(req).id, note ?? null, customerName || null, customerPhone || null],
        )
        broadcast()
        return order
      }

      if (!tableId) {
        const e: any = new Error('Masa seçilmedi')
        e.statusCode = 400
        throw e
      }
      const table = await db.one(`SELECT id FROM tables WHERE id=$1 AND active=true`, [tableId])
      if (!table) {
        const e: any = new Error('Masa bulunamadı')
        e.statusCode = 404
        throw e
      }
      const existing = await db.one<{ id: number }>(`SELECT id FROM orders WHERE table_id=$1 AND status='open'`, [tableId])
      if (existing) return { id: existing.id, existing: true }
      const order = await db.one<any>(
        `INSERT INTO orders (table_id, shift_id, opened_by, guest_count, note, order_type) VALUES ($1,$2,$3,$4,$5,'dine_in') RETURNING *`,
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
          ingredients: z
            .array(z.object({ id: z.number().int(), mode: z.enum(['removed', 'added']) }))
            .default([]),
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
      if (product.active === false) {
        const e: any = new Error(`${product.name} şu an pasif — siparişe eklenemez`)
        e.statusCode = 400
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

        if (body.ingredients.length) {
          const ids = body.ingredients.map((i) => i.id)
          const rows = await tx.all<any>(
            `SELECT id, name, price, included FROM product_ingredients
             WHERE product_id = $1 AND active = true AND id = ANY($2::int[])`,
            [product.id, `{${ids.join(',')}}`],
          )
          for (const choice of body.ingredients) {
            const ing = rows.find((r) => r.id === choice.id)
            if (!ing) continue
            await tx.one(
              `INSERT INTO line_ingredients (line_id, ingredient_id, name, mode, price)
               VALUES ($1,$2,$3,$4,$5) RETURNING id`,
              [line!.id, ing.id, ing.name, choice.mode, choice.mode === 'added' ? ing.price : 0],
            )
          }
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
        if (await hasPrinter('kitchen')) {
          const order = await db.one<any>(
            `SELECT o.id, o.order_type, o.customer_name, t.name AS table_name
             FROM orders o LEFT JOIN tables t ON t.id=o.table_id WHERE o.id=$1`,
            [line.order_id],
          )
          await db.one(
            `INSERT INTO print_jobs (kind, device, order_id, payload) VALUES ('cancel','kitchen',$1,$2) RETURNING id`,
            [
              line.order_id,
              JSON.stringify({
                orderId: line.order_id,
                tableName: order ? orderLabel(order) : 'Paket',
                staffName: user(req).name,
                timeISO: new Date().toISOString(),
                scope: 'line',
                reason: 'Ürün iptali',
                lines: [{ name: line.name, qty: line.qty, note: line.note }],
              }),
            ],
          )
        }
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
      if (await hasPrinter('kitchen')) await db.one(
        `INSERT INTO print_jobs (kind, device, order_id, payload) VALUES ('kot','kitchen',$1,$2) RETURNING id`,
        [
          id,
          JSON.stringify({
            orderId: order.id,
            tableName: orderLabel(order),
            staffName: order.staff_name,
            timeISO: new Date().toISOString(),
            lines: newLines.map((l: LineRow) => ({
              name: l.name,
              qty: l.qty,
              note: l.note,
              modifiers: l.modifiers.map((m) => m.name),
              removed: (l.ingredients ?? []).filter((i) => i.mode === 'removed').map((i) => i.name),
              added: (l.ingredients ?? []).filter((i) => i.mode === 'added').map((i) => i.name),
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

    /** İki açık adisyonu birleştir: kaynak satırlar hedefe taşınır, kaynak iptal olur. */
    scope.post('/api/orders/:id/merge', async (req) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const { targetOrderId } = z.object({ targetOrderId: z.number().int() }).parse(req.body)
      if (id === targetOrderId) throw httpError(400, 'Aynı adisyon birleştirilemez')

      const src = await db.one<any>(`SELECT id, status FROM orders WHERE id=$1`, [id])
      const dst = await db.one<any>(`SELECT id, status FROM orders WHERE id=$1`, [targetOrderId])
      if (!src || !dst) throw httpError(404, 'Adisyon bulunamadı')
      if (src.status !== 'open' || dst.status !== 'open') throw httpError(400, 'Yalnızca açık adisyonlar birleştirilir')

      const paid = await db.one<{ c: number }>(`SELECT count(*)::int AS c FROM payments WHERE order_id=$1`, [id])
      if (paid && paid.c > 0) throw httpError(400, 'Ödeme alınmış adisyon birleştirilemez')

      await db.run(`UPDATE order_lines SET order_id=$1 WHERE order_id=$2`, [targetOrderId, id])
      await db.run(
        `UPDATE orders SET status='void', closed_at=now(), void_reason=$1, voided_by=$2, voided_at=now() WHERE id=$3`,
        [`Adisyon #${targetOrderId} ile birlestirildi`, user(req).id, id],
      )
      broadcast()
      return loadOrder(targetOrderId)
    })

    /** Ön hesap (ödenmemiş adisyon) fişini kasa yazıcısına gönderir. */
    scope.post('/api/orders/:id/print', async (req) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const order = await loadOrder(id)
      if (!order) throw httpError(404, 'Adisyon bulunamadı')
      if (order.status !== 'open') throw httpError(400, 'Adisyon açık değil')
      if (!(await hasPrinter('receipt'))) throw httpError(400, 'Kasa yazıcısı tanımlı değil (Yönetim → Yazıcılar)')

      const meta = (await db.one<any>(`SELECT value FROM settings WHERE key='outlet'`))?.value ?? {}
      const prefs = await getPrefs()
      await db.run(
        `INSERT INTO print_jobs (kind, device, order_id, payload) VALUES ('receipt','receipt',$1,$2)`,
        [
          id,
          JSON.stringify({
            outletName: meta.name ?? 'Soprano',
            orderId: id,
            tableName: order.table_name ?? `Adisyon #${id}`,
            staffName: order.staff_name ?? user(req).name,
            customerName: order.customer_name ?? null,
            dateISO: new Date().toISOString(),
            lines: order.lines.map((line: any) => ({
              name: line.name,
              qty: line.qty,
              unitPrice: line.unit_price,
              modifiers: (line.modifiers ?? []).map((m: any) => m.name),
              removed: (line.ingredients ?? []).filter((i: any) => i.mode === 'removed').map((i: any) => i.name),
              added: (line.ingredients ?? []).filter((i: any) => i.mode === 'added').map((i: any) => i.name),
              total:
                (line.unit_price +
                  (line.modifiers ?? []).reduce((s: number, m: any) => s + m.price, 0) +
                  (line.ingredients ?? []).filter((i: any) => i.mode === 'added').reduce((s: number, i: any) => s + i.price, 0)) *
                line.qty,
            })),
            showVat: prefs.vatIncluded,
            subtotal: order.totals.subtotal,
            vatLines: order.totals.vatLines,
            total: order.totals.total,
            payments: [],
            change: 0,
            footer: `${meta.footer ?? ''}${meta.footer ? ' · ' : ''}ON HESAP - ODEME ALINMADI`,
          }),
        ],
      )
      broadcast('print')
      return { ok: true }
    })

    // Yanlış açılan adisyonu iptal et (yönetici, ödeme alınmamışsa)
    scope.post('/api/orders/:id/void', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body)
      const order = await db.one<any>(
        `SELECT o.*, t.name AS table_name FROM orders o LEFT JOIN tables t ON t.id=o.table_id WHERE o.id=$1`,
        [id],
      )
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
      await db.one(
        `UPDATE orders SET status='void', closed_at=now(), void_reason=$1, voided_by=$2, voided_at=now()
         WHERE id=$3 RETURNING id`,
        [reason, user(req).id, id],
      )

      // Mutfağa "bu adisyon iptal" fişi gitsin ki hazırlık durdurulsun.
      if (await hasPrinter('kitchen')) {
        const lines = await db.all<any>(
          `SELECT ol.name, ol.qty, ol.note FROM order_lines ol
           WHERE ol.order_id=$1 AND ol.status <> 'void' ORDER BY ol.id`,
          [id],
        )
        const total = await db.one<{ total: number }>(
          `SELECT COALESCE(SUM((ol.unit_price
             + COALESCE((SELECT SUM(m.price) FROM line_modifiers lm JOIN modifiers m ON m.id=lm.modifier_id WHERE lm.line_id=ol.id), 0)
             + COALESCE((SELECT SUM(li.price) FROM line_ingredients li WHERE li.line_id=ol.id AND li.mode='added'), 0)
           ) * ol.qty), 0)::int AS total
           FROM order_lines ol WHERE ol.order_id=$1 AND ol.status <> 'void'`,
          [id],
        )
        await db.one(
          `INSERT INTO print_jobs (kind, device, order_id, payload) VALUES ('cancel','kitchen',$1,$2) RETURNING id`,
          [
            id,
            JSON.stringify({
              orderId: id,
              tableName: orderLabel(order),
              staffName: user(req).name,
              timeISO: new Date().toISOString(),
              scope: 'order',
              reason,
              total: total?.total ?? 0,
              lines: lines.map((l) => ({ name: l.name, qty: l.qty, note: l.note })),
            }),
          ],
        )
      }

      broadcast()
      return { ok: true, orderId: id }
    })

    scope.post('/api/orders/:id/pay', async (req) => {
      requireRole(user(req), ['cashier', 'manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const body = z
        .object({
          payments: z
            .array(
              z.object({
                method: z.enum(['cash', 'card', 'other']),
                amount: z.number().int().positive(),
                tendered: z.number().int().positive().optional(),
                allocations: z
                  .array(z.object({ lineId: z.number().int(), qty: z.number().int().positive() }))
                  .default([]),
              }),
            )
            .min(1),
          discount: z
            .object({ type: z.enum(['none', 'percent', 'fixed']), value: z.number().int().min(0) })
            .optional(),
          customerName: z.string().max(120).nullable().optional(),
        })
        .parse(req.body)
      const order = await loadOrder(id)
      if (!order || order.status !== 'open') {
        const e: any = new Error('Adisyon açık değil')
        e.statusCode = 400
        throw e
      }

      const fail = (message: string, statusCode = 400): never => {
        const e: any = new Error(message)
        e.statusCode = statusCode
        throw e
      }
      const grossLines = order.lines.map((line: any) =>
        lineGross({
          qty: line.qty,
          unitPrice: line.unit_price,
          vatRate: line.vat_rate,
          modifiers: line.modifiers,
          ingredients: (line.ingredients ?? []).filter((i: any) => i.mode === 'added'),
        }),
      )
      const grossTotal = grossLines.reduce((sum: number, value: number) => sum + value, 0)
      const hasExistingPayments = order.payments.length > 0
      const storedDiscount = order.discount ?? { type: 'none', value: 0, amount: 0 }
      const requestedDiscount = body.discount ?? {
        type: storedDiscount.type as 'none' | 'percent' | 'fixed',
        value: Number(storedDiscount.value ?? 0),
      }
      if (
        hasExistingPayments &&
        body.discount &&
        (body.discount.type !== storedDiscount.type || body.discount.value !== Number(storedDiscount.value ?? 0))
      ) {
        fail('Parçalı ödeme başladıktan sonra iskonto değiştirilemez')
      }
      const appliedDiscount = discountAmount(grossTotal, requestedDiscount)
      const discountParts = allocateDiscount(grossLines, appliedDiscount)
      const total = grossTotal - appliedDiscount
      const oldPaid = Number(order.paid ?? 0)
      const dueLines: PaymentDueLine[] = order.lines.map((line: any, index: number) => ({
        lineId: line.id,
        due: Math.max(0, grossLines[index] - discountParts[index] - Number(line.paid_amount ?? 0)),
        qty: Math.max(0, line.qty - Number(line.paid_qty ?? 0)),
      }))

      // Eski payload'lar allocations göndermiyorsa tam borç davranışını koru.
      const hasAllocations = body.payments.some((payment) => payment.allocations.length > 0)
      const requestedTendered = body.payments.reduce((sum, payment) => sum + (payment.tendered ?? payment.amount), 0)
      if (!hasAllocations && oldPaid + requestedTendered < total) fail('Ödeme tutarı yetersiz')

      const finalVatLines = vatBreakdown(
        order.lines.map((line: any, index: number) => ({ gross: grossLines[index] - discountParts[index], rate: line.vat_rate })),
      )
      const finalVat = finalVatLines.reduce((sum, line) => sum + line.vat, 0)
      const finalTotals = { subtotal: total - finalVat, vat: finalVat, total, vatLines: finalVatLines }
      const paymentRows: { method: 'cash' | 'card' | 'other'; amount: number }[] = []
      let totalApplied = 0
      let totalChange = 0
      const customerName = body.customerName?.trim() || null
      const meta = (await db.one<any>(`SELECT value FROM settings WHERE key='outlet'`))?.value ?? {}

      await db.tx(async (tx) => {
        const workingDue = dueLines.map((line) => ({ ...line }))
        for (const payment of body.payments) {
          const tendered = payment.method === 'cash' ? payment.tendered ?? payment.amount : payment.amount
          if (payment.method === 'cash' && tendered < payment.amount) fail('Nakit alınan tutar, ödeme tutarından küçük olamaz')
          const selected = payment.allocations.length
            ? [...new Map(payment.allocations.map((item) => [item.lineId, item])).values()]
            : workingDue.filter((line) => line.due > 0).map((line) => ({ lineId: line.lineId, qty: line.qty }))
          const allocations = allocatePayment(workingDue, payment.amount, selected)
          const applied = allocations.reduce((sum, allocation) => sum + allocation.amount, 0)
          if (applied <= 0) fail('Ödenecek ürün seçilmedi veya satırın borcu kalmadı')
          if (payment.method !== 'cash' && applied !== payment.amount) fail('Kart tutarı seçili ürün borcunu aşamaz')
          const change = payment.method === 'cash' ? Math.max(0, tendered - applied) : 0
          const inserted = await tx.one<any>(
            `INSERT INTO payments (order_id, method, amount, tendered, change_amount, taken_by)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [id, payment.method, applied, tendered, change, user(req).id],
          )
          for (const allocation of allocations) {
            await tx.one(
              `INSERT INTO payment_allocations (payment_id, line_id, qty, amount) VALUES ($1,$2,$3,$4) RETURNING id`,
              [inserted.id, allocation.lineId, allocation.qty, allocation.amount],
            )
            const due = workingDue.find((line) => line.lineId === allocation.lineId)
            if (due) {
              const unitDue = Math.max(1, Math.floor((due.due + allocation.amount) / Math.max(1, due.qty)))
              due.due = Math.max(0, due.due - allocation.amount)
              due.qty = Math.max(0, due.qty - Math.min(due.qty, Math.floor(allocation.amount / unitDue)))
            }
          }
          paymentRows.push({ method: payment.method, amount: applied })
          totalApplied += applied
          totalChange += change
        }

        if (!hasExistingPayments) {
          await tx.one(
            `UPDATE orders SET customer_name=COALESCE($1, customer_name), discount_type=$2, discount_value=$3,
             discount_amount=$4, discounted_by=$5, discounted_at=CASE WHEN $4 > 0 THEN now() ELSE NULL END
             WHERE id=$6 RETURNING id`,
            [customerName, requestedDiscount.type, requestedDiscount.value, appliedDiscount, appliedDiscount > 0 ? user(req).id : null, id],
          )
        } else if (customerName) {
          await tx.one(`UPDATE orders SET customer_name=$1 WHERE id=$2 RETURNING id`, [customerName, id])
        }

        const newPaid = oldPaid + totalApplied
        const nextStatus = newPaid >= total ? 'paid' : 'open'
        await tx.one(
          `UPDATE orders SET status=$1, closed_at=CASE WHEN $1='paid' THEN now() ELSE closed_at END WHERE id=$2 RETURNING id`,
          [nextStatus, id],
        )
        if (nextStatus === 'paid') {
          const receiptPrinter = await tx.one(`SELECT 1 AS ok FROM printers WHERE device='receipt' AND enabled LIMIT 1`)
          if (receiptPrinter) await tx.one(
            `INSERT INTO print_jobs (kind, device, order_id, payload) VALUES ('receipt','receipt',$1,$2) RETURNING id`,
            [
              id,
              JSON.stringify({
                outletName: meta.name ?? 'Soprano',
                orderId: order.id,
                tableName: orderLabel(order),
                staffName: user(req).name,
                customerName: customerName ?? order.customer_name ?? null,
                discount: { type: requestedDiscount.type, value: requestedDiscount.value, amount: appliedDiscount },
                dateISO: new Date().toISOString(),
                lines: order.lines.map((line: LineRow) => ({
                  name: line.name,
                  qty: line.qty,
                  unitPrice: line.unit_price,
                  modifiers: line.modifiers.map((m) => m.name),
                  removed: (line.ingredients ?? []).filter((i) => i.mode === 'removed').map((i) => i.name),
                  added: (line.ingredients ?? []).filter((i) => i.mode === 'added').map((i) => i.name),
                  total:
                    (line.unit_price +
                      line.modifiers.reduce((s, m) => s + m.price, 0) +
                      (line.ingredients ?? []).filter((i) => i.mode === 'added').reduce((s, i) => s + i.price, 0)) *
                    line.qty,
                })),
                showVat: (await getPrefs()).vatIncluded,
                subtotal: finalTotals.subtotal,
                vatLines: finalTotals.vatLines,
                total: finalTotals.total,
                payments: paymentRows,
                change: totalChange,
                footer: meta.footer ?? '',
              }),
            ],
          )
        }
      })
      const status = oldPaid + totalApplied >= total ? 'paid' : 'open'
      broadcast(status === 'paid' ? 'paid' : 'change')
      return { ok: true, change: totalChange, applied: paymentRows, orderId: id, status }
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
        `SELECT count(*)::int AS c,
                COALESCE(SUM(GREATEST(gross_total - discount_amount, 0)),0)::int AS revenue,
                COALESCE(SUM(discount_amount),0)::int AS discount_total
         FROM (
           SELECT o.id, o.discount_amount,
             COALESCE((SELECT SUM((ol.unit_price
               + COALESCE((SELECT SUM(lm.price) FROM line_modifiers lm WHERE lm.line_id=ol.id),0)
               + COALESCE((SELECT SUM(li.price) FROM line_ingredients li WHERE li.line_id=ol.id AND li.mode='added'),0)
             ) * ol.qty) FROM order_lines ol WHERE ol.order_id=o.id AND ol.status<>'void'),0)::int AS gross_total
           FROM orders o
           WHERE o.status='paid' AND o.closed_at::date = $1::date
         ) x`,
        [day],
      )
      const byType = await db.all<any>(
        `SELECT x.order_type, count(*)::int AS orders,
                COALESCE(SUM(GREATEST(x.gross_total - x.discount_amount, 0)), 0)::int AS revenue
         FROM (
           SELECT o.id, o.order_type, o.discount_amount,
             COALESCE((SELECT SUM((ol.unit_price
               + COALESCE((SELECT SUM(lm.price) FROM line_modifiers lm WHERE lm.line_id=ol.id),0)
               + COALESCE((SELECT SUM(li.price) FROM line_ingredients li WHERE li.line_id=ol.id AND li.mode='added'),0)
             ) * ol.qty) FROM order_lines ol WHERE ol.order_id=o.id AND ol.status<>'void'),0)::int AS gross_total
           FROM orders o
           WHERE o.status='paid' AND o.closed_at::date = $1::date
         ) x
         GROUP BY x.order_type`,
        [day],
      )
      const paidOrders = await db.all<any>(
        `SELECT o.id AS order_id, o.order_type, t.name AS table_name, o.customer_name, o.discount_amount,
                GREATEST(o.gross_total - o.discount_amount, 0)::int AS total,
                COALESCE((SELECT string_agg(DISTINCT p.method, ', ' ORDER BY p.method)
                          FROM payments p WHERE p.order_id=o.id), '') AS payment_methods,
                o.closed_at
         FROM (
           SELECT o.*, COALESCE((SELECT SUM((ol.unit_price
             + COALESCE((SELECT SUM(lm.price) FROM line_modifiers lm WHERE lm.line_id=ol.id),0)
             + COALESCE((SELECT SUM(li.price) FROM line_ingredients li WHERE li.line_id=ol.id AND li.mode='added'),0)
           ) * ol.qty) FROM order_lines ol WHERE ol.order_id=o.id AND ol.status<>'void'),0)::int AS gross_total
           FROM orders o WHERE o.status='paid' AND o.closed_at::date=$1::date
         ) o
         LEFT JOIN tables t ON t.id=o.table_id ORDER BY o.closed_at DESC`,
        [day],
      )
      const voidedOrders = await db.all<any>(
        `SELECT o.id AS order_id, t.name AS table_name, o.customer_name, o.discount_amount,
                COALESCE((SELECT SUM((ol.unit_price
                  + COALESCE((SELECT SUM(lm.price) FROM line_modifiers lm WHERE lm.line_id=ol.id),0)
                  + COALESCE((SELECT SUM(li.price) FROM line_ingredients li WHERE li.line_id=ol.id AND li.mode='added'),0)
                ) * ol.qty) FROM order_lines ol WHERE ol.order_id=o.id AND ol.status<>'void'),0)::int AS gross_total,
                GREATEST(COALESCE((SELECT SUM((ol.unit_price
                  + COALESCE((SELECT SUM(lm.price) FROM line_modifiers lm WHERE lm.line_id=ol.id),0)
                  + COALESCE((SELECT SUM(li.price) FROM line_ingredients li WHERE li.line_id=ol.id AND li.mode='added'),0)
                ) * ol.qty) FROM order_lines ol WHERE ol.order_id=o.id AND ol.status<>'void'),0) - o.discount_amount, 0)::int AS total,
                o.void_reason AS reason, u.name AS voided_by, COALESCE(o.voided_at, o.closed_at) AS voided_at
         FROM orders o
         LEFT JOIN tables t ON t.id=o.table_id
         LEFT JOIN users u ON u.id=o.voided_by
         WHERE o.status='void' AND COALESCE(o.voided_at, o.closed_at)::date=$1::date
         ORDER BY COALESCE(o.voided_at, o.closed_at) DESC`,
        [day],
      )
      const topProducts = await db.all<any>(
        `SELECT ol.name, SUM(ol.qty)::int AS qty, SUM((ol.unit_price
           + COALESCE((SELECT SUM(lm.price) FROM line_modifiers lm WHERE lm.line_id=ol.id),0)
           + COALESCE((SELECT SUM(li.price) FROM line_ingredients li WHERE li.line_id=ol.id AND li.mode='added'),0)
         ) * ol.qty)::int AS revenue
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
      return {
        day,
        byMethod,
        orders: orderCount?.c ?? 0,
        revenue: orderCount?.revenue ?? 0,
        discountTotal: orderCount?.discount_total ?? 0,
        paidOrders,
        voidedOrders,
        byType,
        topProducts,
        hourly,
      }
    })

    /** Tarih aralığı raporu: ciro, günlük ortalama, kategori bazlı satış. */
    scope.get('/api/reports/range', async (req) => {
      requireRole(user(req), ['manager'])
      const { from, to } = z
        .object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .parse(req.query)
      if (from > to) throw httpError(400, 'Başlangıç tarihi bitişten sonra olamaz')

      const span = await db.one<{ d: number }>(`SELECT (($2::date - $1::date) + 1)::int AS d`, [from, to])
      const days = Math.max(1, Number(span?.d ?? 1))

      const totals = await db.one<any>(
        `SELECT count(*)::int AS c,
                COALESCE(SUM(GREATEST(gross_total - discount_amount, 0)), 0)::int AS revenue,
                COALESCE(SUM(discount_amount), 0)::int AS discount_total
         FROM (
           SELECT o.id, o.discount_amount,
             COALESCE((SELECT SUM((ol.unit_price
               + COALESCE((SELECT SUM(lm.price) FROM line_modifiers lm WHERE lm.line_id=ol.id),0)
               + COALESCE((SELECT SUM(li.price) FROM line_ingredients li WHERE li.line_id=ol.id AND li.mode='added'),0)
             ) * ol.qty) FROM order_lines ol WHERE ol.order_id=o.id AND ol.status<>'void'),0)::int AS gross_total
           FROM orders o
           WHERE o.status='paid' AND o.closed_at::date BETWEEN $1::date AND $2::date
         ) x`,
        [from, to],
      )

      const byMethod = await db.all<any>(
        `SELECT p.method, SUM(p.amount)::int AS amount, count(*)::int AS count
         FROM payments p
         WHERE p.created_at::date BETWEEN $1::date AND $2::date
         GROUP BY p.method ORDER BY amount DESC`,
        [from, to],
      )

      const byType = await db.all<any>(
        `SELECT o.order_type, count(*)::int AS orders,
                COALESCE(SUM(GREATEST(x.gross_total - o.discount_amount, 0)), 0)::int AS revenue
         FROM orders o
         JOIN (
           SELECT oo.id,
             COALESCE((SELECT SUM((ol.unit_price
               + COALESCE((SELECT SUM(lm.price) FROM line_modifiers lm WHERE lm.line_id=ol.id),0)
               + COALESCE((SELECT SUM(li.price) FROM line_ingredients li WHERE li.line_id=ol.id AND li.mode='added'),0)
             ) * ol.qty) FROM order_lines ol WHERE ol.order_id=oo.id AND ol.status<>'void'),0)::int AS gross_total
           FROM orders oo WHERE oo.status='paid' AND oo.closed_at::date BETWEEN $1::date AND $2::date
         ) x ON x.id = o.id
         GROUP BY o.order_type`,
        [from, to],
      )

      const byCategory = await db.all<any>(
        `SELECT c.id, c.name,
                SUM(ol.qty)::int AS qty,
                SUM((ol.unit_price
                  + COALESCE((SELECT SUM(lm.price) FROM line_modifiers lm WHERE lm.line_id=ol.id),0)
                  + COALESCE((SELECT SUM(li.price) FROM line_ingredients li WHERE li.line_id=ol.id AND li.mode='added'),0)
                ) * ol.qty)::int AS revenue
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
         JOIN products pr ON pr.id = ol.product_id
         JOIN categories c ON c.id = pr.category_id
         WHERE o.status='paid' AND o.closed_at::date BETWEEN $1::date AND $2::date AND ol.status<>'void'
         GROUP BY c.id, c.name ORDER BY revenue DESC`,
        [from, to],
      )

      const topProducts = await db.all<any>(
        `SELECT ol.name, SUM(ol.qty)::int AS qty,
                SUM((ol.unit_price
                  + COALESCE((SELECT SUM(lm.price) FROM line_modifiers lm WHERE lm.line_id=ol.id),0)
                  + COALESCE((SELECT SUM(li.price) FROM line_ingredients li WHERE li.line_id=ol.id AND li.mode='added'),0)
                ) * ol.qty)::int AS revenue
         FROM order_lines ol JOIN orders o ON o.id=ol.order_id
         WHERE o.status='paid' AND o.closed_at::date BETWEEN $1::date AND $2::date AND ol.status<>'void'
         GROUP BY ol.name ORDER BY qty DESC LIMIT 10`,
        [from, to],
      )

      const paidOrders = await db.all<any>(
        `SELECT o.id AS order_id, o.order_type, t.name AS table_name, o.customer_name, o.discount_amount,
                GREATEST(o.gross_total - o.discount_amount, 0)::int AS total,
                COALESCE((SELECT string_agg(DISTINCT p.method, ', ' ORDER BY p.method)
                          FROM payments p WHERE p.order_id=o.id), '') AS payment_methods,
                o.closed_at
         FROM (
           SELECT oo.*, COALESCE((SELECT SUM((ol.unit_price
               + COALESCE((SELECT SUM(lm.price) FROM line_modifiers lm WHERE lm.line_id=ol.id),0)
               + COALESCE((SELECT SUM(li.price) FROM line_ingredients li WHERE li.line_id=ol.id AND li.mode='added'),0)
             ) * ol.qty) FROM order_lines ol WHERE ol.order_id=oo.id AND ol.status<>'void'),0)::int AS gross_total
           FROM orders oo WHERE oo.status='paid' AND oo.closed_at::date BETWEEN $1::date AND $2::date
         ) o
         LEFT JOIN tables t ON t.id = o.table_id
         ORDER BY o.closed_at DESC LIMIT 200`,
        [from, to],
      )

      const voidedOrders = await db.all<any>(
        `SELECT o.id AS order_id, o.order_type, t.name AS table_name, o.customer_name, o.discount_amount,
                COALESCE((SELECT SUM((ol.unit_price) * ol.qty) FROM order_lines ol WHERE ol.order_id=o.id AND ol.status<>'void'),0)::int AS gross_total,
                GREATEST(COALESCE((SELECT SUM((ol.unit_price) * ol.qty) FROM order_lines ol WHERE ol.order_id=o.id AND ol.status<>'void'),0) - o.discount_amount, 0)::int AS total,
                COALESCE(o.void_reason, '—') AS reason,
                (SELECT u.name FROM users u WHERE u.id = o.voided_by) AS voided_by,
                o.voided_at
         FROM orders o
         LEFT JOIN tables t ON t.id = o.table_id
         WHERE o.status='void' AND o.closed_at::date BETWEEN $1::date AND $2::date
         ORDER BY o.closed_at DESC LIMIT 200`,
        [from, to],
      )

      return {
        from,
        to,
        days,
        revenue: totals?.revenue ?? 0,
        orders: totals?.c ?? 0,
        discountTotal: totals?.discount_total ?? 0,
        avgPerDay: Math.round((totals?.revenue ?? 0) / days),
        avgTicket: totals?.c ? Math.round((totals?.revenue ?? 0) / totals.c) : 0,
        byMethod,
        byType,
        byCategory,
        topProducts,
        paidOrders,
        voidedOrders,
      }
    })

    // ---------- yönetim (okuma) ----------
    scope.get('/api/admin/menu', async (req) => {
      requireRole(user(req), ['manager'])
      const products = await db.all<any>(
        `SELECT p.id, p.name, p.vat_rate, p.image_url, p.active, c.name AS category, c.id AS category_id
         FROM products p JOIN categories c ON c.id=p.category_id
         WHERE p.deleted_at IS NULL ORDER BY c.sort, p.sort`,
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

    scope.get('/api/admin/modifier-groups', async (req) => {
      requireRole(user(req), ['manager'])
      const groups = await db.all<any>(`SELECT id, name, min_sel, max_sel FROM modifier_groups ORDER BY sort, id`)
      const mods = await db.all<any>(`SELECT id, group_id, name, price FROM modifiers WHERE active=true ORDER BY sort, id`)
      return groups.map((g) => ({
        id: g.id,
        name: g.name,
        min: g.min_sel,
        max: g.max_sel,
        modifiers: mods.filter((m) => m.group_id === g.id),
      }))
    })

    const groupBody = z.object({
      name: z.string().min(1).max(40),
      min: z.number().int().min(0).max(20).default(0),
      max: z.number().int().min(1).max(30).default(1),
      modifiers: z
        .array(
          z.object({
            id: z.number().int().optional(),
            name: z.string().min(1).max(40),
            price: z.number().int().min(0).max(1_000_000),
          }),
        )
        .max(40)
        .default([]),
    })

    const checkGroup = (body: z.infer<typeof groupBody>) => {
      if (body.max < body.min) {
        const e: any = new Error('En fazla seçim, en az seçimden küçük olamaz')
        e.statusCode = 400
        throw e
      }
      if (body.min > body.modifiers.length) {
        const e: any = new Error('Zorunlu seçim sayısı seçenek sayısından fazla olamaz')
        e.statusCode = 400
        throw e
      }
    }

    scope.post('/api/admin/modifier-groups', async (req) => {
      requireRole(user(req), ['manager'])
      const body = groupBody.parse(req.body)
      checkGroup(body)
      return db.tx(async (tx) => {
        const group = await tx.one<any>(
          `INSERT INTO modifier_groups (name, min_sel, max_sel, sort)
           VALUES ($1,$2,$3,(SELECT COALESCE(MAX(sort),0)+1 FROM modifier_groups)) RETURNING id`,
          [body.name, body.min, body.max],
        )
        let sort = 0
        for (const m of body.modifiers) {
          await tx.one(`INSERT INTO modifiers (group_id, name, price, sort) VALUES ($1,$2,$3,$4) RETURNING id`, [
            group!.id,
            m.name,
            m.price,
            sort++,
          ])
        }
        broadcast()
        return { id: group!.id }
      })
    })

    scope.put('/api/admin/modifier-groups/:id', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const body = groupBody.parse(req.body)
      checkGroup(body)
      const group = await db.one<any>(`SELECT id FROM modifier_groups WHERE id=$1`, [id])
      if (!group) {
        const e: any = new Error('Seçenek grubu bulunamadı')
        e.statusCode = 404
        throw e
      }
      return db.tx(async (tx) => {
        await tx.one(`UPDATE modifier_groups SET name=$1, min_sel=$2, max_sel=$3 WHERE id=$4 RETURNING id`, [
          body.name,
          body.min,
          body.max,
          id,
        ])
        const kept: number[] = []
        let sort = 0
        for (const m of body.modifiers) {
          if (m.id) {
            const row = await tx.one<any>(
              `UPDATE modifiers SET name=$1, price=$2, sort=$3, active=true WHERE id=$4 AND group_id=$5 RETURNING id`,
              [m.name, m.price, sort++, m.id, id],
            )
            if (row) kept.push(row.id)
          } else {
            const row = await tx.one<any>(
              `INSERT INTO modifiers (group_id, name, price, sort) VALUES ($1,$2,$3,$4) RETURNING id`,
              [id, m.name, m.price, sort++],
            )
            kept.push(row!.id)
          }
        }
        // Geçmiş adisyonlar bozulmasın diye silmiyoruz, pasife alıyoruz.
        const existing = await tx.all<{ id: number }>(`SELECT id FROM modifiers WHERE group_id=$1 AND active=true`, [id])
        for (const row of existing) {
          if (!kept.includes(row.id)) {
            await tx.one(`UPDATE modifiers SET active=false WHERE id=$1 RETURNING id`, [row.id])
          }
        }
        broadcast()
        return { ok: true }
      })
    })

    scope.delete('/api/admin/modifier-groups/:id', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const used = await db.one<any>(
        `SELECT count(*)::int AS c FROM line_modifiers lm
         JOIN modifiers m ON m.id = lm.modifier_id WHERE m.group_id=$1`,
        [id],
      )
      if ((used?.c ?? 0) > 0) {
        const e: any = new Error('Bu grup geçmiş adisyonlarda kullanıldığı için silinemez. Seçeneklerini pasife alabilirsin.')
        e.statusCode = 409
        throw e
      }
      await db.one(`DELETE FROM modifier_groups WHERE id=$1 RETURNING id`, [id])
      broadcast()
      return { ok: true }
    })

    // ---------- ürün yönetimi (detaylı) ----------
    const productBody = z.object({
      name: z.string().min(1).max(80),
      categoryId: z.number().int().positive(),
      vatRate: z.number().int().min(0).max(30),
      description: z.string().max(3000).nullable().optional(),
      imageUrl: z.string().max(300).nullable().optional(),
      sizes: z
        .array(z.object({ id: z.number().int().optional(), name: z.string().min(1).max(30), price: z.number().int().min(0) }))
        .min(1)
        .max(10),
      ingredients: z
        .array(
          z.object({
            id: z.number().int().optional(),
            name: z.string().min(1).max(40),
            price: z.number().int().min(0),
            included: z.boolean(),
          }),
        )
        .max(40),
      groupIds: z.array(z.number().int()).max(20),
    })

    scope.get('/api/admin/products/:id', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const product = await db.one<any>(`SELECT * FROM products WHERE id=$1`, [id])
      if (!product) {
        const e: any = new Error('Ürün bulunamadı')
        e.statusCode = 404
        throw e
      }
      const variants = await db.all<any>(
        `SELECT id, name, price FROM variants WHERE product_id=$1 AND active=true ORDER BY sort, id`,
        [id],
      )
      const ingredients = await db.all<any>(
        `SELECT id, name, price, included FROM product_ingredients WHERE product_id=$1 AND active=true ORDER BY sort, id`,
        [id],
      )
      const groups = await db.all<{ group_id: number }>(`SELECT group_id FROM product_modifier_groups WHERE product_id=$1`, [id])
      return {
        id: product.id,
        name: product.name,
        categoryId: product.category_id,
        vatRate: product.vat_rate,
        description: product.description,
        imageUrl: product.image_url,
        sizes: variants,
        ingredients,
        groupIds: groups.map((g) => g.group_id),
      }
    })

    scope.post('/api/admin/products', async (req) => {
      requireRole(user(req), ['manager'])
      const body = productBody.parse(req.body)
      const sortRow = await db.one<{ n: number }>(`SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM products WHERE category_id=$1`, [
        body.categoryId,
      ])
      return db.tx(async (tx) => {
        const product = await tx.one<any>(
          `INSERT INTO products (category_id, name, vat_rate, description, image_url, sort)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [body.categoryId, body.name, body.vatRate, body.description ?? null, body.imageUrl ?? null, sortRow?.n ?? 0],
        )
        let i = 0
        for (const s of body.sizes) {
          await tx.one(`INSERT INTO variants (product_id, name, price, sort) VALUES ($1,$2,$3,$4) RETURNING id`, [
            product!.id,
            s.name,
            s.price,
            i++,
          ])
        }
        i = 0
        for (const ing of body.ingredients) {
          await tx.one(
            `INSERT INTO product_ingredients (product_id, name, price, included, sort) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [product!.id, ing.name, ing.price, ing.included, i++],
          )
        }
        for (const gid of body.groupIds) {
          await tx.one(`INSERT INTO product_modifier_groups (product_id, group_id) VALUES ($1,$2) RETURNING product_id`, [
            product!.id,
            gid,
          ])
        }
        broadcast()
        return product
      })
    })

    /** Ürünü menüde aktif/pasif yapar (malzeme bitince ürünü gizlemek için). */
    scope.patch('/api/admin/products/:id/active', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const { active } = z.object({ active: z.boolean() }).parse(req.body)
      const row = await db.one<any>(
        `UPDATE products SET active=$1 WHERE id=$2 RETURNING id, name, active`,
        [active, id],
      )
      if (!row) throw httpError(404, 'Ürün bulunamadı')
      broadcast('menu')
      return { ok: true, id: row.id, name: row.name, active: row.active }
    })

    scope.put('/api/admin/products/:id', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const body = productBody.parse(req.body)
      const current = await db.one<any>(`SELECT id FROM products WHERE id=$1`, [id])
      if (!current) {
        const e: any = new Error('Ürün bulunamadı')
        e.statusCode = 404
        throw e
      }

      return db.tx(async (tx) => {
        await tx.one(
          `UPDATE products SET category_id=$1, name=$2, vat_rate=$3, description=$4, image_url=$5 WHERE id=$6 RETURNING id`,
          [body.categoryId, body.name, body.vatRate, body.description ?? null, body.imageUrl ?? null, id],
        )

        // boyutlar: gelenler güncellenir, yeni eklenir, olmayanlar pasife alınır
        const keptSizes: number[] = []
        let sort = 0
        for (const s of body.sizes) {
          if (s.id) {
            const row = await tx.one<any>(
              `UPDATE variants SET name=$1, price=$2, sort=$3, active=true WHERE id=$4 AND product_id=$5 RETURNING id`,
              [s.name, s.price, sort++, s.id, id],
            )
            if (row) keptSizes.push(row.id)
          } else {
            const row = await tx.one<any>(
              `INSERT INTO variants (product_id, name, price, sort) VALUES ($1,$2,$3,$4) RETURNING id`,
              [id, s.name, s.price, sort++],
            )
            keptSizes.push(row!.id)
          }
        }
        const allVariants = await tx.all<{ id: number }>(`SELECT id FROM variants WHERE product_id=$1 AND active=true`, [id])
        for (const v of allVariants) {
          if (!keptSizes.includes(v.id)) {
            await tx.one(`UPDATE variants SET active=false WHERE id=$1 RETURNING id`, [v.id])
          }
        }

        // içindekiler
        const keptIng: number[] = []
        sort = 0
        for (const ing of body.ingredients) {
          if (ing.id) {
            const row = await tx.one<any>(
              `UPDATE product_ingredients SET name=$1, price=$2, included=$3, sort=$4, active=true
               WHERE id=$5 AND product_id=$6 RETURNING id`,
              [ing.name, ing.price, ing.included, sort++, ing.id, id],
            )
            if (row) keptIng.push(row.id)
          } else {
            const row = await tx.one<any>(
              `INSERT INTO product_ingredients (product_id, name, price, included, sort) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
              [id, ing.name, ing.price, ing.included, sort++],
            )
            keptIng.push(row!.id)
          }
        }
        const allIng = await tx.all<{ id: number }>(
          `SELECT id FROM product_ingredients WHERE product_id=$1 AND active=true`,
          [id],
        )
        for (const g of allIng) {
          if (!keptIng.includes(g.id)) {
            await tx.one(`UPDATE product_ingredients SET active=false WHERE id=$1 RETURNING id`, [g.id])
          }
        }

        // modifier grupları
        await tx.all(`DELETE FROM product_modifier_groups WHERE product_id=$1`, [id])
        for (const gid of body.groupIds) {
          await tx.one(`INSERT INTO product_modifier_groups (product_id, group_id) VALUES ($1,$2) RETURNING product_id`, [id, gid])
        }

        broadcast()
        return { ok: true, id }
      })
    })

    scope.delete('/api/admin/products/:id', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      await db.one(`UPDATE products SET active=false, deleted_at=now() WHERE id=$1 RETURNING id`, [id])
      broadcast()
      return { ok: true }
    })

    scope.post('/api/admin/categories', async (req) => {
      requireRole(user(req), ['manager'])
      const { name, emoji } = z
        .object({ name: z.string().min(1).max(40), emoji: z.string().max(4).optional() })
        .parse(req.body)
      const sort = await db.one<{ n: number }>(`SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM categories`)
      return db.one(`INSERT INTO categories (name, emoji, sort) VALUES ($1,$2,$3) RETURNING *`, [
        name,
        emoji ?? '🍽',
        sort!.n,
      ])
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

  await app.register(async (scope) => {
    scope.addHook('preHandler', authHook)

    // ---------- yazıcılar ----------
    const printerBody = z.object({
      name: z.string().trim().min(1).max(60),
      device: z.enum(['receipt', 'kitchen']),
      transport: z.enum(['network', 'windows', 'file']),
      address: z.string().trim().min(1).max(200),
      paperWidth: z.union([z.literal(58), z.literal(80)]),
      enabled: z.boolean().default(true),
    })

    scope.get('/api/admin/printers', async (req) => {
      requireRole(user(req), ['manager', 'cashier'])
      const printers = await listPrinters()
      const bridge = (await db.one<any>(`SELECT value FROM settings WHERE key='bridge'`))?.value ?? null
      const jobs = await db.all<any>(
        `SELECT id, kind, device, status, error, printer_name, attempts, created_at
         FROM print_jobs ORDER BY id DESC LIMIT 12`,
      )
      return {
        printers: printers.map((p) => ({ ...p, summary: describePrinter(p), chars: charsForPaper(p.paper_width) })),
        bridge,
        jobs,
      }
    })

    scope.post('/api/admin/printers', async (req) => {
      requireRole(user(req), ['manager'])
      const input = printerBody.parse(req.body)
      let row: ReturnType<typeof normalizePrinter>
      try {
        row = normalizePrinter(input)
      } catch (e: any) {
        throw httpError(400, e.message)
      }
      const saved = await db.tx(async (tx) => {
        if (row.enabled) await tx.run(`UPDATE printers SET enabled=false, updated_at=now() WHERE device=$1`, [row.device])
        return tx.one<PrinterConfig>(
          `INSERT INTO printers (name, device, transport, address, paper_width, enabled)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [row.name, row.device, row.transport, row.address, row.paper_width, row.enabled],
        )
      })
      broadcast()
      return { printer: saved ? { ...saved, summary: describePrinter(saved), chars: charsForPaper(saved.paper_width) } : saved }
    })

    scope.patch('/api/admin/printers/:id', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const input = printerBody.partial().parse(req.body)
      const existing = await db.one<PrinterConfig>(`SELECT * FROM printers WHERE id=$1`, [id])
      if (!existing) throw httpError(404, 'Yazıcı bulunamadı')
      const merged = {
        name: input.name ?? existing.name,
        device: input.device ?? existing.device,
        transport: input.transport ?? existing.transport,
        address: input.address ?? existing.address,
        paperWidth: input.paperWidth ?? existing.paper_width,
        enabled: input.enabled ?? existing.enabled,
      }
      let row: ReturnType<typeof normalizePrinter>
      try {
        row = normalizePrinter(merged as any)
      } catch (e: any) {
        throw httpError(400, e.message)
      }
      const saved = await db.tx(async (tx) => {
        if (row.enabled) {
          await tx.run(`UPDATE printers SET enabled=false, updated_at=now() WHERE device=$1 AND id<>$2`, [row.device, id])
        }
        return tx.one<PrinterConfig>(
          `UPDATE printers SET name=$1, device=$2, transport=$3, address=$4, paper_width=$5, enabled=$6, updated_at=now()
           WHERE id=$7 RETURNING *`,
          [row.name, row.device, row.transport, row.address, row.paper_width, row.enabled, id],
        )
      })
      broadcast()
      return { printer: saved ? { ...saved, summary: describePrinter(saved), chars: charsForPaper(saved.paper_width) } : saved }
    })

    scope.delete('/api/admin/printers/:id', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      await db.run(`DELETE FROM printers WHERE id=$1`, [id])
      broadcast()
      return { ok: true }
    })

    /** Örnek fiş/KOT kuyruğa atar; köprü çalışıyorsa hemen basar. */
    scope.post('/api/admin/printers/:id/test', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const printer = await db.one<PrinterConfig>(`SELECT * FROM printers WHERE id=$1`, [id])
      if (!printer) throw httpError(404, 'Yazıcı bulunamadı')
      const now = new Date().toISOString()
      const kind = printer.device === 'kitchen' ? 'kot' : 'receipt'
      const payload = kind === 'kot'
        ? {
            orderId: 0,
            tableName: 'TEST',
            staffName: user(req).name,
            timeISO: now,
            lines: [{ name: 'Test urunu', qty: 1, modifiers: [], removed: [], added: [] }],
          }
        : {
            outletName: (await db.one<any>(`SELECT value FROM settings WHERE key='outlet'`))?.value?.name ?? 'Soprano',
            orderId: 0,
            tableName: 'TEST',
            staffName: user(req).name,
            dateISO: now,
            lines: [{ name: 'Test urunu', qty: 1, unitPrice: 10000, modifiers: [], total: 10000 }],
            subtotal: 10000,
            vatLines: [{ rate: 10, vat: 909, gross: 10000 }],
            total: 10000,
            payments: [{ method: 'cash', amount: 10000 }],
            change: 0,
            footer: 'TEST FISI — Soprano POS',
          }
      const job = await db.one<any>(
        `INSERT INTO print_jobs (kind, device, payload) VALUES ($1,$2,$3) RETURNING id, created_at`,
        [kind, printer.device, JSON.stringify(payload)],
      )
      return { job, printer: { ...printer, summary: describePrinter(printer) } }
    })

    /** Kurulu Windows yazıcılarını listeler (sunucu Windows'ta çalışıyorsa). */
    scope.get('/api/admin/printers/detect', async (req) => {
      requireRole(user(req), ['manager'])
      const { mode } = z.object({ mode: z.enum(['windows', 'network']).default('windows') }).parse(req.query)
      if (mode === 'network') return { mode, candidates: await scanLanPrinters() }
      if (process.platform !== 'win32') return { mode, available: false, printers: [], reason: 'Sunucu Windows değil' }
      try {
        const { printers, via } = await detectWindowsPrinters()
        return { mode, available: true, via, printers }
      } catch (err: any) {
        const reason = String(err?.message ?? err).slice(0, 220)
        return { mode, available: false, printers: [], reason }
      }
    })
  })


  // ---------- cari (veresiye) hesaplar ----------
  await app.register(async (scope) => {
    scope.addHook('preHandler', authHook)

    const balanceOf = async (customerId: number) => {
      const row = await db.one<{ b: number }>(
        `SELECT COALESCE(SUM(amount), 0)::int AS b FROM customer_ledger WHERE customer_id=$1`,
        [customerId],
      )
      return row?.b ?? 0
    }

    scope.get('/api/customers', async (req) => {
      const { q } = z.object({ q: z.string().trim().max(80).optional() }).parse(req.query)
      const like = q ? `%${q}%` : null
      const rows = await db.all<any>(
        `SELECT c.id, c.name, c.phone, c.note, c.credit_limit, c.created_at,
                COALESCE((SELECT SUM(l.amount) FROM customer_ledger l WHERE l.customer_id=c.id), 0)::int AS balance,
                (SELECT max(l.created_at) FROM customer_ledger l WHERE l.customer_id=c.id) AS last_at
         FROM customers c
         WHERE c.active AND ($1::text IS NULL OR c.name ILIKE $1 OR c.phone ILIKE $1)
         ORDER BY balance DESC, c.name ASC
         LIMIT 300`,
        [like],
      )
      return {
        customers: rows.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          note: c.note,
          creditLimit: c.credit_limit,
          balance: c.balance,
          lastAt: c.last_at,
          createdAt: c.created_at,
        })),
      }
    })

    scope.post('/api/customers', async (req) => {
      requireRole(user(req), ['manager', 'cashier'])
      const body = z
        .object({
          name: z.string().trim().min(2).max(80),
          phone: z.string().trim().max(30).optional().nullable(),
          note: z.string().trim().max(300).optional().nullable(),
          creditLimit: z.number().int().min(0).max(10_000_000).optional(),
        })
        .parse(req.body)
      const phone = body.phone?.replace(/[^0-9+]/g, '') || null
      try {
        const row = await db.one<any>(
          `INSERT INTO customers (name, phone, note, credit_limit) VALUES ($1,$2,$3,$4)
           RETURNING id, name, phone, note, credit_limit, created_at`,
          [body.name, phone, body.note ?? null, body.creditLimit ?? 0],
        )
        broadcast('customers')
        return { customer: { ...row, creditLimit: row.credit_limit, balance: 0 } }
      } catch (e: any) {
        if (String(e?.message ?? '').includes('duplicate')) throw httpError(400, 'Bu telefonla kayıtlı müşteri var')
        throw e
      }
    })

    scope.patch('/api/admin/customers/:id', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const body = z
        .object({
          name: z.string().trim().min(2).max(80).optional(),
          phone: z.string().trim().max(30).optional().nullable(),
          note: z.string().trim().max(300).optional().nullable(),
          creditLimit: z.number().int().min(0).max(10_000_000).optional(),
          active: z.boolean().optional(),
        })
        .parse(req.body)
      const row = await db.one<any>(
        `UPDATE customers SET
           name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           note = COALESCE($3, note),
           credit_limit = COALESCE($4, credit_limit),
           active = COALESCE($5, active)
         WHERE id=$6
         RETURNING id, name, phone, note, credit_limit, active`,
        [
          body.name ?? null,
          body.phone === undefined ? null : body.phone,
          body.note === undefined ? null : body.note,
          body.creditLimit ?? null,
          body.active ?? null,
          id,
        ],
      )
      if (!row) throw httpError(404, 'Müşteri bulunamadı')
      return { customer: row }
    })

    scope.get('/api/customers/:id', async (req) => {
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const customer = await db.one<any>(`SELECT * FROM customers WHERE id=$1`, [id])
      if (!customer) throw httpError(404, 'Müşteri bulunamadı')
      const entries = await db.all<any>(
        `SELECT l.id, l.kind, l.amount, l.method, l.note, l.created_at, l.order_id,
                u.name AS created_by_name,
                COALESCE(t.name, CASE WHEN o.order_type='takeaway' THEN 'Gel Al' END) AS table_name
         FROM customer_ledger l
         LEFT JOIN users u ON u.id = l.created_by
         LEFT JOIN orders o ON o.id = l.order_id
         LEFT JOIN tables t ON t.id = o.table_id
         WHERE l.customer_id=$1
         ORDER BY l.id DESC
         LIMIT 500`,
        [id],
      )
      return {
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          note: customer.note,
          creditLimit: customer.credit_limit,
          balance: await balanceOf(id),
          createdAt: customer.created_at,
        },
        entries: entries.map((e) => ({
          id: e.id,
          kind: e.kind,
          amount: e.amount,
          method: e.method,
          note: e.note,
          orderId: e.order_id,
          tableName: e.table_name,
          createdBy: e.created_by_name,
          createdAt: e.created_at,
        })),
      }
    })

    scope.post('/api/customers/:id/payments', async (req) => {
      requireRole(user(req), ['manager', 'cashier'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const body = z
        .object({
          amount: z.number().int().positive(),
          method: z.enum(['cash', 'card']).default('cash'),
          note: z.string().trim().max(200).optional().nullable(),
        })
        .parse(req.body)
      const customer = await db.one<any>(`SELECT id, name FROM customers WHERE id=$1 AND active`, [id])
      if (!customer) throw httpError(404, 'Müşteri bulunamadı')
      const balance = await balanceOf(id)
      if (balance <= 0) throw httpError(400, 'Bu müşterinin borcu yok')
      const applied = Math.min(body.amount, balance)
      await db.run(
        `INSERT INTO customer_ledger (customer_id, kind, amount, method, note, created_by)
         VALUES ($1, 'payment', $2, $3, $4, $5)`,
        [id, -applied, body.method, body.note ?? null, user(req).id],
      )
      broadcast('customers')
      return { ok: true, applied, balance: balance - applied }
    })

    /** Açık adisyonun kalanını müşterinin carisine yaz (veresiye). */
    scope.post('/api/orders/:id/account', async (req) => {
      requireRole(user(req), ['manager', 'cashier'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const { customerId } = z.object({ customerId: z.number().int() }).parse(req.body)
      const order = await loadOrder(id)
      if (!order) throw httpError(404, 'Adisyon bulunamadı')
      if (order.status !== 'open') throw httpError(400, 'Adisyon açık değil')

      const customer = await db.one<any>(`SELECT * FROM customers WHERE id=$1 AND active`, [customerId])
      if (!customer) throw httpError(404, 'Müşteri bulunamadı')

      const paidRow = await db.one<{ s: number }>(`SELECT COALESCE(SUM(amount),0)::int AS s FROM payments WHERE order_id=$1`, [id])
      const remaining = Math.max(0, order.totals.total - (paidRow?.s ?? 0))
      if (remaining <= 0) throw httpError(400, 'Ödenecek tutar kalmadı')

      const balance = await balanceOf(customerId)
      if (customer.credit_limit > 0 && balance + remaining > customer.credit_limit) {
        throw httpError(400, `Kredi limiti aşılıyor (limit ${customer.credit_limit / 100} ₺, bakiye ${balance / 100} ₺)`)
      }

      await db.run(
        `INSERT INTO payments (order_id, method, amount, tendered, change_amount, taken_by)
         VALUES ($1, 'account', $2, $2, 0, $3)`,
        [id, remaining, user(req).id],
      )
      await db.run(
        `INSERT INTO customer_ledger (customer_id, order_id, kind, amount, note, created_by)
         VALUES ($1, $2, 'sale', $3, $4, $5)`,
        [customerId, id, remaining, orderLabel(order), user(req).id],
      )
      await db.run(`UPDATE orders SET status='paid', closed_at=now(), customer_name=COALESCE(customer_name,$1) WHERE id=$2`, [
        customer.name,
        id,
      ])

      const meta = (await db.one<any>(`SELECT value FROM settings WHERE key='outlet'`))?.value ?? {}
      if (await hasPrinter('receipt')) {
        const prefs = await getPrefs()
        await db.run(
          `INSERT INTO print_jobs (kind, device, order_id, payload) VALUES ('receipt','receipt',$1,$2)`,
          [
            id,
            JSON.stringify({
              outletName: meta.name ?? 'Soprano',
              orderId: id,
              tableName: orderLabel(order),
              staffName: user(req).name,
              customerName: customer.name,
              dateISO: new Date().toISOString(),
              lines: order.lines.map((line: any) => ({
                name: line.name,
                qty: line.qty,
                unitPrice: line.unit_price,
                modifiers: (line.modifiers ?? []).map((m: any) => m.name),
                removed: (line.ingredients ?? []).filter((i: any) => i.mode === 'removed').map((i: any) => i.name),
                added: (line.ingredients ?? []).filter((i: any) => i.mode === 'added').map((i: any) => i.name),
                total:
                  (line.unit_price +
                    (line.modifiers ?? []).reduce((s: number, m: any) => s + m.price, 0) +
                    (line.ingredients ?? []).filter((i: any) => i.mode === 'added').reduce((s: number, i: any) => s + i.price, 0)) *
                  line.qty,
              })),
              showVat: prefs.vatIncluded,
              subtotal: order.totals.subtotal,
              vatLines: order.totals.vatLines,
              total: order.totals.total,
              payments: [{ method: 'account', amount: remaining }],
              change: 0,
              footer: `${meta.footer ?? ''}${meta.footer ? ' · ' : ''}CARI HESABA YAZILDI`,
            }),
          ],
        )
      }

      broadcast('paid')
      return { ok: true, applied: remaining, balance: balance + remaining, order: await loadOrder(id) }
    })

    /** Manuel düzeltme: + borç, - alacak. */
    scope.post('/api/admin/customers/:id/adjust', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const body = z
        .object({ amount: z.number().int(), note: z.string().trim().max(200).optional().nullable() })
        .parse(req.body)
      if (body.amount === 0) throw httpError(400, 'Tutar 0 olamaz')
      const customer = await db.one<any>(`SELECT id FROM customers WHERE id=$1`, [id])
      if (!customer) throw httpError(404, 'Müşteri bulunamadı')
      await db.run(
        `INSERT INTO customer_ledger (customer_id, kind, amount, note, created_by) VALUES ($1,'adjust',$2,$3,$4)`,
        [id, body.amount, body.note ?? null, user(req).id],
      )
      broadcast('customers')
      return { ok: true, balance: await balanceOf(id) }
    })

    scope.get('/api/reports/accounts', async (req) => {
      requireRole(user(req), ['manager', 'cashier'])
      const totals = await db.one<any>(
        `SELECT COALESCE(SUM(bal),0)::int AS total,
                COUNT(*) FILTER (WHERE bal > 0)::int AS debtors,
                COUNT(*) FILTER (WHERE bal < 0)::int AS creditors
         FROM (SELECT customer_id, SUM(amount)::int AS bal FROM customer_ledger GROUP BY customer_id) x`,
      )
      const top = await db.all<any>(
        `SELECT c.id, c.name, c.phone, SUM(l.amount)::int AS balance
         FROM customer_ledger l JOIN customers c ON c.id=l.customer_id
         GROUP BY c.id, c.name, c.phone
         HAVING SUM(l.amount) > 0
         ORDER BY balance DESC
         LIMIT 5`,
      )
      const month = await db.one<any>(
        `SELECT COALESCE(SUM(CASE WHEN kind='sale' THEN amount ELSE 0 END),0)::int AS sales,
                COALESCE(SUM(CASE WHEN kind='payment' THEN -amount ELSE 0 END),0)::int AS collections
         FROM customer_ledger WHERE created_at >= date_trunc('month', now())`,
      )
      return { total: totals?.total ?? 0, debtors: totals?.debtors ?? 0, creditors: totals?.creditors ?? 0, top, month }
    })
  })

  // ---------- ayarlar (arayüz tercihleri) ----------
  await app.register(async (scope) => {
    scope.addHook('preHandler', authHook)

    scope.get('/api/admin/settings', async (req) => {
      requireRole(user(req), ['manager', 'cashier'])
      return { prefs: await getPrefs() }
    })

    scope.put('/api/admin/settings', async (req) => {
      requireRole(user(req), ['manager'])
      const patch = z
        .object({
          vatIncluded: z.boolean().optional(),
          productDetail: z.boolean().optional(),
          orderDetail: z.boolean().optional(),
          tableDetail: z.boolean().optional(),
          tableSections: z.boolean().optional(),
          paymentPreselect: z.boolean().optional(),
          theme: z.enum(['light', 'dark']).optional(),
        })
        .parse(req.body ?? {})
      const prefs = await savePrefs(patch)
      broadcast('settings')
      return { prefs }
    })

    // ---------- kategori görseli ----------
    scope.post('/api/admin/categories/:id/image', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const category = await db.one<any>(`SELECT id, image_url FROM categories WHERE id=$1`, [id])
      if (!category) throw httpError(404, 'Kategori bulunamadı')
      const file = await (req as any).file()
      if (!file) throw httpError(400, 'Dosya gelmedi')
      const ext = IMAGE_TYPES[file.mimetype]
      if (!ext) throw httpError(400, 'Sadece JPEG, PNG veya WEBP yüklenebilir')
      const dir = path.join(process.cwd(), 'var', 'uploads', 'categories')
      await mkdir(dir, { recursive: true })
      const filename = `c${id}-${Date.now()}.${ext}`
      await pipeline(file.file, createWriteStream(path.join(dir, filename)))
      const url = `/uploads/categories/${filename}`
      await db.one(`UPDATE categories SET image_url=$1 WHERE id=$2 RETURNING id`, [url, id])
      if (category.image_url?.startsWith('/uploads/')) {
        const old = path.join(process.cwd(), 'var', category.image_url.replace(/^\/uploads\//, 'uploads/'))
        unlink(old).catch(() => {})
      }
      broadcast('menu')
      return { ok: true, imageUrl: url }
    })

    scope.delete('/api/admin/categories/:id/image', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const category = await db.one<any>(`SELECT image_url FROM categories WHERE id=$1`, [id])
      await db.one(`UPDATE categories SET image_url=NULL WHERE id=$1 RETURNING id`, [id])
      if (category?.image_url?.startsWith('/uploads/')) {
        const old = path.join(process.cwd(), 'var', category.image_url.replace(/^\/uploads\//, 'uploads/'))
        unlink(old).catch(() => {})
      }
      broadcast('menu')
      return { ok: true }
    })
  })

  // ---------- yazıcı köprüsü (LAN; BRIDGE_TOKEN verilirse zorunlu) ----------
  const bridgeGuard = async (req: FastifyRequest, reply: FastifyReply) => {
    const expected = process.env.BRIDGE_TOKEN
    if (!expected) return
    if (req.headers['x-bridge-token'] !== expected) return reply.code(401).send({ error: 'Köprü token hatalı' })
  }

  app.post('/api/print/bridge/heartbeat', { preHandler: bridgeGuard }, async (req) => {
    const value = z.object({ host: z.string().max(120).optional(), platform: z.string().max(60).optional() }).parse(req.body ?? {})
    const status = { host: value.host ?? null, platform: value.platform ?? null, at: new Date().toISOString() }
    await db.run(
      `INSERT INTO settings (key, value) VALUES ('bridge', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value=$1::jsonb`,
      [JSON.stringify(status)],
    )
    return { ok: true }
  })

  app.get('/api/print/jobs', { preHandler: bridgeGuard }, async (req) => {
    const { device } = z.object({ device: z.enum(['receipt', 'kitchen']).optional() }).parse(req.query)
    // Köprü çöktüyse 3 dakikadan eski 'printing' işleri geri al.
    await db.run(`UPDATE print_jobs SET status='queued', claimed_at=NULL
                  WHERE status='printing'
                    AND (claimed_at IS NULL OR claimed_at < now() - interval '3 minutes')`)
    // İşi atomik sahiplen: aynı iş iki kez basılmasın.
    const rows = await db.all<any>(
      `UPDATE print_jobs SET status='printing', claimed_at=now()
       WHERE id IN (
         SELECT id FROM print_jobs WHERE status='queued' ${device ? 'AND device=$1' : ''}
         ORDER BY id LIMIT 20
       ) RETURNING id, kind, device, payload`,
      device ? [device] : [],
    )
    const printers = await listPrinters()
    // Her iş, rolüne tanımlı aktif yazıcıyla birlikte döner; tanımlı değilse null.
    return rows.map((job) => {
      const p = printers.find((x: PrinterConfig) => x.device === job.device && x.enabled)
      return {
        ...job,
        printer: p
          ? { id: p.id, name: p.name, transport: p.transport, address: p.address, paperWidth: p.paper_width }
          : null,
      }
    })
  })

  app.post('/api/print/jobs/:id/done', { preHandler: bridgeGuard }, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
    const { ok, error, printerName } = z
      .object({ ok: z.boolean(), error: z.string().optional(), printerName: z.string().max(120).nullish() })
      .parse(req.body)
    await db.one(
      `UPDATE print_jobs SET status=$1, error=$2, printer_name=$3, attempts=attempts+1 WHERE id=$4 RETURNING id`,
      [ok ? 'printed' : 'failed', error ?? null, printerName ?? null, id],
    )
    broadcast()
    return { ok: true }
  })

  /** Başarısız işi yeniden kuyruğa alır (yazıcı düzeltildikten sonra). */
  await app.register(async (scope) => {
    scope.addHook('preHandler', authHook)

    scope.post('/api/admin/print/jobs/:id/retry', async (req) => {
      requireRole(user(req), ['manager'])
      const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params)
      const job = await db.one<any>(`SELECT id FROM print_jobs WHERE id=$1`, [id])
      if (!job) throw httpError(404, 'İş bulunamadı')
      await db.run(`UPDATE print_jobs SET status='queued', error=NULL, claimed_at=NULL WHERE id=$1`, [id])
      broadcast()
      return { ok: true }
    })
  })
}

type DetectedPrinter = { name: string; driver: string; port: string; status: string }

/** Yazıcı kayıt defteri anahtarı — kaçış hatasını önlemek için parçalardan kurulur. */
const REG_PRINTERS_KEY = ['HKLM', 'SOFTWARE', 'Microsoft', 'Windows NT', 'CurrentVersion', 'Print', 'Printers'].join('\\')

/** PowerShell çıktısını JSON olarak alır; hata olursa stderr'in ilk satırını fırlatır. */
async function runPsJson(command: string): Promise<any[]> {
  try {
    const { stdout } = await promisify(execFile)(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { timeout: 15000, windowsHide: true },
    )
    const raw = stdout.replace(/^\uFEFF/, '').trim()
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch (err: any) {
    const stderr = String(err?.stderr ?? '').trim()
    const raw = stderr.split(/\r?\n/).find((l: string) => l.trim()) ?? String(err?.message ?? err)
    // Node'un "Command failed: <komut>" sarmalını at; gerçek nedeni göster.
    const cleaned = raw
      .replace(/^Command failed:\s*[\s\S]*?(?=(?:\r?\n|$))/, '')
      .replace(/^\s*\+?\s*CategoryInfo.*$/, '')
      .trim()
    throw new Error((cleaned || raw).slice(0, 200))
  }
}

/**
 * Kurulu Windows yazıcılarını üç yolla dener:
 *   1) Get-Printer (PrintManagement modülü)
 *   2) Get-CimInstance Win32_Printer (modül gerekmez, her Win10'da var)
 *   3) Kayıt defteri (reg.exe) — yalnızca isim listesi
 * Biri tutarsa döner; hiçbiri tutmazsa anlaşılır hata verir.
 */
async function detectWindowsPrinters(): Promise<{ printers: DetectedPrinter[]; via: string }> {
  const errors: string[] = []

  const map = (rows: any[], nameKey = 'Name'): DetectedPrinter[] =>
    rows
      .map((r) => ({
        name: String(r?.[nameKey] ?? r?.Name ?? '').trim(),
        driver: String(r?.DriverName ?? '').trim(),
        port: String(r?.PortName ?? '').trim(),
        status: String(r?.PrinterStatus ?? '').trim(),
      }))
      .filter((p) => p.name)

  try {
    const rows = await runPsJson(
      'Get-Printer | Select-Object Name,DriverName,PortName,PrinterStatus | ConvertTo-Json -Compress',
    )
    const printers = map(rows)
    if (printers.length) return { printers, via: 'Get-Printer' }
    errors.push('Get-Printer: yazıcı döndürmedi')
  } catch (e: any) {
    errors.push(`Get-Printer: ${e.message}`)
  }

  try {
    const rows = await runPsJson(
      'Get-CimInstance -ClassName Win32_Printer | Select-Object Name,DriverName,PortName,PrinterStatus | ConvertTo-Json -Compress',
    )
    const printers = map(rows)
    if (printers.length) return { printers, via: 'Win32_Printer' }
    errors.push('Win32_Printer: yazıcı döndürmedi')
  } catch (e: any) {
    errors.push(`Win32_Printer: ${e.message}`)
  }

  try {
    const { stdout } = await promisify(execFile)(
      'reg.exe',
      ['query', REG_PRINTERS_KEY],
      { timeout: 10000, windowsHide: true },
    )
    // reg, alt anahtarları tam yol olarak döndürür (HKEY_LOCAL_MACHINE\...\Printers\<ad>).
    // Kök satırı çıktıdan al: sorgu HKLM kısaltmasıyla yapılsa da çıktı tam adı yazar.
    const rows = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const root = rows.find((line) => line.startsWith('HKEY_')) ?? ''
    const sep = String.fromCharCode(92)
    const prefix = root + sep
    const printers = rows
      .filter((line) => line.startsWith(prefix) && !line.slice(prefix.length).includes(sep))
      .map((line) => line.slice(prefix.length))
      .filter((name) => !/^(Connections|PrinterDefaults|PrinterPorts|Providers|Environments)$/i.test(name))
      .map((name) => ({ name, driver: '', port: '', status: '' }))
    if (printers.length) return { printers, via: 'kayıt defteri' }
    errors.push('kayıt defteri: kayıt yok')
  } catch (e: any) {
    errors.push(`kayıt defteri: ${String(e?.message ?? e).slice(0, 80)}`)
  }

  throw new Error(
    `Yazıcı listesi alınamadı. Yazıcıyı Windows'a ekleyin (Ayarlar → Bluetooth ve cihazlar → Yazıcılar ve tarayıcılar), sonra tekrar deneyin. Ayrıntı: ${errors.join(' | ')}`,
  )
}

/** Yerel ağdaki 9100 portu açık yazıcıları tarar (LAN keşfi). */
async function scanLanPrinters(): Promise<{ ip: string; port: number }[]> {
  const nets = os.networkInterfaces()
  const subnets = new Set<string>()
  for (const list of Object.values(nets)) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue
      const parts = i.address.split('.')
      if (parts.length === 4) subnets.add(parts.slice(0, 3).join('.'))
    }
  }
  const hosts: string[] = []
  for (const base of subnets) for (let n = 1; n <= 254; n++) hosts.push(`${base}.${n}`)

  const probe = (ip: string) =>
    new Promise<{ ip: string; port: number } | null>((resolve) => {
      const socket = net.createConnection({ host: ip, port: 9100 })
      const done = (ok: boolean) => {
        socket.removeAllListeners()
        socket.destroy()
        resolve(ok ? { ip, port: 9100 } : null)
      }
      socket.setTimeout(450, () => done(false))
      socket.once('connect', () => done(true))
      socket.once('error', () => done(false))
    })

  const results: { ip: string; port: number }[] = []
  const queue = [...hosts]
  const workers = Array.from({ length: 64 }, async () => {
    while (queue.length) {
      const ip = queue.shift()
      if (!ip) return
      const hit = await probe(ip)
      if (hit) results.push(hit)
    }
  })
  await Promise.all(workers)
  return results.sort((a, b) => a.ip.localeCompare(b.ip, 'en', { numeric: true }))
}
