import { describe, expect, it } from 'vitest'
import { buildReceipt, type ReceiptPayload } from '../print/escpos.ts'

const payload = (over: Partial<ReceiptPayload> = {}): ReceiptPayload => ({
  outletName: 'Test',
  orderId: 1,
  tableName: 'Masa 1',
  staffName: 'Ali',
  dateISO: new Date('2026-01-01T12:00:00Z').toISOString(),
  lines: [{ name: 'Margarita', qty: 1, unitPrice: 10000, modifiers: [], total: 10000 }],
  subtotal: 9091,
  vatLines: [{ rate: 10, vat: 909, gross: 10000 }],
  total: 10000,
  payments: [{ method: 'cash', amount: 10000 }],
  change: 0,
  footer: 'Tesekkurler',
  ...over,
})

const text = (buf: Buffer) => buf.toString('latin1')

describe('buildReceipt KDV görünürlüğü', () => {
  it('showVat false ise KDV satırı basmaz', () => {
    const out = text(buildReceipt(payload({ showVat: false })))
    expect(out).not.toContain('KDV')
    expect(out).toContain('TOPLAM')
  })

  it('showVat true ise KDV dökümü basar', () => {
    const out = text(buildReceipt(payload({ showVat: true })))
    expect(out).toContain('KDV %10')
  })

  it('showVat verilmezse KDV basar (varsayılan açık)', () => {
    const out = text(buildReceipt(payload()))
    expect(out).toContain('KDV %10')
  })
})
