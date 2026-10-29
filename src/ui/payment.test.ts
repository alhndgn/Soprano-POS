import { describe, expect, it } from 'vitest'
import { defaultPaymentSelection, selectedPaymentTotal } from './payment.ts'

describe('ödeme ürün seçimi', () => {
  const lines = [
    { id: 10, qty: 1, paid_qty: 0, remaining_amount: 27000, payment_status: 'unpaid' as const },
    { id: 11, qty: 2, paid_qty: 0, remaining_amount: 7200, payment_status: 'unpaid' as const },
    { id: 12, qty: 1, paid_qty: 1, remaining_amount: 0, payment_status: 'paid' as const },
  ]

  it('başlangıçta yalnız ödenmemiş kalan adetleri seçer', () => {
    expect(defaultPaymentSelection(lines)).toEqual({ 10: 1, 11: 2 })
  })

  it('seçilen adetlerin kalan tutarını hesaplar', () => {
    expect(selectedPaymentTotal(lines, { 10: 1, 11: 1 })).toBe(30600)
    expect(selectedPaymentTotal(lines, { 12: 1 })).toBe(0)
  })
})
