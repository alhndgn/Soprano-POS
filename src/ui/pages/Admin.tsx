import { useEffect, useState } from 'react'
import { api, money, type Role } from '../api.ts'
import LayoutEditor from '../components/LayoutEditor.tsx'
import ProductEditor from '../components/ProductEditor.tsx'
import PrinterSettings from '../components/PrinterSettings.tsx'

type MenuRow = Awaited<ReturnType<typeof api.adminMenu>>[number]
type StaffRow = Awaited<ReturnType<typeof api.staff>>[number]

const ROLE_LABEL: Record<Role, string> = { manager: 'Yönetici', cashier: 'Kasiyer', waiter: 'Garson' }

export default function Admin() {
  const [tab, setTab] = useState<'menu' | 'staff' | 'layout' | 'printers'>('layout')
  const [menu, setMenu] = useState<MenuRow[]>([])
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', role: 'waiter' as Role, pin: '' })
  const [uploading, setUploading] = useState<number | null>(null)
  const [editor, setEditor] = useState<{ open: boolean; id: number | null }>({ open: false, id: null })
  const [menuFilter, setMenuFilter] = useState<'all' | 'active' | 'passive'>('all')
  const [ver, setVer] = useState<{ version: string; commit: string } | null>(null)

  const load = () => {
    api.adminMenu().then(setMenu).catch((e) => setError(e.message))
    api.staff().then(setStaff).catch((e) => setError(e.message))
  }

  useEffect(load, [])

  useEffect(() => {
    api.version().then(setVer).catch(() => {})
  }, [])

  useEffect(() => {
    if (!ok) return
    const timer = setTimeout(() => setOk(null), 2800)
    return () => clearTimeout(timer)
  }, [ok])

  const upload = async (id: number, file?: File | null) => {
    if (!file) return
    setUploading(id)
    setError(null)
    try {
      await api.uploadImage(id, file)
      load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setUploading(null)
    }
  }

  const removeImage = async (id: number) => {
    try {
      await api.deleteImage(id)
      load()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const toggleActive = async (id: number, active: boolean) => {
    setError(null)
    // Anında geri bildirim: satırı hemen güncelle, sunucu reddederse geri al.
    setMenu((prev) => prev.map((p) => (p.id === id ? { ...p, active } : p)))
    try {
      const res = await api.setProductActive(id, active)
      setOk(`${res.name} ${res.active ? 'aktif' : 'pasif'} yapıldı`)
      load()
    } catch (e: any) {
      setMenu((prev) => prev.map((p) => (p.id === id ? { ...p, active: !active } : p)))
      setError(e.message)
    }
  }

  const addStaff = async () => {
    try {
      await api.addStaff(form)
      setForm({ name: '', role: 'waiter', pin: '' })
      load()
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">AYARLAR VE MENÜ</p>
          <h1>Yönetim</h1>
          <div className="sub">
            Masa düzeni · menü ve görseller · personel · yazıcılar
            {ver && (
              <span className="version-pill" title="Yüklü sürüm">
                v{ver.version} · {ver.commit}
              </span>
            )}
          </div>
        </div>
      </div>

      {error && <div className="toast error" role="alert">{error}</div>}
      {ok && !error && <div className="toast ok" role="status">{ok}</div>}

      <div className="tabs" role="tablist" aria-label="Yönetim bölümleri">
        <button type="button" role="tab" aria-selected={tab === 'layout'} className={`tab${tab === 'layout' ? ' on' : ''}`} onClick={() => setTab('layout')}>
          Masa Düzeni
        </button>
        <button type="button" role="tab" aria-selected={tab === 'menu'} className={`tab${tab === 'menu' ? ' on' : ''}`} onClick={() => setTab('menu')}>
          Menü ({menu.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'staff'} className={`tab${tab === 'staff' ? ' on' : ''}`} onClick={() => setTab('staff')}>
          Personel ({staff.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'printers'} className={`tab${tab === 'printers' ? ' on' : ''}`} onClick={() => setTab('printers')}>
          Yazıcılar
        </button>
      </div>

      {tab === 'layout' && <LayoutEditor onError={setError} />}

      {tab === 'printers' && <PrinterSettings onError={setError} onOk={setOk} />}

      {tab === 'menu' && (
        <div className="panel">
          <div className="panel-head menu-head">
            <div>
              <h3>Ürünler ve görseller</h3>
              <p className="printer-hint">
                Pasife aldığın ürün sipariş ekranında görünmez; geçmiş adisyonlar bozulmaz.
              </p>
            </div>
            <div className="menu-head-actions">
              <div className="segmented" role="group" aria-label="Ürün filtresi">
                {([
                  ['all', 'Tümü', menu.length],
                  ['active', 'Aktif', menu.filter((p) => p.active !== false).length],
                  ['passive', 'Pasif', menu.filter((p) => p.active === false).length],
                ] as const).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    className={menuFilter === key ? 'on' : ''}
                    aria-pressed={menuFilter === key}
                    onClick={() => setMenuFilter(key)}
                  >
                    {label} ({count})
                  </button>
                ))}
              </div>
              <button className="btn primary sm" onClick={() => setEditor({ open: true, id: null })}>
                + Yeni ürün
              </button>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 74 }}>Görsel</th>
                <th>Ürün</th>
                <th>Kategori</th>
                <th>KDV</th>
                <th>Fiyatlar</th>
                <th style={{ width: 108 }}>Durum</th>
                <th style={{ width: 96 }}>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {menu
                .filter((p) =>
                  menuFilter === 'all' ? true : menuFilter === 'active' ? p.active !== false : p.active === false,
                )
                .map((p) => (
                <tr key={p.id} className={p.active === false ? 'row-passive' : undefined}>
                  <td>
                    {p.image_url ? (
                      <img className="menu-thumb" src={p.image_url} alt={p.name} />
                    ) : (
                      <div className="menu-thumb empty">—</div>
                    )}
                  </td>
                  <td>
                    <b>{p.name}</b>
                    <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
                      <label className="btn ghost sm" style={{ padding: '4px 9px', fontSize: 11.5 }}>
                        {uploading === p.id ? 'Yükleniyor…' : p.image_url ? 'Değiştir' : 'Görsel yükle'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          hidden
                          onChange={(e) => void upload(p.id, e.target.files?.[0])}
                        />
                      </label>
                      {p.image_url && (
                        <button
                          className="btn ghost sm"
                          style={{ padding: '4px 9px', fontSize: 11.5, color: 'var(--danger)' }}
                          onClick={() => void removeImage(p.id)}
                        >
                          Kaldır
                        </button>
                      )}
                    </div>
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{p.category}</td>
                  <td style={{ color: 'var(--muted)' }}>%{p.vat_rate}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {p.variants.map((v) => `${v.name} ${money(v.price)}`).join(' · ')}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`status-toggle${p.active === false ? ' off' : ''}`}
                      role="switch"
                      aria-checked={p.active !== false}
                      aria-label={`${p.name} ${p.active === false ? 'pasif, aktifleştir' : 'aktif, pasife al'}`}
                      onClick={() => void toggleActive(p.id, p.active === false)}
                    >
                      <span className="status-dot" aria-hidden="true" />
                      {p.active === false ? 'Pasif' : 'Aktif'}
                    </button>
                  </td>
                  <td>
                    <button className="btn sm" onClick={() => setEditor({ open: true, id: p.id })}>
                      Düzenle
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editor.open && (
        <ProductEditor
          productId={editor.id}
          categories={[
            ...new Map(menu.map((m) => [m.category_id, { id: m.category_id, name: m.category }])).values(),
          ]}
          onClose={() => setEditor({ open: false, id: null })}
          onSaved={(msg) => {
            setError(null)
            setOk(msg)
            load()
          }}
          onError={setError}
          onCategoriesChanged={load}
        />
      )}

      {tab === 'staff' && (
        <div className="two-col">
          <div className="panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ad</th>
                  <th>Rol</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <b>{s.name}</b>
                    </td>
                    <td style={{ color: 'var(--muted)' }}>{ROLE_LABEL[s.role]}</td>
                    <td>
                      <span className={`pill ${s.active ? 'ok' : 'bad'}`}>{s.active ? 'aktif' : 'pasif'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Personel ekle</h3>
            </div>
            <div className="panel-body">
              <div className="field">
                <label>Ad</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="field">
                <label>Rol</label>
                <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                  <option value="waiter">Garson</option>
                  <option value="cashier">Kasiyer</option>
                  <option value="manager">Yönetici</option>
                </select>
              </div>
              <div className="field">
                <label>PIN (4-6 hane)</label>
                <input className="input" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} />
              </div>
              <button className="btn primary block" disabled={!form.name || form.pin.length < 3} onClick={() => void addStaff()}>
                Ekle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
