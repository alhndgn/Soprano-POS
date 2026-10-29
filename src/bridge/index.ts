/**
 * Yazıcı köprüsü.
 *
 * Tarayıcı ESC/POS konuşamaz; bu servis kuyruğu alır ve fişi basar.
 * Çalıştırma:  npm run bridge
 *
 * Yazıcı seçimi artık .env'de değil, Yönetim → Yazıcılar ekranında yapılır.
 * Kuyruktaki her iş, rolüne (`receipt` = kasa fişi, `kitchen` = mutfak KOT)
 * tanımlı aktif yazıcı bilgisiyle birlikte gelir.
 *
 * Taşıma biçimleri:
 *   network → ham TCP (genelde 9100)
 *   windows → kurulu Windows yazıcısı, spooler'a raw bayt (USB yazıcılar)
 *   file    → var/prints altına .bin + .txt (yazıcı yokken deneme)
 *
 * Ortam değişkenleri:
 *   SOPRANO_API=http://127.0.0.1:8095
 *   BRIDGE_TOKEN=...        API tarafında tanımlıysa zorunlu
 *   DRY_RUN=1               her işi dosyaya yazar (yazıcıya dokunmaz)
 */
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildKot, buildReceipt, trAscii, type KotPayload, type ReceiptPayload } from '../server/print/escpos.ts'
import { charsForWidth, parseNetworkAddress } from '../server/print/routing.ts'

const execFileAsync = promisify(execFile)
const API = process.env.SOPRANO_API ?? 'http://127.0.0.1:8095'
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN
const authHeaders: Record<string, string> = BRIDGE_TOKEN ? { 'x-bridge-token': BRIDGE_TOKEN } : {}
const FORCE_DRY = process.env.DRY_RUN === '1'
const OUT_DIR = path.join(process.cwd(), 'var', 'prints')
const SPOOL_DIR = path.join(process.cwd(), 'var', 'spool')

type JobPrinter = { id: number; name: string; transport: 'network' | 'windows' | 'file'; address: string; paperWidth: number }
type Job = { id: number; kind: 'receipt' | 'kot'; device: 'receipt' | 'kitchen'; payload: any; printer: JobPrinter | null }

async function sendNetwork(address: string, data: Buffer): Promise<void> {
  const { host, port } = parseNetworkAddress(address)
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.write(data, () => socket.end())
    })
    socket.setTimeout(6000, () => {
      socket.destroy()
      reject(new Error(`yazıcı zaman aşımı: ${address}`))
    })
    socket.on('error', (err) => reject(new Error(`bağlantı hatası ${address}: ${err.message}`)))
    socket.on('close', () => resolve())
  })
}

/** Kurulu Windows yazıcısına raw bayt gönderir (USB yazıcılar bu yolla basar). */
async function sendWindows(printerName: string, data: Buffer, jobId: number): Promise<void> {
  await mkdir(SPOOL_DIR, { recursive: true })
  const file = path.join(SPOOL_DIR, `job-${jobId}.bin`)
  await writeFile(file, data)
  const script = path.join(process.cwd(), 'scripts', 'raw-print.ps1')
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-PrinterName', printerName, '-FilePath', file],
      { timeout: 25000, windowsHide: true },
    )
  } catch (err: any) {
    const detail = String(err.stderr || err.stdout || err.message || err).trim().slice(0, 200)
    throw new Error(`Windows yazıcı hatası (${printerName}): ${detail}`)
  } finally {
    await unlink(file).catch(() => {})
  }
}

async function previewText(kind: string, payload: any): Promise<string> {
  if (kind === 'kot') {
    const p = payload as KotPayload
    return [
      `MUTFAK #${p.orderId} — ${p.tableName}`,
      ...p.lines.map((l) => `${l.qty} x ${l.name}${l.modifiers.length ? ` (+${l.modifiers.join(', ')})` : ''}${l.note ? ` [NOT: ${l.note}]` : ''}`),
    ].join('\n')
  }
  const p = payload as ReceiptPayload
  return [
    p.outletName,
    `Adisyon #${p.orderId} · ${p.tableName}`,
    ...p.lines.map((l) => `${l.qty} x ${l.name} = ${(l.total / 100).toFixed(2)}`),
    `TOPLAM ${(p.total / 100).toFixed(2)} TL`,
    ...p.payments.map((x) => `${x.method} ${(x.amount / 100).toFixed(2)}`),
  ].join('\n')
}

async function sendToFile(job: Job, buf: Buffer): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })
  const base = path.join(OUT_DIR, `${String(job.id).padStart(5, '0')}-${job.kind}`)
  await writeFile(`${base}.bin`, buf)
  await writeFile(`${base}.txt`, trAscii(await previewText(job.kind, job.payload)))
}

async function deliver(job: Job, buf: Buffer): Promise<string> {
  const printer = job.printer
  if (FORCE_DRY) {
    await sendToFile(job, buf)
    return 'dry-run'
  }
  if (!printer) throw new Error(`${job.device === 'kitchen' ? 'Mutfak' : 'Kasa'} yazıcısı tanımlı değil (Yönetim → Yazıcılar)`)

  if (printer.transport === 'network') await sendNetwork(printer.address, buf)
  else if (printer.transport === 'windows') await sendWindows(printer.address, buf, job.id)
  else await sendToFile(job, buf)

  console.log(`[yazıldı] ${job.kind} #${job.id} → ${printer.name} (${printer.transport})`)
  return printer.name
}

let lastApiError = 0
let running = false

async function tick() {
  if (running) return
  running = true
  try {
    await drain()
  } finally {
    running = false
  }
}

async function drain() {
  const res = await fetch(`${API}/api/print/jobs`, { headers: authHeaders })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const jobs = (await res.json()) as Job[]
  for (const job of jobs) {
    try {
      const width = charsForWidth(job.printer?.paperWidth ?? 80)
      const buf = job.kind === 'kot' ? buildKot(job.payload, width) : buildReceipt(job.payload, width)
      const printerName = await deliver(job, buf)
      await fetch(`${API}/api/print/jobs/${job.id}/done`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify({ ok: true, printerName }),
      })
    } catch (err: any) {
      const message = String(err.message ?? err).slice(0, 200)
      console.error(`[hata] job ${job.id}: ${message}`)
      await fetch(`${API}/api/print/jobs/${job.id}/done`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify({ ok: false, error: message, ...(job.printer?.name ? { printerName: job.printer.name } : {}) }),
      }).catch(() => {})
    }
  }
}

async function heartbeat() {
  await fetch(`${API}/api/print/bridge/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: JSON.stringify({ host: os.hostname(), platform: `${process.platform} ${os.release()}` }),
  }).catch(() => {})
}

console.log(`Soprano yazıcı köprüsü → ${API}${FORCE_DRY ? ' (DRY RUN)' : ''}`)
heartbeat()
setInterval(() => {
  heartbeat().catch(() => {})
}, 15000)
setInterval(() => {
  tick().catch((e) => {
    const now = Date.now()
    if (now - lastApiError > 30000) {
      lastApiError = now
      console.error('tick:', e.message)
    }
  })
}, 2000)
