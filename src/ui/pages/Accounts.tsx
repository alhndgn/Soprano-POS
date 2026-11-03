import { useEffect, useState } from 'react'
import { api, money, type Customer, type CustomerEntry } from '../api.ts'

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function Accounts() {
  const [q, setQ] = useState('')
  const [list, setList] = useState<Customer[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [detail, setDetail] = useState<{ customer: Customer; entries: CustomerEntry[] } | null>(null)
  const [summary, setSummary] = useState<{ total: number; debtors: number; month: { sales: number; collections: number } } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newNote, setNewNote] = useState('')
  const [newLimit, setNewLimit] = useState('')
  const [payOpen, setPayOpen] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<'cash' | 'card'>('cash')
  const [busy, setBusy] = useState(false)

  const flash = (text: string) => {
    setNotice(text)
    window.setTimeout(() => setNotice(null), 2600)
  }

  const loadList = async (search = q) => {
    try {
      const r = await api.customers(search)
      setList(r.customers)
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const loadSummary = async () => {
    try {
      const r = await api.accountsReport()
      setSummary({ total: r.total, debtors: r.debtors, month: r.month })
    } catch {
      /* özet yüklenemezse sessiz geç */
    }
  }

  const loadDetail = async (id: number) => {
    try {
      setDetail(await api.customer(id))
      setActiveId(id)
    } catch (e: any) {
      setError(e.message)
    }
  }

  useEffect(() => {
    void loadList('')
    void loadSummary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => void loadList(q), 250)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const refreshAll = async (id?: number) => {
    await loadList()
    await loadSummary()
    if (id) await loadDetail(id)
  }

  const createCustomer = async () => {
    if (busy || newName.trim().length < 2) return
    setBusy(true)
    try {
      const limit = Math.round(Number(newLimit.replace(',', '.')) * 100)
      const r = await api.createCustomer({
        name: newName.trim(),
        phone: newPhone.trim() || null,
        note: newNote.trim() || null,
        creditLimit: Number.isFinite(limit) ? limit : 0,
      })
      setNewOpen(false)
      setNewName('')
      setNewPhone('')
      setNewNote('')
      setNewLimit('')
      await refreshAll(r.customer.id)
      flash('Müşteri eklendi')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const takePayment = async () => {
    if (!detail || busy) return
    const amount = Math.round(Number(payAmount.replace(',', '.')) * 100)
    if (!Number.isFinite(amount) || amount <= 0) return
    setBusy(true)
    try {
      const r = await api.customerPayment(detail.customer.id, { amount, method: payMethod })
      setPayOpen(false)
      setPayAmount('')
      await refreshAll(detail.customer.id)
      flash(`Tahsilat alındı: ${money(r.applied)}`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const waLink = (phone: string, name: string, balance: number) => {
    const digits = phone.replace(/\D/g, '')
    const intl = digits.startsWith('90') ? digits : digits.startsWith('0') ? `90${digits.slice(1)}` : `90${digits}`
    const text = `Merhaba ${name}, ${money(balance)} tutarında açık hesabınız görünüyor. Uygun olduğunuzda bekleriz.`
    return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="head-actions">
          <div className="head-stat"><span>Toplam alacak</span><b>{money(summary?.total ?? 0)}</b></div>
          <div className="head-stat"><span>Borçlu müşteri</span><b>{summary?.debtors ?? 0}</b></div>
          <div className="head-stat"><span>Bu ay cari satış</span><b>{money(summary?.month.sales ?? 0)}</b></div>
          <div className="head-stat"><span>Bu ay tahsilat</span><b>{money(summary?.month.collections ?? 0)}</b></div>
        </div>
      </div>

      {error && <div className="toast error" role="alert">{error}</div>}
      {notice && <div className="toast ok" role="status">{notice}</div>}

      <div className="accounts-layout">
        <section className="panel accounts-list-panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">CARİ HESAPLAR</p>
              <h3>Müşteriler</h3>
            </div>
            <button type="button" className="btn success sm" onClick={() => setNewOpen(true)}>+ Yeni</button>
          </div>
          <div className="accounts-search">
            <input
              className="input"
              placeholder="İsim veya telefon ara…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="accounts-list">
            {loading && <div className="kds-empty">Yükleniyor…</div>}
            {!loading && list.length === 0 && <div className="kds-empty">Kayıtlı müşteri yok</div>}
            {list.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`account-row${activeId === c.id ? ' on' : ''}`}
                onClick={() => void loadDetail(c.id)}
              >
                <div className="account-row-main">
                  <b>{c.name}</b>
                  <small>{c.phone || 'telefon yok'}</small>
                </div>
                <div className={`account-row-balance${c.balance > 0 ? ' debt' : c.balance < 0 ? ' credit' : ''}`}>
                  {money(Math.abs(c.balance))}
                  <small>{c.balance > 0 ? 'borç' : c.balance < 0 ? 'alacak' : 'kapalı'}</small>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="panel accounts-detail-panel">
          {!detail && <div className="kds-empty">Soldan bir müşteri seç</div>}
          {detail && (
            <>
              <div className="account-head">
                <div>
                  <h3>{detail.customer.name}</h3>
                  <div className="account-sub">
                    {detail.customer.phone ? <a href={`tel:${detail.customer.phone}`}>{detail.customer.phone}</a> : 'telefon yok'}
                    {detail.customer.note && <span> · {detail.customer.note}</span>}
                  </div>
                </div>
                <div className="account-head-right">
                  <span className={`account-big${detail.customer.balance > 0 ? ' debt' : ' ok'}`}>
                    {money(Math.abs(detail.customer.balance))}
                    <small>{detail.customer.balance > 0 ? 'borç' : detail.customer.balance < 0 ? 'alacak' : 'kapalı'}</small>
                  </span>
                  {detail.customer.balance > 0 && (
                    <button type="button" className="btn success" onClick={() => { setPayOpen(true); setPayAmount((detail.customer.balance / 100).toFixed(2).replace('.', ',')) }}>
                      Tahsilat Al
                    </button>
                  )}
                  {detail.customer.phone && detail.customer.balance > 0 && (
                    <a className="btn ghost" href={waLink(detail.customer.phone, detail.customer.name, detail.customer.balance)} target="_blank" rel="noreferrer">
                      WhatsApp
                    </a>
                  )}
                </div>
              </div>

              {detail.customer.creditLimit > 0 && (
                <div className="account-limit">
                  Kredi limiti: <b>{money(detail.customer.creditLimit)}</b>
                  {detail.customer.balance > detail.customer.creditLimit && <span className="account-limit-warn">limit aşıldı</span>}
                </div>
              )}

              <div className="report-table-scroll">
                <table className="data-table account-table">
                  <thead>
                    <tr><th>Tarih</th><th>Açıklama</th><th>Borç</th><th>Alacak</th><th>İşlemi yapan</th></tr>
                  </thead>
                  <tbody>
                    {detail.entries.length === 0 && (
                      <tr><td colSpan={5}><div className="kds-empty">Hareket yok</div></td></tr>
                    )}
                    {detail.entries.map((e) => (
                      <tr key={e.id}>
                        <td>{fmtDate(e.createdAt)}</td>
                        <td>
                          {e.kind === 'sale' ? (
                            <>Adisyon {e.orderId ? `#${e.orderId}` : ''} {e.tableName ? `· ${e.tableName}` : ''}</>
                          ) : e.kind === 'payment' ? (
                            <>Tahsilat {e.method === 'card' ? '(kart)' : '(nakit)'}</>
                          ) : (
                            <>Düzeltme</>
                          )}
                          {e.note && e.kind === 'adjust' && <small>{e.note}</small>}
                        </td>
                        <td className="debit">{e.amount > 0 ? money(e.amount) : '—'}</td>
                        <td className="credit">{e.amount < 0 ? money(-e.amount) : '—'}</td>
                        <td>{e.createdBy || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      {newOpen && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setNewOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Yeni müşteri">
            <p className="panel-kicker">CARİ</p>
            <h3>Yeni müşteri</h3>
            <label className="field">
              <span>Ad soyad</span>
              <input className="input" autoFocus maxLength={80} value={newName} onChange={(e) => setNewName(e.target.value)} />
            </label>
            <label className="field">
              <span>Telefon</span>
              <input className="input" maxLength={30} value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="05xx xxx xx xx" />
            </label>
            <label className="field">
              <span>Not</span>
              <input className="input" maxLength={200} value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Örn. günlük öğle menüsü" />
            </label>
            <label className="field">
              <span>Kredi limiti (₺) <small>0 = sınırsız</small></span>
              <input className="input" inputMode="decimal" value={newLimit} onChange={(e) => setNewLimit(e.target.value)} placeholder="0" />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setNewOpen(false)} disabled={busy}>Vazgeç</button>
              <button type="button" className="btn success" onClick={() => void createCustomer()} disabled={busy || newName.trim().length < 2}>
                {busy ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {payOpen && detail && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setPayOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Tahsilat">
            <p className="panel-kicker">{detail.customer.name}</p>
            <h3>Tahsilat al</h3>
            <div className="sub">Açık bakiye: <b>{money(detail.customer.balance)}</b></div>
            <label className="field">
              <span>Tutar</span>
              <input className="input payment-money-input" inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </label>
            <div className="segmented" role="group" aria-label="Ödeme yöntemi">
              <button type="button" className={payMethod === 'cash' ? 'on' : ''} onClick={() => setPayMethod('cash')}>Nakit</button>
              <button type="button" className={payMethod === 'card' ? 'on' : ''} onClick={() => setPayMethod('card')}>Kart</button>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setPayOpen(false)} disabled={busy}>Vazgeç</button>
              <button type="button" className="btn success" onClick={() => void takePayment()} disabled={busy || !payAmount.trim()}>
                {busy ? 'Alınıyor…' : 'Tahsilatı kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
