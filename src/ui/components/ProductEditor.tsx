import { useEffect, useMemo, useState } from 'react'
import {
  api,
  type AdminProduct,
  type Ingredient,
  type ModGroup,
  type ProductInput,
} from '../api.ts'
import ModifierGroupEditor from './ModifierGroupEditor.tsx'

const tl = (cents: number) =>
  (cents / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Kuruş değerini Türkçe biçimde düzenler; yazarken imleç zıplamaz, alandan çıkınca normalize eder. */
function PriceInput({
  value,
  onChange,
  placeholder = '0,00',
}: {
  value: number
  onChange: (cents: number) => void
  placeholder?: string
}) {
  const [text, setText] = useState(value ? (value / 100).toFixed(2).replace('.', ',') : '')

  useEffect(() => {
    const parsed = Math.round(Number(text.replace(',', '.')) * 100) || 0
    if (parsed !== value) setText(value ? (value / 100).toFixed(2).replace('.', ',') : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <input
      className="input"
      inputMode="decimal"
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const t = e.target.value
        setText(t)
        onChange(Math.round(Number(t.replace(',', '.')) * 100) || 0)
      }}
      onBlur={() => {
        const cents = Math.round(Number(text.replace(',', '.')) * 100) || 0
        setText(cents ? (cents / 100).toFixed(2).replace('.', ',') : '')
        onChange(cents)
      }}
    />
  )
}

type SizeRow = { id?: number; name: string; price: number }
type IngRow = { id?: number; name: string; price: number; included: boolean }
type CategoryRow = { id: number; name: string }

type Props = {
  productId: number | null
  categories: CategoryRow[]
  onClose: () => void
  onSaved: (msg: string) => void
  onError: (msg: string) => void
  onCategoriesChanged: () => void
}

const EMPTY: {
  name: string
  categoryId: number | null
  vatRate: number
  description: string
  imageUrl: string | null
  sizes: SizeRow[]
  ingredients: IngRow[]
  groupIds: number[]
} = {
  name: '',
  categoryId: null,
  vatRate: 10,
  description: '',
  imageUrl: null,
  sizes: [{ name: 'Standart', price: 0 }],
  ingredients: [],
  groupIds: [],
}

export default function ProductEditor({ productId, categories, onClose, onSaved, onError, onCategoriesChanged }: Props) {
  const [form, setForm] = useState({ ...EMPTY })
  const [groups, setGroups] = useState<ModGroup[]>([])
  const [loading, setLoading] = useState(!!productId)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  /** null → kapalı, 0 → yeni grup, n → düzenlenen grup */
  const [groupEditor, setGroupEditor] = useState<number | null>(null)

  const loadGroups = () =>
    api
      .modifierGroups()
      .then(setGroups)
      .catch((e) => onError(e.message))

  useEffect(() => {
    void loadGroups()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onError])

  useEffect(() => {
    if (!productId) return
    setLoading(true)
    api
      .product(productId)
      .then((p: AdminProduct) => {
        setForm({
          name: p.name,
          categoryId: p.categoryId,
          vatRate: p.vatRate,
          description: p.description ?? '',
          imageUrl: p.imageUrl,
          sizes: p.sizes.map((s) => ({ id: s.id, name: s.name, price: s.price })),
          ingredients: p.ingredients.map((i) => ({ id: i.id, name: i.name, price: i.price, included: i.included })),
          groupIds: p.groupIds,
        })
      })
      .catch((e) => onError(e.message))
      .finally(() => setLoading(false))
  }, [productId, onError])

  useEffect(() => {
    if (!form.categoryId && categories.length) setForm((f) => ({ ...f, categoryId: categories[0].id }))
  }, [categories, form.categoryId])

  const totalSizes = form.sizes.length
  const includedCount = form.ingredients.filter((i) => i.included).length

  const payload: ProductInput = useMemo(
    () => ({
      name: form.name.trim(),
      categoryId: form.categoryId ?? 0,
      vatRate: form.vatRate,
      description: form.description.trim() || null,
      imageUrl: form.imageUrl,
      sizes: form.sizes.map((s) => ({ id: s.id, name: s.name.trim(), price: s.price })),
      ingredients: form.ingredients.map((i) => ({
        id: i.id,
        name: i.name.trim(),
        price: i.price,
        included: i.included,
      })),
      groupIds: form.groupIds,
    }),
    [form],
  )

  const valid =
    payload.name.length > 1 &&
    !!payload.categoryId &&
    payload.sizes.length > 0 &&
    payload.sizes.every((s) => s.name.length > 0) &&
    payload.ingredients.every((i) => i.name.length > 0)

  const save = async () => {
    setSaving(true)
    try {
      if (productId) {
        await api.updateProduct(productId, payload)
        onSaved('Ürün güncellendi')
      } else {
        const created = await api.createProduct(payload)
        onSaved('Ürün eklendi')
        if (created?.id) {
          // yeni ürünün düzenleme moduna geçmesi için üst bileşen yenilenir
        }
      }
      onClose()
    } catch (e: any) {
      onError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!productId) return
    if (!confirm(`${form.name} menüden kaldırılsın mı? (geçmiş adisyonlar etkilenmez)`)) return
    try {
      await api.deleteProduct(productId)
      onSaved('Ürün kaldırıldı')
      onClose()
    } catch (e: any) {
      onError(e.message)
    }
  }

  const uploadImage = async (file?: File | null) => {
    if (!file || !productId) return
    setUploading(true)
    try {
      const res = await api.uploadImage(productId, file)
      setForm((f) => ({ ...f, imageUrl: res.imageUrl }))
      onSaved('Görsel yüklendi')
    } catch (e: any) {
      onError(e.message)
    } finally {
      setUploading(false)
    }
  }

  const addCategory = async () => {
    const name = newCategory.trim()
    if (!name) return
    try {
      const c = await api.addCategory(name)
      setNewCategory('')
      onCategoriesChanged()
      setForm((f) => ({ ...f, categoryId: c.id }))
    } catch (e: any) {
      onError(e.message)
    }
  }

  return (
    <div className="editor-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="editor">
        <div className="editor-head">
          <div>
            <h2>{productId ? form.name || 'Ürünü düzenle' : 'Yeni ürün'}</h2>
            <p>{productId ? 'Menüde görünen bilgileri ve içeriği düzenle' : 'Menüye yeni bir ürün ekle'}</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {productId && (
              <button className="btn danger sm" onClick={() => void remove()}>
                Menüden kaldır
              </button>
            )}
            <button className="btn ghost sm" onClick={onClose}>
              Kapat
            </button>
          </div>
        </div>

        {loading ? (
          <div className="kds-empty">Yükleniyor…</div>
        ) : (
          <div className="editor-body">
            <div className="editor-main">
              <section className="editor-section">
                <h3>Temel bilgiler</h3>
                <div className="form-grid">
                  <div className="field" style={{ gridColumn: 'span 2' }}>
                    <label>Ürün adı</label>
                    <input
                      className="input"
                      value={form.name}
                      placeholder="Örn: Soprano Special"
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>Kategori</label>
                    <select
                      className="input"
                      value={form.categoryId ?? ''}
                      onChange={(e) => setForm({ ...form, categoryId: Number(e.target.value) })}
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>KDV</label>
                    <select
                      className="input"
                      value={form.vatRate}
                      onChange={(e) => setForm({ ...form, vatRate: Number(e.target.value) })}
                    >
                      <option value={10}>%10 (yiyecek)</option>
                      <option value={20}>%20 (içecek)</option>
                      <option value={1}>%1</option>
                      <option value={0}>%0</option>
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label>Hazırlanış / açıklama (sipariş ekranında görünür)</label>
                  <textarea
                    className="textarea"
                    style={{ minHeight: 96 }}
                    placeholder="Malzemeler, pişirme süresi, porsiyon…"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                  <small style={{ color: 'var(--dim)' }}>{form.description.length}/3000</small>
                </div>

                <div className="category-add">
                  <input
                    className="input"
                    placeholder="Yeni kategori adı (ör. Makarnalar)"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void addCategory()}
                  />
                  <button className="btn sm" disabled={!newCategory.trim()} onClick={() => void addCategory()}>
                    Kategori ekle
                  </button>
                </div>
              </section>

              <section className="editor-section">
                <div className="section-head">
                  <h3>Boyutlar ve fiyatlar</h3>
                  <button
                    className="btn ghost sm"
                    disabled={totalSizes >= 10}
                    onClick={() => setForm({ ...form, sizes: [...form.sizes, { name: '', price: 0 }] })}
                  >
                    + Boyut
                  </button>
                </div>
                <div className="rows">
                  {form.sizes.map((s, idx) => (
                    <div className="row-3" key={idx}>
                      <input
                        className="input"
                        placeholder="Boyut adı (Küçük, Orta, 33cl…)"
                        value={s.name}
                        onChange={(e) => {
                          const sizes = [...form.sizes]
                          sizes[idx] = { ...s, name: e.target.value }
                          setForm({ ...form, sizes })
                        }}
                      />
                      <div className="price-input">
                        <PriceInput
                          value={s.price}
                          onChange={(v) => {
                            const sizes = [...form.sizes]
                            sizes[idx] = { ...s, price: v }
                            setForm({ ...form, sizes })
                          }}
                        />
                        <span>₺</span>
                      </div>
                      <button
                        className="btn ghost sm"
                        disabled={form.sizes.length <= 1}
                        onClick={() => setForm({ ...form, sizes: form.sizes.filter((_, i) => i !== idx) })}
                      >
                        Sil
                      </button>
                    </div>
                  ))}
                </div>
                <p className="hint">Tek boyutlu ürünlerde “Standart” bırakabilirsin.</p>
              </section>

              <section className="editor-section">
                <div className="section-head">
                  <h3>İçindekiler ({includedCount} dahil / {form.ingredients.length} toplam)</h3>
                  <button
                    className="btn ghost sm"
                    disabled={form.ingredients.length >= 40}
                    onClick={() =>
                      setForm({ ...form, ingredients: [...form.ingredients, { name: '', price: 0, included: true }] })
                    }
                  >
                    + İçerik
                  </button>
                </div>
                <div className="rows">
                  {form.ingredients.map((ing, idx) => (
                    <div className="ing-editor-row" key={idx}>
                      <input
                        className="input"
                        placeholder="Malzeme (Mozzarella, Mantar…)"
                        value={ing.name}
                        onChange={(e) => {
                          const ingredients = [...form.ingredients]
                          ingredients[idx] = { ...ing, name: e.target.value }
                          setForm({ ...form, ingredients })
                        }}
                      />
                      <div className="price-input">
                        <PriceInput
                          value={ing.price}
                          onChange={(v) => {
                            const ingredients = [...form.ingredients]
                            ingredients[idx] = { ...ing, price: v }
                            setForm({ ...form, ingredients })
                          }}
                        />
                        <span>₺</span>
                      </div>
                      <button
                        className={`switch${ing.included ? ' on' : ''}`}
                        onClick={() => {
                          const ingredients = [...form.ingredients]
                          ingredients[idx] = { ...ing, included: !ing.included }
                          setForm({ ...form, ingredients })
                        }}
                        title={ing.included ? 'Varsayılan içerik' : 'Ekstra (fiyatlı)'}
                      >
                        {ing.included ? 'dahil' : 'ekstra'}
                      </button>
                      <button
                        className="btn ghost sm"
                        onClick={() => setForm({ ...form, ingredients: form.ingredients.filter((_, i) => i !== idx) })}
                      >
                        Sil
                      </button>
                    </div>
                  ))}
                  {form.ingredients.length === 0 && (
                    <p className="hint">Henüz içerik yok. “+ İçerik” ile malzemeleri ekle.</p>
                  )}
                </div>
                <p className="hint">
                  <b>dahil</b>: siparişte varsayılan olarak gelir, müşteri çıkarabilir. <b>ekstra</b>: siparişte
                  isteğe bağlı, fiyatı yazarsan ücret eklenir.
                </p>
              </section>

              <section className="editor-section">
                <h3>Seçenek grupları</h3>
                <p className="hint" style={{ marginTop: -4 }}>
                  Hamur, sos gibi zorunlu/opsiyonel seçimler. Sipariş ekranında bu gruplar çıkar.
                </p>
                <div className="mod-chips">
                  {groups.map((g) => {
                    const on = form.groupIds.includes(g.id)
                    return (
                      <div className={`mod-chip${on ? ' on' : ''}`} key={g.id}>
                        <button
                          type="button"
                          className="mod-chip-main"
                          aria-pressed={on}
                          onClick={() =>
                            setForm({
                              ...form,
                              groupIds: on ? form.groupIds.filter((x) => x !== g.id) : [...form.groupIds, g.id],
                            })
                          }
                        >
                          {g.name}
                          <small>
                            {g.modifiers.length} seçenek{g.min > 0 ? ' · zorunlu' : ''}
                          </small>
                        </button>
                        <button
                          type="button"
                          className="mod-chip-edit"
                          aria-label={`${g.name} grubunu düzenle`}
                          title="Grubu düzenle"
                          onClick={() => setGroupEditor(g.id)}
                        >
                          ✎
                        </button>
                      </div>
                    )
                  })}
                  <button type="button" className="btn ghost sm" onClick={() => setGroupEditor(0)}>
                    + Yeni grup
                  </button>
                </div>
                <p className="hint" style={{ marginTop: 8 }}>
                  Seçili gruplar bu ürüne bağlıdır. Kalem ikonuyla grubun adını, zorunluluğunu ve seçeneklerini düzenle.
                </p>
              </section>
            </div>

            <aside className="editor-side">
              <div className="editor-section">
                <h3>Görsel</h3>
                {form.imageUrl ? (
                  <img className="editor-img" src={form.imageUrl} alt={form.name} />
                ) : (
                  <div className="editor-img empty">Görsel yok</div>
                )}
                <label className={`btn sm block${productId ? '' : ' disabled'}`} style={{ marginTop: 10 }}>
                  {uploading ? 'Yükleniyor…' : form.imageUrl ? 'Görseli değiştir' : 'Görsel yükle'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    disabled={!productId}
                    onChange={(e) => void uploadImage(e.target.files?.[0])}
                  />
                </label>
                {!productId && <p className="hint">Görsel yüklemek için önce ürünü kaydet.</p>}
              </div>

              <div className="editor-section">
                <h3>Özet</h3>
                <div className="summary-row">
                  <span>Kategori</span>
                  <b>{categories.find((c) => c.id === form.categoryId)?.name ?? '—'}</b>
                </div>
                <div className="summary-row">
                  <span>KDV</span>
                  <b>%{form.vatRate}</b>
                </div>
                <div className="summary-row">
                  <span>Boyut</span>
                  <b>{form.sizes.length}</b>
                </div>
                <div className="summary-row">
                  <span>Fiyat aralığı</span>
                  <b>
                    {form.sizes.length
                      ? `${tl(Math.min(...form.sizes.map((s) => s.price)))} – ${tl(Math.max(...form.sizes.map((s) => s.price)))} ₺`
                      : '—'}
                  </b>
                </div>
                <div className="summary-row">
                  <span>Malzeme</span>
                  <b>{form.ingredients.length}</b>
                </div>
              </div>
            </aside>
          </div>
        )}

        <div className="editor-foot">
          <button className="btn" onClick={onClose}>
            Vazgeç
          </button>
          <button className="btn primary" disabled={!valid || saving} onClick={() => void save()}>
            {saving ? 'Kaydediliyor…' : productId ? 'Değişiklikleri kaydet' : 'Ürünü ekle'}
          </button>
        </div>
      </div>

      {groupEditor !== null && (
        <ModifierGroupEditor
          group={groups.find((g) => g.id === groupEditor) ?? null}
          onClose={() => setGroupEditor(null)}
          onSaved={(message, id) => {
            const edited = groupEditor
            void loadGroups()
            if (id) {
              setForm((f) => (f.groupIds.includes(id) ? f : { ...f, groupIds: [...f.groupIds, id] }))
            } else if (edited) {
              setForm((f) => ({ ...f, groupIds: f.groupIds.filter((x) => x !== edited) }))
            }
            setGroupEditor(null)
            onSaved(message)
          }}
          onError={onError}
        />
      )}
    </div>
  )
}
