import { useEffect, useState } from 'react'
import { useApp } from '../App.tsx'
import { api, type Prefs } from '../api.ts'

type Row = {
  key: keyof Omit<Prefs, 'theme'>
  title: string
  desc: string
}

const FEATURE_ROWS: Row[] = [
  {
    key: 'featureCari',
    title: 'Cari hesap (veresiye)',
    desc: 'Müşteri hesapları, cariye yazma ve tahsilat ekranı görünür.',
  },
  {
    key: 'featureTableMenu',
    title: 'Masa işlem menüsü (⋯)',
    desc: 'Dolu masalarda öde, iptal, yazdır, taşı ve birleştir kısayolları görünür.',
  },
  {
    key: 'featureMutfakFx',
    title: 'Mutfak efektleri',
    desc: 'Mutfak ekranında durum değişince renkli bildirim animasyonu oynar.',
  },
  {
    key: 'featureGelAl',
    title: 'Gel Al modülü',
    desc: 'Paket/gel al siparişleri menüsü ve ekranı görünür.',
  },
]

const ROWS: Row[] = [
  {
    key: 'vatIncluded',
    title: 'KDV bilgisi gösterilsin',
    desc: 'Kapalıysa KDV oranı hiçbir ekranda ve fişte görünmez.',
  },
  {
    key: 'productDetail',
    title: 'Ürün detayları görünsün',
    desc: 'Boyut, içindekiler ve seçenek grupları ürün kartında ve sipariş ekranında gösterilir.',
  },
  {
    key: 'orderDetail',
    title: 'Ürüne basınca detay açılsın',
    desc: 'Kapalıysa ürün doğrudan sepete eklenir; detay için sepet satırına dokunulur.',
  },
  {
    key: 'tableDetail',
    title: 'Masa düzeni düzenlenebilir',
    desc: 'Kapalıysa masalar sade ızgara olarak listelenir, plan/şekil düzenlemesi gizlenir.',
  },
  {
    key: 'tableSections',
    title: 'Masaları bölümlendir',
    desc: 'Açıksa İç Mekan / Dış Mekan gibi bölümler kullanılır. Kapalıysa tüm masalar tek listede görünür.',
  },
  {
    key: 'paymentPreselect',
    title: 'Ödemede ürünler işaretli gelsin',
    desc: 'Açıksa ödeme ekranında tüm satırlar seçili başlar.',
  },
]

export default function SettingsPanel({ onOk, onError }: { onOk: (m: string) => void; onError: (m: string) => void }) {
  const { boot, refresh, theme, setTheme } = useApp()
  const [prefs, setPrefs] = useState<Prefs | null>(boot?.prefs ?? null)
  const [busy, setBusy] = useState<keyof Prefs | null>(null)

  const current = prefs ?? boot?.prefs ?? null

  // Panel açıldığında sunucudaki güncel değerleri al (bayat toggle olmasın).
  useEffect(() => {
    let alive = true
    api
      .settings()
      .then((r) => {
        if (alive) setPrefs(r.prefs)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const save = async (patch: Partial<Prefs>) => {
    if (!current) return
    const next = { ...current, ...patch }
    setPrefs(next)
    setBusy(Object.keys(patch)[0] as keyof Prefs)
    try {
      const res = await api.saveSettings(patch)
      setPrefs(res.prefs)
      await refresh()
      onOk('Ayar kaydedildi')
    } catch (e: any) {
      setPrefs(current)
      onError(e.message)
    } finally {
      setBusy(null)
    }
  }

  if (!current) return <div className="panel kds-empty">Ayarlar yükleniyor…</div>

  return (
    <div className="settings-panel">
      <section className="panel">
        <div className="panel-head">
          <h3>Görünüm</h3>
        </div>
        <div className="settings-row">
          <div>
            <b>Tema</b>
            <p>Kasa ekranının renk düzeni. Seçim bu bilgisayarda saklanır.</p>
          </div>
          <div className="segmented" role="group" aria-label="Tema">
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={theme === t ? 'on' : ''}
                aria-pressed={theme === t}
                onClick={() => {
                  setTheme(t)
                  void save({ theme: t })
                }}
              >
                {t === 'light' ? 'Açık' : 'Koyu'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Program davranışı</h3>
        </div>
        {ROWS.map((row) => (
          <div className="settings-row" key={row.key}>
            <div>
              <b>{row.title}</b>
              <p>{row.desc}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(current[row.key])}
              aria-label={row.title}
              className={`switch${current[row.key] ? ' on' : ''}`}
              disabled={busy === row.key}
              onClick={() => void save({ [row.key]: !current[row.key] } as Partial<Prefs>)}
            >
              <span className="switch-dot" aria-hidden="true" />
              <span className="switch-text">{current[row.key] ? 'Açık' : 'Kapalı'}</span>
            </button>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Modüller (eklentiler)</h3>
          <span className="pill">kapatınca menüden gizlenir</span>
        </div>
        {FEATURE_ROWS.map((row) => (
          <div className="settings-row" key={row.key}>
            <div>
              <b>{row.title}</b>
              <p>{row.desc}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={current[row.key] !== false}
              aria-label={row.title}
              className={`switch${current[row.key] !== false ? ' on' : ''}`}
              disabled={busy === row.key}
              onClick={() => void save({ [row.key]: current[row.key] === false } as Partial<Prefs>)}
            >
              <span className="switch-dot" aria-hidden="true" />
              <span className="switch-text">{current[row.key] !== false ? 'Açık' : 'Kapalı'}</span>
            </button>
          </div>
        ))}
      </section>

      <section className="panel settings-note">
        <b>Not</b>
        <p>
          Bu ayarlar tüm kullanıcıları etkiler ve sunucuda saklanır. KDV kapatıldığında fişlerde
          KDV satırı basılmaz; ürün fiyatları KDV dahil olarak işlenmeye devam eder.
        </p>
      </section>
    </div>
  )
}
