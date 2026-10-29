import { useEffect, useState } from 'react'
import { api, type GroupInput, type ModGroup } from '../api.ts'

type OptionRow = { id?: number; name: string; price: number }

type Props = {
  /** null → yeni grup, aksi halde düzenlenecek grup */
  group: ModGroup | null
  onClose: () => void
  onSaved: (message: string, groupId: number | null) => void
  onError: (message: string) => void
}

const tl = (cents: number) =>
  (cents / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Kuruş değerini Türkçe biçimde düzenler; yazarken imleç zıplamaz. */
function PriceInput({ value, onChange }: { value: number; onChange: (cents: number) => void }) {
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
      placeholder="0,00"
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

export default function ModifierGroupEditor({ group, onClose, onSaved, onError }: Props) {
  const [name, setName] = useState(group?.name ?? '')
  const [min, setMin] = useState(group?.min ?? 0)
  const [max, setMax] = useState(group?.max ?? 1)
  const [options, setOptions] = useState<OptionRow[]>(
    group?.modifiers.map((m) => ({ id: m.id, name: m.name, price: m.price })) ?? [{ name: '', price: 0 }],
  )
  const [busy, setBusy] = useState(false)

  const valid = name.trim().length > 0 && options.some((o) => o.name.trim().length > 0) && max >= Math.max(min, 1)

  const patchOption = (idx: number, patch: Partial<OptionRow>) => {
    const next = [...options]
    next[idx] = { ...next[idx], ...patch }
    setOptions(next)
  }

  const save = async () => {
    if (!valid || busy) return
    setBusy(true)
    const body: GroupInput = {
      name: name.trim(),
      min,
      max,
      modifiers: options
        .filter((o) => o.name.trim().length > 0)
        .map((o) => ({ id: o.id, name: o.name.trim(), price: o.price })),
    }
    try {
      if (group) {
        await api.updateModifierGroup(group.id, body)
        onSaved(`“${body.name}” grubu güncellendi`, group.id)
      } else {
        const created = await api.createModifierGroup(body)
        onSaved(`“${body.name}” grubu eklendi`, created.id)
      }
    } catch (e: any) {
      onError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!group || busy) return
    if (!confirm(`“${group.name}” grubu silinsin mi? Geçmiş adisyonlarda kullanıldıysa silinemez.`)) return
    setBusy(true)
    try {
      await api.deleteModifierGroup(group.id)
      onSaved(`“${group.name}” grubu silindi`, null)
    } catch (e: any) {
      onError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal group-modal" role="dialog" aria-label="Seçenek grubu düzenleyici">
        <div className="group-head">
          <h3>{group ? group.name : 'Yeni seçenek grubu'}</h3>
          <div className="sub">
            Hamur, sos, ekstra malzeme gibi seçimler. Bu grup ürüne bağlandığında sipariş ekranında çıkar.
          </div>
        </div>

        <div className="group-body">
        <div className="field">
          <label>Grup adı</label>
          <input
            className="input"
            value={name}
            placeholder="Örn: Sos, Pişirme, Ekstralar"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="group-minmax">
          <div className="field">
            <label>En az seçim</label>
            <input
              className="input"
              inputMode="numeric"
              value={min}
              onChange={(e) => setMin(Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0))}
            />
            <p className="hint">0 → isteğe bağlı, 1 → zorunlu seçim</p>
          </div>
          <div className="field">
            <label>En fazla seçim</label>
            <input
              className="input"
              inputMode="numeric"
              value={max}
              onChange={(e) => setMax(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))}
            />
            <p className="hint">Aynı anda seçilebilecek en fazla seçenek</p>
          </div>
        </div>

        <div className="group-options">
          <div className="section-head" style={{ marginTop: 4 }}>
            <h3 style={{ fontSize: 14 }}>Seçenekler ({options.filter((o) => o.name.trim()).length})</h3>
            <button
              type="button"
              className="btn ghost sm"
              disabled={options.length >= 40}
              onClick={() => setOptions([...options, { name: '', price: 0 }])}
            >
              + Seçenek
            </button>
          </div>
          <div className="rows">
            {options.map((o, idx) => (
              <div className="opt-editor-row" key={idx}>
                <input
                  className="input"
                  placeholder="Seçenek adı (Ranch, Glutensiz…)"
                  value={o.name}
                  onChange={(e) => patchOption(idx, { name: e.target.value })}
                />
                <div className="price-input">
                  <PriceInput value={o.price} onChange={(price) => patchOption(idx, { price })} />
                  <span>₺</span>
                </div>
                <button
                  type="button"
                  className="btn ghost sm"
                  aria-label={`${o.name || 'seçeneği'} kaldır`}
                  disabled={options.length <= 1}
                  onClick={() => setOptions(options.filter((_, i) => i !== idx))}
                >
                  Sil
                </button>
              </div>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            Fiyatı 0 bırakırsan seçim ücretsiz olur. Örnek: {tl(1500)} ₺ yazarsan seçildiğinde eklenir.
          </p>
        </div>
        </div>

        <div className="group-actions">
          {group ? (
            <button type="button" className="btn danger sm" disabled={busy} onClick={() => void remove()}>
              Grubu sil
            </button>
          ) : (
            <span />
          )}
          <div className="group-actions-right">
            <button type="button" className="btn" onClick={onClose}>
              Vazgeç
            </button>
            <button type="button" className="btn primary" disabled={!valid || busy} onClick={() => void save()}>
              {busy ? 'Kaydediliyor…' : group ? 'Değişiklikleri kaydet' : 'Grubu ekle'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
