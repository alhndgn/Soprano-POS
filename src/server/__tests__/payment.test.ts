import { describe, expect, it } from 'vitest'
import { allocateDiscount, allocatePayment, discountAmount } from '../money.ts'

describe('iskonto matematiği', () => {
  it('yüzde iskonto kuruşta yuvarlanır', () => {
    expect(discountAmount(10000, { type: 'percent', value: 10 })).toBe(1000)
    expect(discountAmount(9999, { type: 'percent', value: 10 })).toBe(1000)
  })

  it('sabit iskonto toplamı aşamaz', () => {
    expect(discountAmount(2000, { type: 'fixed', value: 2500 })).toBe(2000)
    expect(discountAmount(2000, { type: 'none', value: 0 })).toBe(0)
  })

  it('iskonto satırlara dağıtılır ve toplam kuruş kaybetmez', () => {
    const parts = allocateDiscount([10000, 3000], 1300)
    expect(parts.reduce((sum, amount) => sum + amount, 0)).toBe(1300)
    expect(parts.every((amount, i) => amount >= 0 && amount <= [10000, 3000][i])).toBe(true)
  })
})

describe('ödeme allocation', () => {
  it('iki adetlik satırdan tek adet seçilince tek birim tutar dağıtır', () => {
    const allocations = allocatePayment(
      [{ lineId: 10, due: 8000, qty: 2 }],
      4000,
      [{ lineId: 10, qty: 1 }],
    )
    expect(allocations).toEqual([{ lineId: 10, qty: 1, amount: 4000 }])
  })

  it('tamamı ödenmiş satırı ikinci allocationa almaz', () => {
    const allocations = allocatePayment(
      [{ lineId: 10, due: 0, qty: 0 }, { lineId: 11, due: 5000, qty: 1 }],
      5000,
      [{ lineId: 10, qty: 1 }, { lineId: 11, qty: 1 }],
    )
    expect(allocations).toEqual([{ lineId: 11, qty: 1, amount: 5000 }])
  })
})
