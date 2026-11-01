/**
 * ESC/POS fiş üretimi.
 *
 * Termal yazıcılar Türkçe karakterleri codepage'e göre basar; hangi codepage'in
 * desteklendiği modele göre değişir. Güvenli varsayılan: TR karakterleri ASCII'ye
 * çevir (ç→c, ş→s, ğ→g, ı→i, ö→o, ü→u). Gerçek yazıcıda CP857 destekleniyorsa
 * SOPRANO_PRINTER_CP857=1 ile ham Türkçe gönderilir.
 */

export function trAscii(s: string): string {
  const map: Record<string, string> = {
    ç: 'c', Ç: 'C', ş: 's', Ş: 'S', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I',
    ö: 'o', Ö: 'O', ü: 'u', Ü: 'U', â: 'a', î: 'i', û: 'u',
  }
  return s.replace(/[çÇşŞğĞıİöÖüÜâîû]/g, (c) => map[c] ?? c)
}

const ESC = 0x1b
const GS = 0x1d

class EscPos {
  bytes: number[] = []
  width: number

  constructor(width = 42) {
    this.width = width
  }

  raw(...b: number[]) { this.bytes.push(...b); return this }
  init() { return this.raw(ESC, 0x40) }
  align(a: 'left' | 'center' | 'right') { return this.raw(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2) }
  bold(on: boolean) { return this.raw(ESC, 0x45, on ? 1 : 0) }
  double(on: boolean) { return this.raw(GS, 0x21, on ? 0x11 : 0x00) }
  feed(n = 1) { return this.raw(ESC, 0x64, n) }
  cut() { return this.raw(GS, 0x56, 0x42, 0x00) }

  text(s: string) {
    const out = process.env.SOPRANO_PRINTER_CP857 === '1' ? s : trAscii(s)
    for (const ch of out) {
      const code = ch.charCodeAt(0)
      this.bytes.push(code < 256 ? code : 0x3f) // '?'
    }
    return this.raw(0x0a)
  }

  line(ch = '-') { return this.text(ch.repeat(this.width)) }
  row(left: string, right: string) {
    const pad = Math.max(1, this.width - left.length - right.length)
    return this.text(left + ' '.repeat(pad) + right)
  }
}

/** Kağıt genişliğine göre karakter sayısı: 80 mm → 42, 58 mm → 32. */
export const charsForPaper = (paperWidth = 80) => (Number(paperWidth) === 58 ? 32 : 42)

export type ReceiptPayload = {
  outletName: string
  orderId: number
  tableName: string
  staffName: string
  dateISO: string
  lines: {
    name: string
    qty: number
    unitPrice: number
    modifiers: string[]
    removed?: string[]
    added?: string[]
    total: number
  }[]
  subtotal: number
  vatLines: { rate: number; vat: number; gross: number }[]
  /** false ise fişte KDV dökümü basılmaz (ayarlardan kapatılabilir) */
  showVat?: boolean
  total: number
  payments: { method: string; amount: number }[]
  change: number
  footer: string
}

export type CancelPayload = {
  orderId: number
  tableName: string
  staffName: string
  timeISO: string
  /** 'order' = adisyon tamamen iptal, 'line' = tek ürün iptali */
  scope: 'order' | 'line'
  reason: string
  total?: number
  lines: { name: string; qty: number; note?: string | null }[]
}

export type KotPayload = {
  orderId: number
  tableName: string
  staffName: string
  timeISO: string
  lines: {
    name: string
    qty: number
    note?: string | null
    modifiers: string[]
    removed?: string[]
    added?: string[]
  }[]
}

const tl = (k: number) => `${(Math.floor(k / 100)).toLocaleString('tr-TR')},${String(k % 100).padStart(2, '0')}`

export function buildReceipt(p: ReceiptPayload, paperWidth = 80): Buffer {
  const e = new EscPos(charsForPaper(paperWidth)).init().align('center')
  e.bold(true).double(true).text(p.outletName).double(false).bold(false)
  e.text(`Adisyon #${p.orderId}`)
  e.text(`${p.tableName} · ${p.staffName}`)
  e.text(new Date(p.dateISO).toLocaleString('tr-TR'))
  e.align('left').line()

  for (const l of p.lines) {
    e.row(`${l.qty} x ${l.name}`, tl(l.total))
    for (const m of l.modifiers) e.text(`   + ${m}`)
    if (l.removed?.length) e.text(`   - ${l.removed.join(', ')}`)
    if (l.added?.length) e.text(`   + ${l.added.join(', ')}`)
  }
  e.line()
  if (p.showVat !== false) {
    for (const v of p.vatLines) e.row(`KDV %${v.rate} dahil`, tl(v.gross))
  }
  e.bold(true).row('TOPLAM', tl(p.total)).bold(false)
  e.line()
  for (const pay of p.payments) {
    const label = pay.method === 'cash' ? 'Nakit' : pay.method === 'card' ? 'Kredi Karti' : 'Diger'
    e.row(label, tl(pay.amount))
  }
  if (p.change > 0) e.row('Para Ustu', tl(p.change))
  e.align('center').feed(1).text(p.footer).feed(2).cut()
  return Buffer.from(e.bytes)
}

export function buildCancel(p: CancelPayload, paperWidth = 80): Buffer {
  const e = new EscPos(charsForPaper(paperWidth)).init()
  e.align('center').bold(true).double(true).text('*** IPTAL ***').double(false).bold(false)
  e.text(p.scope === 'order' ? 'ADISYON IPTALI' : 'URUN IPTALI')
  e.align('left').line('=')
  e.bold(true).text(`#${p.orderId}  ${p.tableName}`).bold(false)
  e.text(new Date(p.timeISO).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }))
  e.text(`Personel: ${p.staffName}`)
  e.line()
  for (const l of p.lines) {
    e.bold(true).text(`${l.qty} x ${l.name}`).bold(false)
    if (l.note) e.text(`   NOT: ${l.note}`)
  }
  if (p.total !== undefined) {
    e.line()
    e.row('IPTAL TUTARI', tl(p.total))
  }
  e.line()
  e.text('SEBEP:')
  e.text(p.reason)
  e.feed(2).cut()
  return Buffer.from(e.bytes)
}

export function buildKot(p: KotPayload, paperWidth = 80): Buffer {
  const e = new EscPos(charsForPaper(paperWidth)).init()
  e.bold(true).double(true).text(`MUTFAK #${p.orderId}`).double(false).bold(false)
  e.text(p.tableName)
  e.text(new Date(p.timeISO).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }))
  e.line('=')
  for (const l of p.lines) {
    e.bold(true).text(`${l.qty} x ${l.name}`).bold(false)
    for (const m of l.modifiers) e.text(`   + ${m}`)
    if (l.removed?.length) e.bold(true).text(`   CIKAR: ${l.removed.join(', ')}`).bold(false)
    if (l.added?.length) e.text(`   EKLE: ${l.added.join(', ')}`)
    if (l.note) e.text(`   NOT: ${l.note}`)
  }
  e.line('=').feed(2).cut()
  return Buffer.from(e.bytes)
}
