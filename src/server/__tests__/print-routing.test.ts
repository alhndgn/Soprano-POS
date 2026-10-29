import { describe, expect, it } from 'vitest'
import {
  charsForWidth,
  describePrinter,
  isValidPrinterAddress,
  normalizePrinter,
  parseNetworkAddress,
  pickPrinterForDevice,
  type PrinterConfig,
} from '../print/routing.ts'

const printer = (over: Partial<PrinterConfig> = {}): PrinterConfig => ({
  id: 1,
  name: 'Mutfak',
  device: 'kitchen',
  transport: 'network',
  address: '192.168.1.50:9100',
  paper_width: 80,
  enabled: true,
  ...over,
})

describe('charsForWidth', () => {
  it('80 mm için 42, 58 mm için 32 karakter verir', () => {
    expect(charsForWidth(80)).toBe(42)
    expect(charsForWidth(58)).toBe(32)
  })

  it('bilinmeyen genişlikte 80 mm varsayar', () => {
    expect(charsForWidth(0)).toBe(42)
    expect(charsForWidth(Number.NaN)).toBe(42)
  })
})

describe('parseNetworkAddress', () => {
  it('port verilmezse 9100 kullanır', () => {
    expect(parseNetworkAddress('192.168.1.50')).toEqual({ host: '192.168.1.50', port: 9100 })
  })

  it('host:port ayrıştırır', () => {
    expect(parseNetworkAddress('192.168.1.50:9101')).toEqual({ host: '192.168.1.50', port: 9101 })
    expect(parseNetworkAddress('  yazici.local:9100  ')).toEqual({ host: 'yazici.local', port: 9100 })
  })

  it('geçersiz adres ve portu reddeder', () => {
    expect(() => parseNetworkAddress('')).toThrow('boş olamaz')
    expect(() => parseNetworkAddress('http://192.168.1.50')).toThrow('biçiminde')
    expect(() => parseNetworkAddress('192.168.1.50:0')).toThrow('Port')
    expect(() => parseNetworkAddress('192.168.1.50:70000')).toThrow('Port')
  })
})

describe('isValidPrinterAddress', () => {
  it('ağ için ip:port, windows için boş olmayan ad ister', () => {
    expect(isValidPrinterAddress('network', '10.0.0.5:9100')).toBe(true)
    expect(isValidPrinterAddress('network', '10.0.0.5')).toBe(true)
    expect(isValidPrinterAddress('network', '10.0.0.5:1:2')).toBe(false)
    expect(isValidPrinterAddress('windows', 'EPSON TM-T20III')).toBe(true)
    expect(isValidPrinterAddress('windows', '   ')).toBe(false)
    expect(isValidPrinterAddress('file', 'test')).toBe(true)
  })
})

describe('normalizePrinter', () => {
  it('boşlukları temizler ve kağıdı 80/58 ile sınırlar', () => {
    const row = normalizePrinter({
      name: '  Kasada  ',
      device: 'receipt',
      transport: 'windows',
      address: ' EPSON TM-T20III ',
      paperWidth: 58 as 58,
      enabled: true,
    })
    expect(row.name).toBe('Kasada')
    expect(row.address).toBe('EPSON TM-T20III')
    expect(row.paper_width).toBe(58)
  })

  it('geçersiz kağıt genişliğini 80 yapar', () => {
    const row = normalizePrinter({
      name: 'X',
      device: 'kitchen',
      transport: 'network',
      address: '1.2.3.4',
      paperWidth: 100 as any,
      enabled: false,
    })
    expect(row.paper_width).toBe(80)
    expect(row.enabled).toBe(false)
  })

  it('boş ad ve hatalı ağ adresini reddeder', () => {
    expect(() =>
      normalizePrinter({ name: '  ', device: 'kitchen', transport: 'network', address: '1.2.3.4', paperWidth: 80, enabled: true }),
    ).toThrow('adı gerekli')
    expect(() =>
      normalizePrinter({ name: 'X', device: 'kitchen', transport: 'network', address: 'abc:def', paperWidth: 80, enabled: true }),
    ).toThrow('biçiminde')
  })
})

describe('pickPrinterForDevice', () => {
  it('rolün aktif yazıcısını seçer, pasifi atlar', () => {
    const list = [
      printer({ id: 1, enabled: false }),
      printer({ id: 2, enabled: true }),
      printer({ id: 3, device: 'receipt', transport: 'windows', address: 'EPSON' }),
    ]
    expect(pickPrinterForDevice(list, 'kitchen')?.id).toBe(2)
    expect(pickPrinterForDevice(list, 'receipt')?.id).toBe(3)
    expect(pickPrinterForDevice([], 'kitchen')).toBeNull()
    expect(pickPrinterForDevice([printer({ enabled: false })], 'kitchen')).toBeNull()
  })
})

describe('describePrinter', () => {
  it('taşıma türü, adres ve kağıdı özetler', () => {
    expect(describePrinter({ transport: 'network', address: '10.0.0.9:9100', paper_width: 80 })).toBe('Ağ · 10.0.0.9 · 80 mm')
    expect(describePrinter({ transport: 'windows', address: 'EPSON', paper_width: 58 })).toBe('USB/Windows · EPSON · 58 mm')
  })
})
