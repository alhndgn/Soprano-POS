import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api,
  type BridgeStatus,
  type DetectedPrinter,
  type LanPrinter,
  type PrintJob,
  type Printer,
  type PrinterDevice,
  type PrinterTransport,
} from '../api.ts'

type Draft = {
  id: number | null
  name: string
  transport: PrinterTransport
  address: string
  paperWidth: number
  enabled: boolean
}

const ROLE: Record<PrinterDevice, { eyebrow: string; title: string; hint: string; defaultName: string }> = {
  kitchen: {
    eyebrow: 'MUTFAK',
    title: 'Mutfak fişi (KOT)',
    hint: 'Sipariş mutfağa gönderildiğinde bu yazıcıdan çıkar. Genelde ağ termal yazıcıdır.',
    defaultName: 'Mutfak Yazıcısı',
  },
  receipt: {
    eyebrow: 'KASA',
    title: 'Müşteri fişi',
    hint: 'Ödeme alındığında bu yazıcıdan çıkar. Kasaya USB ile bağlı yazıcıyı seçin.',
    defaultName: 'Kasa Yazıcısı',
  },
}

const TRANSPORTS: { value: PrinterTransport; label: string; hint: string }[] = [
  { value: 'network', label: 'Ağ (LAN)', hint: 'IP adresi ve port. Termal yazıcıların çoğu 9100 portunu dinler.' },
  { value: 'windows', label: 'USB (Windows)', hint: 'Yazıcı Windows\'a kurulu olmalı. Adı Yazıcılar ekranındaki adla aynı olmalı.' },
  { value: 'file', label: 'Dosya (test)', hint: 'Yazıcıya göndermez; var/prints klasörüne örnek fiş yazar.' },
]

const emptyDraft = (device: PrinterDevice): Draft => ({
  id: null,
  name: ROLE[device].defaultName,
  transport: device === 'kitchen' ? 'network' : 'windows',
  address: '',
  paperWidth: 80,
  enabled: true,
})

function toDraft(p: Printer): Draft {
  return { id: p.id, name: p.name, transport: p.transport, address: p.address, paperWidth: p.paper_width, enabled: p.enabled }
}

function ago(iso: string | null | undefined): string {
  if (!iso) return 'hiç'
  const diff = Math.max(0, Date.now() - new Date(iso).getTime())
  const sec = Math.round(diff / 1000)
  if (sec < 5) return 'az önce'
  if (sec < 60) return `${sec} sn önce`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} dk önce`
  return `${Math.round(min / 60)} sa önce`
}

export default function PrinterSettings({ onError, onOk }: { onError: (m: string) => void; onOk: (m: string) => void }) {
  const [printers, setPrinters] = useState<Printer[]>([])
  const [bridge, setBridge] = useState<BridgeStatus>(null)
  const [jobs, setJobs] = useState<PrintJob[]>([])
  const [drafts, setDrafts] = useState<Record<PrinterDevice, Draft>>({
    kitchen: emptyDraft('kitchen'),
    receipt: emptyDraft('receipt'),
  })
  const [busy, setBusy] = useState<PrinterDevice | null>(null)
  const [detecting, setDetecting] = useState<PrinterDevice | null>(null)
  const [found, setFound] = useState<{ device: PrinterDevice; windows: DetectedPrinter[]; lan: LanPrinter[]; note: string } | null>(null)
  const [testing, setTesting] = useState<number | null>(null)
  const hydrated = useRef<Record<PrinterDevice, number | null>>({ kitchen: null, receipt: null })

  const load = useCallback(() => {
    api
      .printers()
      .then((data) => {
        setPrinters(data.printers)
        setBridge(data.bridge)
        setJobs(data.jobs)
        setDrafts((prev) => {
          const next = { ...prev }
          for (const device of ['kitchen', 'receipt'] as PrinterDevice[]) {
            const active = data.printers.find((p) => p.device === device && p.enabled) ?? data.printers.find((p) => p.device === device)
            const currentId = active?.id ?? null
            // Kullanıcı kaydetmediyse sunucudaki tanımı ekrana yansıt.
            if (hydrated.current[device] !== currentId && prev[device].id === null) {
              next[device] = active ? toDraft(active) : emptyDraft(device)
              hydrated.current[device] = currentId
            } else if (prev[device].id === currentId && active) {
              next[device] = { ...toDraft(active) }
              hydrated.current[device] = currentId
            }
          }
          return next
        })
      })
      .catch((e) => onError(e.message))
  }, [onError])

  useEffect(load, [load])

  useEffect(() => {
    const timer = setInterval(load, 6000)
    return () => clearInterval(timer)
  }, [load])

  const patchDraft = (device: PrinterDevice, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [device]: { ...prev[device], ...patch } }))

  const save = async (device: PrinterDevice) => {
    const draft = drafts[device]
    setBusy(device)
    try {
      const body = {
        name: draft.name.trim() || ROLE[device].defaultName,
        device,
        transport: draft.transport,
        address: draft.address.trim(),
        paperWidth: draft.paperWidth,
        enabled: draft.enabled,
      }
      const res = draft.id ? await api.updatePrinter(draft.id, body) : await api.createPrinter(body)
      patchDraft(device, { id: res.printer.id })
      hydrated.current[device] = res.printer.id
      onOk(`${ROLE[device].title} kaydedildi`)
      load()
    } catch (e: any) {
      onError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const test = async (device: PrinterDevice) => {
    const draft = drafts[device]
    if (!draft.id) return onError('Önce yazıcıyı kaydedin')
    setTesting(draft.id)
    try {
      const res = await api.testPrinter(draft.id)
      onOk(`Test fişi kuyruğa eklendi (#${res.job.id}). Köprü çalışıyorsa birkaç saniyede çıkar.`)
      setTimeout(load, 3500)
    } catch (e: any) {
      onError(e.message)
    } finally {
      setTesting(null)
    }
  }

  const remove = async (device: PrinterDevice) => {
    const draft = drafts[device]
    if (!draft.id) return
    setBusy(device)
    try {
      await api.deletePrinter(draft.id)
      hydrated.current[device] = null
      setDrafts((prev) => ({ ...prev, [device]: emptyDraft(device) }))
      onOk(`${ROLE[device].title} silindi`)
      load()
    } catch (e: any) {
      onError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const detect = async (device: PrinterDevice, mode: 'windows' | 'network') => {
    setDetecting(device)
    setFound(null)
    try {
      const res = await api.detectPrinters(mode)
      setFound({
        device,
        windows: res.printers ?? [],
        lan: res.candidates ?? [],
        note: res.available === false ? res.reason ?? 'Bulunamadı' : '',
      })
      // Sonuç kartın altında kalmasın: görünür alana kaydır.
      setTimeout(() => document.getElementById(`printer-found-${device}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60)
    } catch (e: any) {
      onError(e.message)
    } finally {
      setDetecting(null)
    }
  }

  const online = bridge?.at ? Date.now() - new Date(bridge.at).getTime() < 45000 : false

  return (
    <div className="printer-settings">
      <div className={`bridge-bar${online ? ' online' : ''}`} role="status">
        <span className="bridge-dot" aria-hidden="true" />
        <div>
          <b>{online ? 'Yazıcı köprüsü çevrimiçi' : 'Yazıcı köprüsü kapalı'}</b>
          <small>
            {online
              ? `${bridge?.host ?? 'bu bilgisayar'} · son sinyal ${ago(bridge?.at)}`
              : 'Fiş basılması için köprüyü başlatın: masaüstündeki “Soprano Yazici” kısayolu.'}
          </small>
        </div>
        <span className="pill">{printers.filter((p) => p.enabled).length} aktif yazıcı</span>
      </div>

      <div className="printer-grid">
        {(['kitchen', 'receipt'] as PrinterDevice[]).map((device) => {
          const draft = drafts[device]
          const active = printers.find((p) => p.device === device && p.enabled)
          const transport = TRANSPORTS.find((t) => t.value === draft.transport)!
          const detected = found?.device === device ? found : null
          return (
            <section className="panel printer-card" key={device}>
              <div className="printer-card-head">
                <div>
                  <p className="eyebrow">{ROLE[device].eyebrow}</p>
                  <h3>{ROLE[device].title}</h3>
                  <p className="printer-hint">{ROLE[device].hint}</p>
                </div>
                <span className={`printer-state${active ? ' on' : ''}`}>{active ? 'Tanımlı' : 'Tanımsız'}</span>
              </div>

              {active && <div className="printer-summary">{active.summary}</div>}

              <label className="field">
                <span>Yazıcı adı</span>
                <input
                  className="input"
                  value={draft.name}
                  maxLength={60}
                  onChange={(e) => patchDraft(device, { name: e.target.value })}
                  placeholder={ROLE[device].defaultName}
                />
              </label>

              <div className="field">
                <span>Bağlantı</span>
                <div className="segmented" role="group" aria-label={`${ROLE[device].title} bağlantı türü`}>
                  {TRANSPORTS.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      className={draft.transport === t.value ? 'on' : ''}
                      aria-pressed={draft.transport === t.value}
                      onClick={() => patchDraft(device, { transport: t.value, address: t.value === draft.transport ? draft.address : '' })}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <small className="hint">{transport.hint}</small>
              </div>

              <label className="field">
                <span>{draft.transport === 'network' ? 'IP adresi' : draft.transport === 'windows' ? 'Windows yazıcı adı' : 'Dosya adı'}</span>
                <div className="printer-address-row">
                  <input
                    className="input"
                    value={draft.address}
                    onChange={(e) => patchDraft(device, { address: e.target.value })}
                    placeholder={
                      draft.transport === 'network' ? '192.168.1.50:9100' : draft.transport === 'windows' ? 'EPSON TM-T20III' : 'ornek-fis'
                    }
                    spellCheck={false}
                  />
                  {draft.transport !== 'file' && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => detect(device, draft.transport === 'network' ? 'network' : 'windows')}
                      disabled={detecting === device}
                    >
                      {detecting === device ? 'Aranıyor…' : draft.transport === 'network' ? 'Ağda ara' : 'Yazıcıları bul'}
                    </button>
                  )}
                </div>
              </label>

              {detected && (
                <div className="printer-found" id={`printer-found-${device}`} role="region" aria-live="polite" aria-label="Bulunan yazıcılar">
                  {detected.note && <p className="printer-found-note">{detected.note}</p>}
                  {detected.windows.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      className="printer-found-row"
                      onClick={() => patchDraft(device, { transport: 'windows', address: p.name })}
                    >
                      <b>{p.name}</b>
                      <small>
                        {p.driver} · {p.port} {p.status && p.status !== 'Normal' ? `· ${p.status}` : ''}
                      </small>
                    </button>
                  ))}
                  {detected.lan.map((p) => (
                    <button
                      key={p.ip}
                      type="button"
                      className="printer-found-row"
                      onClick={() => patchDraft(device, { transport: 'network', address: `${p.ip}:${p.port}` })}
                    >
                      <b>
                        {p.ip}:{p.port}
                      </b>
                      <small>Ağda 9100 portu açık</small>
                    </button>
                  ))}
                  {!detected.note && !detected.windows.length && !detected.lan.length && (
                    <p className="printer-found-note">
                      Sonuç yok. Yazıcı adını elle yazabilir veya yazıcının IP'sini girebilirsiniz.
                    </p>
                  )}
                  {detected.note && (
                    <div className="printer-help">
                      <b>Yazıcı listesi alınamadı</b>
                      <p>
                        Yolu: <b>Ayarlar → Bluetooth ve cihazlar → Yazıcılar ve tarayıcılar</b>. Oradaki adı
                        kopyalayıp yukarıdaki “Windows yazıcı adı” alanına elle yazabilirsin — liste olmadan da
                        yazdırma çalışır.
                      </p>
                      <p className="printer-help-detail">{detected.note}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="printer-row">
                <div className="field">
                  <span>Kağıt genişliği</span>
                  <div className="segmented" role="group" aria-label="Kağıt genişliği">
                    {[80, 58].map((w) => (
                      <button
                        key={w}
                        type="button"
                        className={draft.paperWidth === w ? 'on' : ''}
                        aria-pressed={draft.paperWidth === w}
                        onClick={() => patchDraft(device, { paperWidth: w })}
                      >
                        {w} mm · {w === 80 ? 42 : 32} karakter
                      </button>
                    ))}
                  </div>
                </div>
                <label className="printer-toggle">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => patchDraft(device, { enabled: e.target.checked })}
                  />
                  <span>{draft.enabled ? 'Bu rol için aktif' : 'Pasif'}</span>
                </label>
              </div>

              <div className="printer-actions">
                <button className="btn primary" onClick={() => save(device)} disabled={busy === device}>
                  {busy === device ? 'Kaydediliyor…' : 'Kaydet'}
                </button>
                <button className="btn" onClick={() => test(device)} disabled={!draft.id || testing === draft.id}>
                  {testing === draft.id ? 'Gönderiliyor…' : 'Test fişi'}
                </button>
                {draft.id && (
                  <button className="btn danger" onClick={() => remove(device)} disabled={busy === device}>
                    Sil
                  </button>
                )}
              </div>
            </section>
          )
        })}
      </div>

      <section className="panel printer-jobs">
        <div className="panel-head">
          <h3>Son yazdırma işleri</h3>
          <span className="pill">son 12 iş</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 70 }}>#</th>
              <th>Fiş</th>
              <th>Yazıcı</th>
              <th>Durum</th>
              <th>Tarih</th>
              <th style={{ width: 100 }} />
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{job.id}</td>
                <td>{job.kind === 'kot' ? 'Mutfak KOT' : job.kind === 'cancel' ? 'İptal fişi' : 'Müşteri fişi'}</td>
                <td>{job.printer_name ?? (job.device === 'kitchen' ? 'Mutfak' : 'Kasa')}</td>
                <td>
                  <span className={`job-status ${job.status}`}>
                    {job.status === 'queued' ? 'Kuyrukta' : job.status === 'printing' ? 'Basılıyor' : job.status === 'printed' ? 'Basıldı' : 'Hata'}
                  </span>
                  {job.error && <small className="job-error">{job.error}</small>}
                </td>
                <td>{new Date(job.created_at).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</td>
                <td>
                  {job.status === 'failed' && (
                    <button
                      className="btn sm"
                      onClick={() =>
                        api
                          .retryPrintJob(job.id)
                          .then(() => {
                            onOk(`#${job.id} yeniden kuyruğa alındı`)
                            load()
                          })
                          .catch((e) => onError(e.message))
                      }
                    >
                      Tekrar dene
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!jobs.length && (
              <tr>
                <td colSpan={6} className="table-empty">
                  Henüz yazdırma işi yok. Test fişi göndererek başlayın.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
