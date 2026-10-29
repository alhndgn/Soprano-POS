import { useMemo, useState } from 'react'
import {
  defaultPaymentSelection,
  remainingQty,
  selectedPaymentTotal,
  type PaymentSelection,
  type PaymentSelectionLine,
} from '../payment.ts'
import { money, type Discount, type Order, type PaymentInput, type PaymentPayload, type PaymentResult } from '../api.ts'

type Props = {
  order: Order
  onClose: () => void
  onSubmit: (payload: PaymentPayload) => Promise<PaymentResult>
  onDone: (result: PaymentResult) => void | Promise<void>
  onError: (message: string) => void
}

type DiscountMode = 'none' | 'percent' | 'fixed'

type DisplayLine = Order['lines'][number] & PaymentSelectionLine

const parseCents = (value: string) => Math.round(Number(value.replace(',', '.')) * 100) || 0
const inputMoney = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

function distributePreview(grosses: number[], amount: number): number[] {
  const total = grosses.reduce((sum, gross) => sum + gross, 0)
  if (!amount || !total) return grosses.map(() => 0)
  const parts = grosses.map((gross) => Math.min(gross, Math.floor((amount * gross) / total)))
  let remainder = amount - parts.reduce((sum, part) => sum + part, 0)
  for (let i = parts.length - 1; i >= 0 && remainder > 0; i--) {
    const room = Math.max(0, grosses[i] - parts[i])
    const add = Math.min(room, remainder)
    parts[i] += add
    remainder -= add
  }
  return parts
}

function discountFor(gross: number, mode: DiscountMode, value: string): number {
  if (mode === 'none') return 0
  if (mode === 'percent') return Math.min(gross, Math.round((gross * Math.min(100, Number(value) || 0)) / 100))
  return Math.min(gross, parseCents(value))
}

export default function PaymentModal({ order, onClose, onSubmit, onDone, onError }: Props) {
  const lockedDiscount = order.payments.length > 0 || order.discount.amount > 0
  const initialMode: DiscountMode = order.discount.type
  const [selection, setSelection] = useState<PaymentSelection>(() => defaultPaymentSelection(order.lines))
  const [method, setMethod] = useState<'cash' | 'card'>('cash')
  const [discountMode, setDiscountMode] = useState<DiscountMode>(initialMode)
  const [discountText, setDiscountText] = useState(
    order.discount.type === 'fixed' ? inputMoney(order.discount.value) : order.discount.value ? String(order.discount.value) : '',
  )
  const [amountText, setAmountText] = useState('')
  const [tenderedText, setTenderedText] = useState('')
  const [customerName, setCustomerName] = useState(order.customer_name ?? '')
  const [staged, setStaged] = useState<PaymentInput[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const grossTotal = useMemo(() => order.lines.reduce((sum, line) => sum + line.gross_amount, 0), [order.lines])
  const discountTotal = lockedDiscount
    ? order.discount.amount
    : discountFor(grossTotal, discountMode, discountText)
  const discountParts = useMemo(
    () => (lockedDiscount ? order.lines.map((line) => line.discount_amount) : distributePreview(order.lines.map((line) => line.gross_amount), discountTotal)),
    [discountTotal, lockedDiscount, order.lines],
  )

  const displayLines = useMemo<DisplayLine[]>(() => {
    const originalDue = new Map<number, number>()
    const remainingQtyByLine = new Map<number, number>()
    for (const [index, line] of order.lines.entries()) {
      originalDue.set(
        line.id,
        lockedDiscount ? line.remaining_amount : Math.max(0, line.gross_amount - discountParts[index] - line.paid_amount),
      )
      remainingQtyByLine.set(line.id, remainingQty(line))
    }
    for (const payment of staged) {
      let paymentLeft = payment.amount
      for (const allocation of payment.allocations) {
        if (paymentLeft <= 0) break
        const due = originalDue.get(allocation.lineId) ?? 0
        const availableQty = remainingQtyByLine.get(allocation.lineId) ?? 0
        if (due <= 0 || availableQty <= 0) continue
        const requestedQty = Math.min(availableQty, allocation.qty)
        const requestedAmount = requestedQty >= availableQty ? due : Math.floor((due * requestedQty) / availableQty)
        const applied = Math.min(paymentLeft, requestedAmount)
        originalDue.set(allocation.lineId, due - applied)
        const unitDue = Math.max(1, Math.floor(due / availableQty))
        remainingQtyByLine.set(allocation.lineId, Math.max(0, availableQty - Math.min(availableQty, Math.floor(applied / unitDue))))
        paymentLeft -= applied
      }
    }
    return order.lines.map((line) => {
      const remaining = Math.max(0, originalDue.get(line.id) ?? 0)
      const paidQty = remaining === 0 ? line.qty : line.paid_qty
      return {
        ...line,
        remaining_amount: remaining,
        paid_qty: paidQty,
        payment_status: remaining === 0 ? 'paid' : paidQty > 0 || line.paid_amount > 0 ? 'partial' : 'unpaid',
      }
    })
  }, [discountParts, lockedDiscount, order.lines, staged])

  const selectedTotal = selectedPaymentTotal(displayLines, selection)
  const stagedApplied = staged.reduce((sum, payment) => sum + payment.amount, 0)
  const netOrderTotal = Math.max(0, grossTotal - discountTotal)
  const remainingOrder = Math.max(0, netOrderTotal - stagedApplied)
  const parsedAmount = amountText ? parseCents(amountText) : selectedTotal
  const parsedTendered = tenderedText ? parseCents(tenderedText) : parsedAmount
  const selectedAllocations = Object.entries(selection)
    .filter(([, qty]) => qty > 0)
    .map(([lineId, qty]) => ({ lineId: Number(lineId), qty }))

  const selectLine = (line: DisplayLine) => {
    const available = remainingQty(line)
    if (available <= 0) return
    setSelection((current) => ({ ...current, [line.id]: current[line.id] ? 0 : available }))
    setAmountText('')
    setTenderedText('')
  }

  const changeQty = (line: DisplayLine, delta: number) => {
    const available = remainingQty(line)
    const next = Math.max(0, Math.min(available, (selection[line.id] ?? 0) + delta))
    setSelection((current) => ({ ...current, [line.id]: next }))
    setAmountText('')
    setTenderedText('')
  }

  const addPayment = () => {
    setError(null)
    if (!selectedAllocations.length || selectedTotal <= 0) {
      setError('Ödeme için en az bir ürün seç.')
      return
    }
    if (parsedAmount <= 0) {
      setError('Ödeme tutarı sıfır olamaz.')
      return
    }
    const applied = Math.min(parsedAmount, selectedTotal)
    if (method === 'card' && applied !== parsedAmount) {
      setError('Kart tutarı seçilen ürünlerin borcunu aşamaz.')
      return
    }
    if (method === 'cash' && parsedTendered < applied) {
      setError('Müşteriden alınan tutar, ödeme tutarından küçük olamaz.')
      return
    }
    setStaged((current) => [
      ...current,
      {
        method,
        amount: applied,
        tendered: method === 'cash' ? parsedTendered : applied,
        allocations: selectedAllocations,
      },
    ])
    setSelection({})
    setAmountText('')
    setTenderedText('')
  }

  const submit = async () => {
    setError(null)
    const payments = [...staged]
    if (selectedAllocations.length && selectedTotal > 0) {
      const applied = Math.min(parsedAmount, selectedTotal)
      if (method === 'card' && applied !== parsedAmount) {
        setError('Kart tutarı seçilen ürünlerin borcunu aşamaz.')
        return
      }
      if (method === 'cash' && parsedTendered < applied) {
        setError('Müşteriden alınan tutar, ödeme tutarından küçük olamaz.')
        return
      }
      payments.push({
        method,
        amount: applied,
        tendered: method === 'cash' ? parsedTendered : applied,
        allocations: selectedAllocations,
      })
    }
    if (!payments.length) {
      setError('Ödenecek ürün seçilmedi.')
      return
    }
    setBusy(true)
    try {
      const discount: Discount = {
        type: lockedDiscount ? order.discount.type : discountMode,
        value: lockedDiscount ? order.discount.value : discountMode === 'fixed' ? parseCents(discountText) : Number(discountText) || 0,
        amount: discountTotal,
      }
      const result = await onSubmit({
        payments,
        discount: { type: discount.type, value: discount.value },
        customerName: customerName.trim() || null,
      })
      await onDone(result)
    } catch (e: any) {
      setError(e.message)
      onError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop payment-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="payment-modal" role="dialog" aria-modal="true" aria-label="Adisyon ödemesi">
        <div className="payment-head">
          <div>
            <p className="panel-kicker">ÖDEME MERKEZİ</p>
            <h3>Adisyon #{order.id}</h3>
            <div className="sub">{order.table_name ?? 'Paket'} · {order.lines.length} ürün satırı</div>
          </div>
          <button type="button" className="btn ghost sm" onClick={onClose}>Kapat</button>
        </div>

        <div className="payment-body">
          <section className="payment-lines-panel">
            <div className="payment-section-head">
              <div>
                <h4>Ödenecek ürünler</h4>
                <span>{displayLines.filter((line) => (selection[line.id] ?? 0) > 0).length} satır seçili</span>
              </div>
              <span className="pill">Kalan {money(remainingOrder)}</span>
            </div>
            <div className="payment-lines" aria-live="polite">
              {displayLines.map((line) => {
                const available = remainingQty(line)
                const selected = selection[line.id] ?? 0
                const checked = selected > 0
                return (
                  <div className={`payment-line${checked ? ' selected' : ''}${available <= 0 ? ' paid' : ''}`} key={line.id}>
                    <button type="button" className="payment-line-main" disabled={available <= 0} onClick={() => selectLine(line)}>
                      <span className={`payment-check${checked ? ' on' : ''}`} aria-hidden="true">{checked ? '✓' : ''}</span>
                      <span className="payment-line-copy">
                        <b>{line.name}</b>
                        {line.modifiers.length > 0 && <small>{line.modifiers.map((m) => m.name).join(' · ')}</small>}
                        {line.ingredients.length > 0 && <small>{line.ingredients.map((i) => i.mode === 'removed' ? `${i.name} yok` : `+ ${i.name}`).join(' · ')}</small>}
                      </span>
                    </button>
                    <div className="payment-line-side">
                      <span className={`payment-status ${line.payment_status}`}>
                        {line.payment_status === 'paid' ? 'Ödendi' : line.payment_status === 'partial' ? 'Kısmi ödendi' : 'Ödenmedi'}
                      </span>
                      {available > 0 && (
                        <div className="payment-qty">
                          <button type="button" aria-label={`${line.name} adet azalt`} onClick={() => changeQty(line, -1)}>−</button>
                          <b>{selected || 0}/{available}</b>
                          <button type="button" aria-label={`${line.name} adet artır`} onClick={() => changeQty(line, 1)}>+</button>
                        </div>
                      )}
                      <strong>{money(line.remaining_amount)}</strong>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="payment-summary-panel">
            <div className="payment-total-card">
              <span>Ödenecek toplam</span>
              <strong>{money(remainingOrder)}</strong>
              <small>Seçilen ürünler: {money(selectedTotal)}</small>
            </div>

            <div className="payment-section">
              <div className="payment-section-title"><h4>İskonto</h4><span>{lockedDiscount ? 'Uygulandı' : 'Opsiyonel'}</span></div>
              <div className="discount-modes">
                {(['none', 'percent', 'fixed'] as DiscountMode[]).map((mode) => (
                  <button type="button" key={mode} className={`discount-mode${discountMode === mode ? ' on' : ''}`} disabled={lockedDiscount} onClick={() => { setDiscountMode(mode); setDiscountText('') }}>
                    {mode === 'none' ? 'Yok' : mode === 'percent' ? '%' : '₺'}
                  </button>
                ))}
                <input className="input" aria-label="İskonto değeri" disabled={lockedDiscount || discountMode === 'none'} inputMode="decimal" placeholder={discountMode === 'percent' ? '0' : '0,00'} value={discountText} onChange={(e) => setDiscountText(e.target.value)} />
              </div>
              <div className="discount-result"><span>İskonto tutarı</span><b>− {money(discountTotal)}</b></div>
            </div>

            <div className="payment-section">
              <div className="payment-section-title"><h4>Ödeme yöntemi</h4><span>{method === 'cash' ? 'Nakit tahsilat' : 'POS cihazı'}</span></div>
              <div className="payment-method-cards">
                <button type="button" className={`payment-method-card${method === 'cash' ? ' on cash' : ''}`} onClick={() => setMethod('cash')}><span>₺</span><b>Nakit</b><small>Para üstü hesaplanır</small></button>
                <button type="button" className={`payment-method-card${method === 'card' ? ' on card' : ''}`} onClick={() => setMethod('card')}><span>▣</span><b>Kart</b><small>POS cihazından tahsilat</small></button>
              </div>
            </div>

            <div className="payment-section payment-inputs">
              <label>Ödeme tutarı<input className="input payment-money-input" inputMode="decimal" value={amountText} placeholder={inputMoney(selectedTotal)} onChange={(e) => setAmountText(e.target.value)} /></label>
              {method === 'cash' && <label>Müşteriden alınan<input className="input payment-money-input" inputMode="decimal" value={tenderedText} placeholder={inputMoney(parsedAmount)} onChange={(e) => setTenderedText(e.target.value)} /></label>}
              {method === 'cash' && <div className="change-row"><span>Para üstü</span><b>{money(Math.max(0, parsedTendered - parsedAmount))}</b></div>}
              <label>Müşteri adı <small>(isteğe bağlı)</small><input className="input" value={customerName} maxLength={120} placeholder="Örn: Ayşe Yılmaz" onChange={(e) => setCustomerName(e.target.value)} /></label>
            </div>

            {staged.length > 0 && <div className="staged-payments"><div className="payment-section-title"><h4>Eklenen ödemeler</h4><span>{money(stagedApplied)}</span></div>{staged.map((payment, index) => <div className="staged-row" key={index}><span>{payment.method === 'cash' ? 'Nakit' : 'Kart'}</span><b>{money(payment.amount)}</b></div>)}</div>}
            {error && <div className="payment-error" role="alert">{error}</div>}
          </section>
        </div>

        <div className="payment-foot">
          <button type="button" className="btn" onClick={selectedAllocations.length ? addPayment : onClose} disabled={busy}>{selectedAllocations.length ? 'Ödemeyi ekle' : 'Vazgeç'}</button>
          <button type="button" className="btn primary payment-submit" onClick={() => void submit()} disabled={busy || (!selectedAllocations.length && staged.length === 0)}>{busy ? 'İşleniyor…' : remainingOrder <= 0 ? 'Adisyonu kapat' : 'Ödemeyi tamamla'}</button>
        </div>
      </div>
    </div>
  )
}
