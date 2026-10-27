import { useEffect, useState } from 'react'
import { api, money, type Role } from '../api.ts'

type MenuRow = Awaited<ReturnType<typeof api.adminMenu>>[number]
type StaffRow = Awaited<ReturnType<typeof api.staff>>[number]

const ROLE_LABEL: Record<Role, string> = { manager: 'Yönetici', cashier: 'Kasiyer', waiter: 'Garson' }

export default function Admin() {
  const [tab, setTab] = useState<'menu' | 'staff'>('menu')
  const [menu, setMenu] = useState<MenuRow[]>([])
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', role: 'waiter' as Role, pin: '' })

  const load = () => {
    api.adminMenu().then(setMenu).catch((e) => setError(e.message))
    api.staff().then(setStaff).catch((e) => setError(e.message))
  }

  useEffect(load, [])

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
          <h1>Yönetim</h1>
          <div className="sub">Menü ve personel</div>
        </div>
      </div>

      {error && <div className="toast error">{error}</div>}

      <div className="tabs">
        <button className={`tab${tab === 'menu' ? ' on' : ''}`} onClick={() => setTab('menu')}>
          Menü ({menu.length})
        </button>
        <button className={`tab${tab === 'staff' ? ' on' : ''}`} onClick={() => setTab('staff')}>
          Personel ({staff.length})
        </button>
      </div>

      {tab === 'menu' && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Ürün</th>
                <th>Kategori</th>
                <th>KDV</th>
                <th>Fiyatlar</th>
              </tr>
            </thead>
            <tbody>
              {menu.map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>{p.name}</b>
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{p.category}</td>
                  <td style={{ color: 'var(--muted)' }}>%{p.vat_rate}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {p.variants.map((v) => `${v.name} ${money(v.price)}`).join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
