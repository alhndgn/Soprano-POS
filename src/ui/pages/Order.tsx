import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp } from '../App.tsx'
import { api, elapsed, lineTotal, money, type Order, type OrderLine, type Product } from '../api.ts'
import PaymentModal from '../components/PaymentModal.tsx'
import VoidOrderModal from '../components/VoidOrderModal.tsx'

type IngChoice = { id: number; mode: 'removed' | 'added' }
type SheetState = {
  product: Product
  variantId: number | null
  qty: number
  mods: number[]
  ings: IngChoice[]
  note: string
}

const MAX_QTY = 20

export default function OrderPage() {
  const { id } = useParams()
  const orderId = Number(id)
  const { boot, me, refresh } = useApp()
  const navigate = useNavigate()

  const [order, setOrder] = useState<Order | null>(null)
  const [catId, setCatId] = useState<number | null>(null)
  const [sheet, setSheet] = useState<SheetState | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [descOpen, setDescOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const o = await api.order(orderId)
      setOrder(o)
      setError(null)
    } catch (e: any) {
      setError(e.message)
    }
  }, [orderId])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 6000)
    return () => clearInterval(t)
  }, [load])

  const menu = boot?.menu ?? []
  const activeCat = menu.find((c) => c.id === catId) ?? menu[0]

  const totals = order?.totals
  const canPay = me?.role === 'cashier' || me?.role === 'manager'
  const canVoid = me?.role === 'manager'

  const doAction = async (fn: () => Promise<Order>) => {
    setBusy(true)
    try {
      const o = await fn()
      setOrder(o)
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const pickProduct = (p: Product) => {
    const needVariant = p.variants.length > 1
    if (!needVariant && p.groups.length === 0) {
      void doAction(() =>
        api.addLine(orderId, { productId: p.id, variantId: p.variants[0]?.id ?? null, qty: 1, modifierIds: [] }),
      )
      return
    }
    setDescOpen(false)
    setSheet({
      product: p,
      variantId: p.variants.length === 1 ? p.variants[0].id : null,
      qty: 1,
      mods: [],
      ings: [],
      note: '',
    })
  }

  const sheetPrice = useMemo(() => {
    if (!sheet) return 0
    const v = sheet.product.variants.find((x) => x.id === sheet.variantId)
    const mods = sheet.product.groups.flatMap((g) => g.modifiers).filter((m) => sheet.mods.includes(m.id))
    const added = sheet.product.ingredients
      .filter((i) => sheet.ings.some((c) => c.id === i.id && c.mode === 'added'))
      .reduce((s, i) => s + i.price, 0)
    return ((v?.price ?? 0) + mods.reduce((s, m) => s + m.price, 0) + added) * sheet.qty
  }, [sheet])

  const sheetValid = useMemo(() => {
    if (!sheet) return false
    if (sheet.product.variants.length > 1 && !sheet.variantId) return false
    return sheet.product.groups.every((g) => {
      const count = g.modifiers.filter((m) => sheet.mods.includes(m.id)).length
      return count >= g.min && count <= g.max
    })
  }, [sheet])

  const addFromSheet = async () => {
    if (!sheet) return
    await doAction(() =>
      api.addLine(orderId, {
        productId: sheet.product.id,
        variantId: sheet.variantId,
        qty: sheet.qty,
        modifierIds: sheet.mods,
        ingredients: sheet.ings,
        note: sheet.note.trim() || undefined,
      }),
    )
    setSheet(null)
  }

  if (!order) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h1>Adisyon</h1>
            <div className="sub">{error ?? 'Yükleniyor…'}</div>
          </div>
          <button className="btn ghost" onClick={() => navigate('/tables')}>
            ← Masalar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="order-layout">
      <nav className="cat-rail" aria-label="Ürün kategorileri">
        <span className="cat-rail-title">Menü</span>
        {menu.map((c) => (
          <button key={c.id} className={`cat-btn${c.id === activeCat?.id ? ' on' : ''}`} onClick={() => setCatId(c.id)}>
            <span>{c.emoji}</span>
            {c.name}
          </button>
        ))}
      </nav>

      <div className="product-panel">
        <div className="product-head">
          <div>
            <p className="eyebrow">SİPARİŞ OLUŞTUR</p>
            <h2>{activeCat?.name}</h2>
            <div className="sub" style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 4 }}>
              {order.table_name ?? 'Masa'} · {order.guest_count} kişi · {elapsed(order.opened_at)}
            </div>
          </div>
          <button className="btn ghost sm" onClick={() => navigate('/tables')}>
            ← Masalar
          </button>
        </div>

        <div className="product-grid">
          {(activeCat?.products ?? []).map((p) => {
            const min = Math.min(...p.variants.map((v) => v.price))
            return (
              <button
                type="button"
                key={p.id}
                className="product-card"
                aria-label={`${p.name}, ${money(min)}'den başlayan fiyat`}
                onClick={() => pickProduct(p)}
                disabled={busy}
              >
                {p.imageUrl ? (
                  <img className="product-img" src={p.imageUrl} alt={p.name} loading="eager" decoding="async" />
                ) : (
                  <div className="product-img placeholder">{activeCat?.emoji ?? '🍽'}</div>
                )}
                <div className="product-body">
                  <div className="product-name">{p.name}</div>
                  <div className="product-hint">
                    {p.variants.length > 1 ? `${p.variants.length} boy` : p.variants[0]?.name}
                    {p.groups.length ? ` · ${p.groups.length} seçenek` : ''}
                  </div>
                  <div className="product-price">
                    <span>{money(min)}</span>
                    <span className="product-add">+ Ekle</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="cart">
        <div className="cart-head">
          <div>
            <p className="panel-kicker">AKTİF ADİSYON</p>
            <h2>Adisyon #{order.id}</h2>
            <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 3 }}>
              {order.staff_name} · {order.lines.length} satır
              {order.lines.some((l) => l.status === 'new')
                ? ` · ${order.lines.filter((l) => l.status === 'new').length} yeni`
                : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {canVoid && (
              <button
                type="button"
                className="btn ghost sm"
                style={{ color: 'var(--danger)', fontSize: 11.5, padding: '5px 9px' }}
                onClick={() => setVoidOpen(true)}
              >
                Adisyonu iptal
              </button>
            )}
            <span className="pill">{order.guest_count} kişi</span>
          </div>
        </div>

        <div className="cart-lines" aria-live="polite">
          {order.lines.length === 0 && (
            <div className="empty-cart">
              <span>🍕</span>
              Ürün seçmek için soldaki menüye dokun
            </div>
          )}
          {order.lines.map((l) => (
            <CartLine
              key={l.id}
              line={l}
              canVoid={canVoid}
              onQty={(qty) => void doAction(() => api.patchLine(l.id, { qty }))}
              onVoid={() => {
                if (!confirm(`${l.name} iptal edilsin mi?`)) return
                void doAction(() => api.patchLine(l.id, { void: true }))
              }}
            />
          ))}
        </div>

        <div className="cart-foot">
          {error && <div style={{ color: 'var(--danger)', fontSize: 12.5, marginBottom: 8 }}>{error}</div>}
          <div className="totals-row">
            <span>Ara toplam (KDV hariç)</span>
            <b>{money(totals?.subtotal ?? 0)}</b>
          </div>
          {(totals?.vatLines ?? []).map((v) => (
            <div className="totals-row" key={v.rate}>
              <span>KDV %{v.rate}</span>
              <b>{money(v.vat)}</b>
            </div>
          ))}
          <div className="totals-total">
            <span>Toplam</span>
            <b>{money(totals?.total ?? 0)}</b>
          </div>
          <div className="cart-actions">
            <button
              type="button"
              className="btn"
              disabled={busy || !order.lines.some((l) => l.status === 'new')}
              aria-label="Yeni ürünleri mutfağa gönder"
              onClick={() => void doAction(() => api.send(orderId))}
            >
              {order.lines.some((l) => l.status === 'new') ? 'Mutfağa Gönder' : 'Mutfağa gönderildi'}
            </button>
            <button type="button" className="btn primary" disabled={!canPay || order.lines.length === 0} onClick={() => setPayOpen(true)}>
              Ödeme Al
            </button>
          </div>
          <button className="btn ghost sm block" style={{ marginTop: 9 }} onClick={() => setMoveOpen(true)}>
            Masa Taşı
          </button>
        </div>
      </div>

      {sheet && (
        <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && setSheet(null)}>
          <div className="sheet">
            <div className="sheet-head">
              {sheet.product.imageUrl && (
                <img className="sheet-img" src={sheet.product.imageUrl} alt={sheet.product.name} />
              )}
              <div style={{ flex: 1 }}>
                <h3>{sheet.product.name}</h3>
                <p>
                  {sheet.product.variants.length > 1 ? 'Boy seç' : sheet.product.variants[0]?.name}
                  {sheet.product.groups.length ? ' · seçenekleri işaretle' : ''}
                </p>
              </div>
              <button className="btn ghost sm" onClick={() => setSheet(null)}>
                Kapat
              </button>
            </div>

            {sheet.product.description && (
              <div className="recipe-box">
                <div className="recipe-head">
                  <span>Hazırlanışı</span>
                  {sheet.product.description.length > 150 && (
                    <button className="link-btn" onClick={() => setDescOpen((v) => !v)}>
                      {descOpen ? 'kısalt' : 'devamını oku'}
                    </button>
                  )}
                </div>
                <p className={descOpen ? '' : 'clamp3'}>{sheet.product.description}</p>
              </div>
            )}

            {sheet.product.variants.length > 1 && (
              <div className="mod-group">
                <div className="mod-group-head">
                  <span>Boyut</span>
                  <span>zorunlu</span>
                </div>
                <div className="mod-chips">
                  {sheet.product.variants.map((v) => (
                    <button
                      key={v.id}
                      className={`chip${sheet.variantId === v.id ? ' on' : ''}`}
                      onClick={() => setSheet({ ...sheet, variantId: v.id })}
                    >
                      {v.name}
                      <small>{money(v.price)}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {sheet.product.groups.map((g) => (
              <div className="mod-group" key={g.id}>
                <div className="mod-group-head">
                  <span>{g.name}</span>
                  <span>
                    {g.min > 0 ? `en az ${g.min}` : 'opsiyonel'} · en çok {g.max}
                  </span>
                </div>
                <div className="mod-chips">
                  {g.modifiers.map((m) => {
                    const on = sheet.mods.includes(m.id)
                    const toggle = () => {
                      const next = on ? sheet.mods.filter((x) => x !== m.id) : [...sheet.mods, m.id]
                      setSheet({ ...sheet, mods: next })
                    }
                    return (
                      <button key={m.id} className={`chip${on ? ' on' : ''}`} onClick={toggle}>
                        {m.name}
                        {m.price > 0 && <small>+{money(m.price)}</small>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

            {sheet.product.ingredients.length > 0 && (
              <div className="mod-group">
                <div className="mod-group-head">
                  <span>İçindekiler</span>
                  <span>çıkarmak için dokun · fiyatlı olanlar eklenir</span>
                </div>
                <div className="mod-chips">
                  {sheet.product.ingredients.map((ing) => {
                    const choice = sheet.ings.find((c) => c.id === ing.id)
                    const removed = choice?.mode === 'removed'
                    const added = choice?.mode === 'added'
                    const on = ing.included ? !removed : added
                    return (
                      <button
                        key={ing.id}
                        className={`chip ing${removed ? ' removed' : on ? ' on' : ''}`}
                        onClick={() => {
                          const rest = sheet.ings.filter((c) => c.id !== ing.id)
                          const next = ing.included
                            ? removed
                              ? rest
                              : [...rest, { id: ing.id, mode: 'removed' as const }]
                            : added
                              ? rest
                              : [...rest, { id: ing.id, mode: 'added' as const }]
                          setSheet({ ...sheet, ings: next })
                        }}
                      >
                        {ing.name}
                        {ing.included ? (
                          <small>{removed ? 'çıkarıldı' : 'dahil'}</small>
                        ) : (
                          <small>+{money(ing.price)}</small>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="mod-group">
              <div className="mod-group-head">
                <span>Not</span>
                <span>mutfağa gider</span>
              </div>
              <textarea
                className="textarea"
                placeholder="Örn: iyi pişsin, soğan olmasın…"
                value={sheet.note}
                onChange={(e) => setSheet({ ...sheet, note: e.target.value })}
              />
            </div>

            <div className="sheet-foot">
              <div className="qty stepper">
                <button onClick={() => setSheet({ ...sheet, qty: Math.max(1, sheet.qty - 1) })}>−</button>
                <b>{sheet.qty}</b>
                <button onClick={() => setSheet({ ...sheet, qty: Math.min(MAX_QTY, sheet.qty + 1) })}>+</button>
              </div>
              <div className="grow" style={{ textAlign: 'right', fontWeight: 700, fontSize: 18 }}>{money(sheetPrice)}</div>
              <button className="btn primary" disabled={!sheetValid || busy} onClick={() => void addFromSheet()}>
                Ekle
              </button>
            </div>
          </div>
        </div>
      )}

      {payOpen && order && (
        <PaymentModal
          order={order}
          onClose={() => setPayOpen(false)}
          onSubmit={(payload) => api.pay(orderId, payload)}
          onDone={async (result) => {
            if (result.status === 'paid') {
              await refresh()
              setPayOpen(false)
              navigate('/tables')
            } else {
              await load()
            }
          }}
          onError={setError}
        />
      )}

      {voidOpen && order && (
        <VoidOrderModal
          orderId={orderId}
          onClose={() => setVoidOpen(false)}
          onDone={async () => {
            await refresh()
            setVoidOpen(false)
            navigate('/tables')
          }}
          onError={setError}
        />
      )}

      {moveOpen && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setMoveOpen(false)}>
          <div className="modal">
            <h3>Masa Taşı</h3>
            <div className="sub">Adisyonu taşımak istediğin masayı seç</div>
            <div className="mod-chips">
              {(boot?.floors ?? []).flatMap((f) =>
                f.tables
                  .filter((t) => t.id !== order.table_id && !t.order)
                  .map((t) => (
                    <button
                      key={t.id}
                      className="chip"
                      onClick={async () => {
                        await doAction(() => api.move(orderId, t.id))
                        setMoveOpen(false)
                      }}
                    >
                      {t.name}
                    </button>
                  )),
              )}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setMoveOpen(false)}>
                Vazgeç
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CartLine({
  line,
  canVoid,
  onQty,
  onVoid,
}: {
  line: OrderLine
  canVoid: boolean
  onQty: (qty: number) => void
  onVoid: () => void
}) {
  const voided = line.status === 'void'
  const unitTotal = lineTotal({ ...line, qty: 1 })
  return (
    <div className={`cart-line${voided ? ' voided' : ''}`}>
      <div className="line-top">
        <div>
          <div className="line-name">{line.name}</div>
          {line.modifiers.length > 0 && (
            <div className="line-mods">{line.modifiers.map((m) => (m.price > 0 ? `${m.name} +${money(m.price)}` : m.name)).join(' · ')}</div>
          )}
          {line.ingredients?.length > 0 && (
            <div className="line-ings">
              {line.ingredients.map((ing, idx) => (
                <span key={idx} className={`ing-tag ${ing.mode}`}>
                  {ing.mode === 'removed' ? `${ing.name} yok` : `+ ${ing.name}${ing.price > 0 ? ` ${money(ing.price)}` : ''}`}
                </span>
              ))}
            </div>
          )}
          {line.note && <div className="line-note">“{line.note}”</div>}
        </div>
        <div className="line-price">
          <b>{money(lineTotal(line))}</b>
          {line.qty > 1 && <small>{line.qty} × {money(unitTotal)}</small>}
        </div>
      </div>
      <div className="line-bottom">
        <div className="stepper">
          <button onClick={() => onQty(Math.max(1, line.qty - 1))}>−</button>
          <b>{line.qty}</b>
          <button onClick={() => onQty(Math.min(MAX_QTY, line.qty + 1))}>+</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`pill${line.status === 'new' ? '' : line.status === 'served' ? ' ok' : ' warn'}`}>
            {line.status === 'new'
              ? 'yeni'
              : line.status === 'sent'
                ? 'mutfakta'
                : line.status === 'preparing'
                  ? 'hazırlanıyor'
                  : line.status === 'ready'
                    ? 'hazır'
                    : 'servis'}
          </span>
          {canVoid && !voided && (
            <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={onVoid}>
              İptal
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
