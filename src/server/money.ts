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
  /** siparişte eklenen içerikler (çıkarılanlar fiyat taşımaz) */
  ingredients?: { price: number }[]
}

export function lineGross(l: PricedLine): number {
  const mods = l.modifiers.reduce((s, m) => s + m.price, 0)
  const ing = (l.ingredients ?? []).reduce((s, i) => s + i.price, 0)
  return (l.unitPrice + mods + ing) * l.qty
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

export type DiscountInput = { type: 'none' | 'percent' | 'fixed'; value: number }

/** KDV dahil brüt toplamdan uygulanacak iskonto kuruşunu hesaplar. */
export function discountAmount(gross: number, discount: DiscountInput): number {
  if (!Number.isInteger(gross) || gross < 0) throw new Error('geçersiz brüt tutar')
  if (!Number.isInteger(discount.value) || discount.value < 0) throw new Error('geçersiz iskonto')
  if (discount.type === 'none') return 0
  if (discount.type === 'percent') {
    if (discount.value > 100) throw new Error('iskonto yüzdesi 100 olamaz')
    return Math.min(gross, Math.round((gross * discount.value) / 100))
  }
  return Math.min(gross, discount.value)
}

/** İskontoyu satır brütlerine dağıtır; sonuç toplamı iskontoya tam eşittir. */
export function allocateDiscount(grosses: number[], amount: number): number[] {
  if (amount < 0 || !Number.isInteger(amount)) throw new Error('geçersiz iskonto tutarı')
  const total = grosses.reduce((sum, gross) => sum + Math.max(0, gross), 0)
  const capped = Math.min(amount, total)
  if (capped === 0 || total === 0) return grosses.map(() => 0)

  const parts = grosses.map((gross) => Math.min(Math.max(0, gross), Math.floor((capped * Math.max(0, gross)) / total)))
  let remainder = capped - parts.reduce((sum, part) => sum + part, 0)
  while (remainder > 0) {
    let moved = false
    for (let i = grosses.length - 1; i >= 0 && remainder > 0; i--) {
      if (parts[i] < Math.max(0, grosses[i])) {
        parts[i] += 1
        remainder -= 1
        moved = true
      }
    }
    if (!moved) break
  }
  return parts
}

export type PaymentDueLine = { lineId: number; due: number; qty: number }
export type PaymentRequestLine = { lineId: number; qty: number }
export type PaymentAllocation = { lineId: number; qty: number; amount: number }

/** Seçilen satır/adetleri kalan borç ile sınırlayarak ödeme allocation'ına çevirir. */
export function allocatePayment(
  dueLines: PaymentDueLine[],
  amount: number,
  requested: PaymentRequestLine[],
): PaymentAllocation[] {
  if (!Number.isInteger(amount) || amount <= 0) return []
  let remaining = amount
  const result: PaymentAllocation[] = []
  for (const selection of requested) {
    if (remaining <= 0) break
    const line = dueLines.find((item) => item.lineId === selection.lineId)
    if (!line || line.due <= 0 || line.qty <= 0 || selection.qty <= 0) continue
    const qty = Math.min(line.qty, Math.floor(selection.qty))
    const amountForSelection = qty === line.qty ? line.due : Math.min(line.due, Math.floor((line.due * qty) / line.qty))
    const applied = Math.min(remaining, amountForSelection)
    if (applied <= 0) continue
    result.push({ lineId: line.lineId, qty, amount: applied })
    remaining -= applied
  }
  return result
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
