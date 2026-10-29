import { describe, expect, it } from 'vitest'
import { reportCustomerName, reportPaymentLabel } from './report.ts'

describe('rapor görüntü yardımcıları', () => {
  it('boş müşteri adını tire ile gösterir', () => {
    expect(reportCustomerName(null)).toBe('—')
    expect(reportCustomerName('  ')).toBe('—')
    expect(reportCustomerName('Ayşe Yılmaz')).toBe('Ayşe Yılmaz')
  })

  it('ödeme yöntemlerini Türkçe etiketler', () => {
    expect(reportPaymentLabel('cash, card')).toBe('Nakit · Kart')
    expect(reportPaymentLabel('')).toBe('—')
  })
})
