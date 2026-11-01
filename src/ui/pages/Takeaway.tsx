import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../App.tsx'
import { api, elapsed, money } from '../api.ts'

export default function Takeaway() {
  const { boot, refresh } = useApp()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const orders = boot?.takeaway ?? []
  const total = orders.reduce((s, o) => s + o.total, 0)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.createTakeaway({
        customerName: form.name.trim() || undefined,
        customerPhone: form.phone.trim() || undefined,
      })
      await refresh()
      setOpen(false)
      setForm({ name: '', phone: '' })
      navigate(`/order/${res.id}`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="head-actions">
          <div className="head-stat"><span>Gel al siparişi</span><b>{orders.length}</b></div>
          <div className="head-stat"><span>Açık tutar</span><b>{money(total)}</b></div>
          <button className="btn primary" onClick={() => setOpen(true)}>+ Yeni gel al</button>
        </div>
      </div>

      {error && <div className="toast error" role="alert">{error}</div>}

      <div className="takeaway-grid">
        {orders.length === 0 && (
          <div className="panel takeaway-empty">
            <b>Açık gel al siparişi yok</b>
            <p>Müşteri gelip paket sipariş verdiyse “+ Yeni gel al” ile aç.</p>
          </div>
        )}
        {orders.map((o) => (
          <button key={o.id} type="button" className="takeaway-card" onClick={() => navigate(`/order/${o.id}`)}>
            <div className="takeaway-card-top">
              <b>{o.customer_name ?? 'İsimsiz müşteri'}</b>
              <span className="takeaway-card-total">{money(o.total)}</span>
            </div>
            <div className="takeaway-card-meta">
              <span>#{o.id}</span>
              {o.customer_phone && <span>{o.customer_phone}</span>}
              <span>{elapsed(o.opened_at)}</span>
            </div>
            <div className={`takeaway-card-state${o.sent_lines ? ' sent' : ''}`}>
              {o.sent_lines ? 'mutfakta' : 'gönderilmedi'}
            </div>
          </button>
        ))}
      </div>

      {open && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal takeaway-modal" role="dialog" aria-modal="true" aria-label="Gel al siparişi aç">
            <h3>Yeni gel al siparişi</h3>
            <label className="field" style={{ marginTop: 12 }}>
              <span>Müşteri adı (opsiyonel)</span>
              <input
                className="input"
                autoFocus
                maxLength={60}
                value={form.name}
                placeholder="Örn. Ahmet"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Telefon (opsiyonel)</span>
              <input
                className="input"
                maxLength={24}
                value={form.phone}
                placeholder="05xx xxx xx xx"
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setOpen(false)} disabled={busy}>Vazgeç</button>
              <button className="btn primary" onClick={create} disabled={busy}>
                {busy ? 'Açılıyor…' : 'Siparişi aç'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
