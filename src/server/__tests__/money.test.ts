import { describe, expect, it } from 'vitest'
import { change, lineGross, money, orderTotals, remaining, splitVat } from '../money.ts'

describe('KDV ayrıştırma', () => {
  it('%10 dahil 110,00 TL → net 100,00 + KDV 10,00', () => {
    expect(splitVat(11000, 10)).toEqual({ net: 10000, vat: 1000 })
  })

  it('%20 dahil 120,00 TL → net 100,00 + KDV 20,00', () => {
    expect(splitVat(12000, 20)).toEqual({ net: 10000, vat: 2000 })
  })

  it('kuruş yuvarlaması kaybolmaz', () => {
    const { net, vat } = splitVat(9999, 10)
    expect(net + vat).toBe(9999)
  })
})

describe('satır tutarı', () => {
  it('modifier fiyatı adetle çarpılır', () => {
    expect(lineGross({ qty: 2, unitPrice: 30000, vatRate: 10, modifiers: [{ price: 2000 }] })).toBe(64000)
  })

  it('modifiersiz satır', () => {
    expect(lineGross({ qty: 3, unitPrice: 4000, vatRate: 20, modifiers: [] })).toBe(12000)
  })

  it('eklenen içerik fiyatı satıra eklenir', () => {
    expect(lineGross({ qty: 2, unitPrice: 30000, vatRate: 10, modifiers: [], ingredients: [{ price: 3000 }] })).toBe(66000)
  })

  it('çıkarılan içerik fiyat değiştirmez (0)', () => {
    expect(lineGross({ qty: 1, unitPrice: 30000, vatRate: 10, modifiers: [], ingredients: [] })).toBe(30000)
  })
})

describe('adisyon toplamı', () => {
  const lines = [
    { qty: 2, unitPrice: 30000, vatRate: 10, modifiers: [{ price: 2000 }] }, // 640,00
    { qty: 2, unitPrice: 4000, vatRate: 20, modifiers: [] }, // 80,00
  ]

  it('toplam KDV dahil 720,00 TL', () => {
    expect(orderTotals(lines).total).toBe(72000)
  })

  it('KDV dilimleri ayrı hesaplanır', () => {
    const t = orderTotals(lines)
    expect(t.vatLines.map((v) => v.rate)).toEqual([10, 20])
    expect(t.vat).toBe(5818 + 1333)
  })

  it('subtotal + vat = total (kuruş kaybı yok)', () => {
    const t = orderTotals(lines)
    expect(t.subtotal + t.vat).toBe(t.total)
  })

  it('boş adisyon sıfır', () => {
    expect(orderTotals([])).toMatchObject({ subtotal: 0, vat: 0, total: 0 })
  })
})

describe('para biçimi ve para üstü', () => {
  it('kuruş → TRY', () => {
    expect(money(123450)).toBe('1.234,50 ₺')
    expect(money(0)).toBe('0,00 ₺')
  })

  it('para üstü ve kalan', () => {
    expect(change(40000, 36000)).toBe(4000)
    expect(change(30000, 36000)).toBe(0)
    expect(remaining(50000, 72000)).toBe(22000)
    expect(remaining(80000, 72000)).toBe(0)
  })
})
