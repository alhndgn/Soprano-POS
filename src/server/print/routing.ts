/**
 * Yazıcı yönlendirme yardımcıları.
 *
 * Kuyruktaki her iş bir role (`receipt` | `kitchen`) düşer; köprü o rol için
 * tanımlı aktif yazıcıyı kullanır. Saf fonksiyonlar burada tutulur ki API,
 * köprü ve testler aynı kuralları paylaşsın.
 */

export type PrinterDevice = 'receipt' | 'kitchen'
export type PrinterTransport = 'network' | 'windows' | 'file'

export type PrinterConfig = {
  id: number
  name: string
  device: PrinterDevice
  transport: PrinterTransport
  address: string
  paper_width: number
  enabled: boolean
}

/** 58 mm kağıt 32, 80 mm kağıt 42 karakter basar (font A). */
export function charsForWidth(paperWidth: number): number {
  return Number(paperWidth) === 58 ? 32 : 42
}

/** "192.168.1.50", "192.168.1.50:9100", "yazici.local" biçimlerini ayrıştırır. */
export function parseNetworkAddress(address: string): { host: string; port: number } {
  const trimmed = String(address ?? '').trim()
  if (!trimmed) throw new Error('Yazıcı adresi boş olamaz')
  const match = /^([^:\s/]+)(?::(\d{1,5}))?$/.exec(trimmed)
  if (!match) throw new Error('Ağ adresi "ip" veya "ip:port" biçiminde olmalı')
  const host = match[1]
  const port = match[2] ? Number(match[2]) : 9100
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port 1-65535 arasında olmalı')
  return { host, port }
}

export function isValidPrinterAddress(transport: PrinterTransport, address: string): boolean {
  try {
    if (transport === 'network') parseNetworkAddress(address)
    else if (!String(address ?? '').trim()) return false
    return true
  } catch {
    return false
  }
}

export type PrinterInput = {
  name: string
  device: PrinterDevice
  transport: PrinterTransport
  address: string
  paperWidth: number
  enabled: boolean
}

/** API girdisini doğrular ve veritabanı satırına çevirir. */
export function normalizePrinter(input: PrinterInput): {
  name: string
  device: PrinterDevice
  transport: PrinterTransport
  address: string
  paper_width: number
  enabled: boolean
} {
  const name = String(input.name ?? '').trim()
  if (!name) throw new Error('Yazıcı adı gerekli')
  const address = String(input.address ?? '').trim()
  if (!isValidPrinterAddress(input.transport, address)) {
    throw new Error(input.transport === 'network' ? 'Ağ adresi "ip" veya "ip:port" biçiminde olmalı' : 'Yazıcı adı gerekli')
  }
  const paperWidth = Number(input.paperWidth) === 58 ? 58 : 80
  return { name, device: input.device, transport: input.transport, address, paper_width: paperWidth, enabled: Boolean(input.enabled) }
}

/** Kullanıcıya gösterilecek tek satırlık hedef özeti. */
export function describePrinter(p: Pick<PrinterConfig, 'transport' | 'address' | 'paper_width'>): string {
  const where = p.transport === 'network' ? parseNetworkAddress(p.address).host : p.address
  const kind = p.transport === 'network' ? 'Ağ' : p.transport === 'windows' ? 'USB/Windows' : 'Dosya'
  return `${kind} · ${where} · ${p.paper_width} mm`
}

/** İşin rolüne göre aktif yazıcıyı seçer. */
export function pickPrinterForDevice(printers: PrinterConfig[], device: PrinterDevice): PrinterConfig | null {
  return printers.find((p) => p.device === device && p.enabled) ?? null
}
