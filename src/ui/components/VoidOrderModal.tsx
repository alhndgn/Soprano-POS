import { useState } from 'react'
import { api } from '../api.ts'

type Props = {
  orderId: number
  onClose: () => void
  onDone: () => void
  onError: (message: string) => void
}

export default function VoidOrderModal({ orderId, onClose, onDone, onError }: Props) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const valid = reason.trim().length >= 3

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    try {
      await api.voidOrder(orderId, reason.trim())
      onDone()
    } catch (e: any) {
      onError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal void-modal" role="dialog" aria-modal="true" aria-label="Adisyon iptali">
        <p className="eyebrow danger-eyebrow">YIKICI İŞLEM</p>
        <h3>Adisyonu iptal et</h3>
        <div className="sub">Adisyon #{orderId} raporlarda görünecek. İptal nedeni zorunludur.</div>
        <label className="field">
          <span>İptal nedeni</span>
          <textarea
            className="textarea"
            autoFocus
            maxLength={300}
            value={reason}
            placeholder="Örn: Müşteri siparişten vazgeçti"
            onChange={(e) => setReason(e.target.value)}
          />
          <small className="field-counter">{reason.length}/300</small>
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Vazgeç</button>
          <button type="button" className="btn danger" onClick={() => void submit()} disabled={!valid || busy}>
            {busy ? 'İptal ediliyor…' : 'Adisyonu iptal et'}
          </button>
        </div>
      </div>
    </div>
  )
}
