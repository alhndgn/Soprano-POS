/**
 * Para matematiği — her şey kuruş (integer), asla float.
 * Fiyatlar KDV DAHİL saklanır (Türkiye menü geleneği).
 */

export type VatBreakdown = { rate: number; net: number; vat: number; gross: number }

/** KDV dahil brütten net ve KDV ayırır. */
export function splitVat(gross: number, rate: number): { net: number; vat: number } {
  if (gross < 0) throw new Error('negatif tutar')
  const net = Math.round((gross * 100) / (100 + rate))
  return { net, vat: gross - net }
}

export function vatBreakdown(lines: { gross: number; rate: number }[]): VatBreakdown[] {
  const byRate = new Map<number, number>()
  for (const l of lines) byRate.set(l.rate, (byRate.get(l.rate) ?? 0) + l.gross)
  return [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, gross]) => {
      const { net, vat } = splitVat(gross, rate)
      return { rate, net, vat, gross }
    })
}

export type PricedLine = {
  qty: number
  unitPrice: number
  vatRate: number
  modifiers: { price: number }[]
}

export function lineGross(l: PricedLine): number {
  const mods = l.modifiers.reduce((s, m) => s + m.price, 0)
  return (l.unitPrice + mods) * l.qty
}

export type OrderTotals = {
  subtotal: number // KDV hariç
  vat: number
  total: number // KDV dahil, ödenecek
  vatLines: VatBreakdown[]
}

export function orderTotals(lines: PricedLine[]): OrderTotals {
  const enriched = lines.map((l) => ({ gross: lineGross(l), rate: l.vatRate }))
  const vatLines = vatBreakdown(enriched)
  const total = vatLines.reduce((s, v) => s + v.gross, 0)
  const vat = vatLines.reduce((s, v) => s + v.vat, 0)
  return { subtotal: total - vat, vat, total, vatLines }
}

/** Kuruş → "1.234,50 ₺" */
export function money(kurus: number): string {
  const sign = kurus < 0 ? '-' : ''
  const abs = Math.abs(kurus)
  const lira = Math.floor(abs / 100)
  const kr = String(abs % 100).padStart(2, '0')
  const grouped = lira.toLocaleString('tr-TR')
  return `${sign}${grouped},${kr} ₺`
}

/** Nakit ödemede para üstü. */
export function change(paid: number, total: number): number {
  return Math.max(0, paid - total)
}

/** Split ödemede kalan. */
export function remaining(paid: number, total: number): number {
  return Math.max(0, total - paid)
}
