/**
 * Yazıcı köprüsü.
 *
 * Tarayıcı ESC/POS konuşamaz; bu küçük servis kuyruğu alır ve fişi basar.
 * Çalıştırma:  npm run bridge
 *
 * Ayarlar (.env ya da ortam değişkeni):
 *   SOPRANO_API=http://127.0.0.1:8095
 *   RECEIPT_PRINTER=192.168.1.50:9100     (ağ yazıcısı)
 *   RECEIPT_PRINTER_DEVICE=USB001         (Windows USB yazıcı — opsiyonel)
 *   KITCHEN_PRINTER=192.168.1.51:9100
 *   DRY_RUN=1                             yazıcı yoksa .bin + .txt üretir
 */
import net from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildKot, buildReceipt, trAscii, type KotPayload, type ReceiptPayload } from '../server/print/escpos.ts'

const API = process.env.SOPRANO_API ?? 'http://127.0.0.1:8095'
const DRY_RUN = process.env.DRY_RUN === '1' || (!process.env.RECEIPT_PRINTER && !process.env.KITCHEN_PRINTER)
const OUT_DIR = path.join(process.cwd(), 'var', 'prints')

const targets: Record<string, string | undefined> = {
  receipt: process.env.RECEIPT_PRINTER,
  kitchen: process.env.KITCHEN_PRINTER,
}

async function sendToPrinter(hostPort: string, data: Buffer): Promise<void> {
  const [host, portStr] = hostPort.split(':')
  const port = Number(portStr ?? 9100)
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.write(data, () => socket.end())
    })
    socket.setTimeout(5000, () => {
      socket.destroy()
      reject(new Error(`yazıcı zaman aşımı: ${hostPort}`))
    })
    socket.on('error', reject)
    socket.on('close', () => resolve())
  })
}

type Job = { id: number; kind: 'receipt' | 'kot'; device: 'receipt' | 'kitchen'; payload: any }

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

async function tick() {
  const res = await fetch(`${API}/api/print/jobs`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  const jobs = (await res.json()) as Job[]
  for (const job of jobs) {
    try {
      const buf = job.kind === 'kot' ? buildKot(job.payload) : buildReceipt(job.payload)
      const target = targets[job.device]
      if (DRY_RUN || !target) {
        await mkdir(OUT_DIR, { recursive: true })
        const base = path.join(OUT_DIR, `${String(job.id).padStart(5, '0')}-${job.kind}`)
        await writeFile(`${base}.bin`, buf)
        await writeFile(`${base}.txt`, trAscii(await previewText(job.kind, job.payload)))
        console.log(`[dry-run] ${job.kind} #${job.id} → ${base}.bin`)
      } else {
        await sendToPrinter(target, buf)
        console.log(`[yazıldı] ${job.kind} #${job.id} → ${target}`)
      }
      await fetch(`${API}/api/print/jobs/${job.id}/done`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: true }),
      })
    } catch (err: any) {
      console.error(`[hata] job ${job.id}:`, err.message)
      await fetch(`${API}/api/print/jobs/${job.id}/done`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, error: String(err.message).slice(0, 200) }),
      })
    }
  }
}

console.log(`Soprano yazıcı köprüsü → ${API} ${DRY_RUN ? '(DRY RUN — dosyaya yazıyor)' : ''}`)
setInterval(() => {
  tick().catch((e) => console.error('tick:', e.message))
}, 2000)
