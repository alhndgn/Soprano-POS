# Soprano POS — Tasarım Dokümanı

**Tarih:** 2026-10-27
**Durum:** v0.1 uygulandı (masa + kasa dikey dilim)
**Hedef:** Pizza restoranında masa/adisyon, mutfak akışı ve kasa yönetimi. Tek şube kurulumu, ileride çok şubeye satılabilir.

---

## 1. Amaç ve başarı kriterleri

Soprano’nun sahadaki işi: garson tabletten adisyon açar, ürün + boy + ek malzeme seçer, mutfağa gönderir; mutfak ekranı siparişi hazırlar; kasiyer parçalı ödeme alır, fiş basar; yönetici gün sonunda ciroya bakar.

Başarı kriterleri:

1. Garson 4 dokunuşla masa açıp ürün ekleyebilir (PIN → masa → ürün → gönder).
2. Mutfağa giden sipariş 2 saniye içinde KDS’te görünür; fiş yazıcıya KOT düşer.
3. Kasa kapanışında adisyon toplamı = ödemeler toplamı; para üstü ciroya yazılmaz.
4. KDV, ürün bazlı oranda (yiyecek %10, içecek %20) ayrışır; kuruş kaybı olmaz.
5. İnternet kesildiğinde LAN içindeki POS çalışmaya devam eder.

## 2. Kapsam

### v1 (bu sürüm)
- Masa planı, kat (İç Salon / Bahçe), masa durumu ve süre takibi
- Adisyon açma, ürün ekleme, adet artırma, satır iptali (yönetici)
- Boy/varyant + modifier (hamur, ek malzeme, sos), satır notu
- Mutfağa gönderim + KOT fişi
- Mutfak ekranı (Yeni → Hazırlanıyor → Hazır → Servis)
- Parçalı ödeme (nakit/kart), para üstü hesabı
- Vardiya açma/kapama (açık adisyon varken kapanmaz)
- Günlük rapor: ciro, adisyon sayısı, ortalama, ödeme dağılımı, saatlik ciro, en çok satanlar
- Menü ve personel yönetimi (okuma + personel ekleme)

### Kapsam dışı (sonraki fazlar)
Paket servis, kurye takibi, QR/online sipariş, Yemeksepeti–Trendyol Go, ÖKC/e-Arşiv, stok-reçete maliyeti, sadakat/kampanya, masa birleştirme, çok şube yönetimi.

## 3. Mimari kararlar

| Karar | Seçim | Gerekçe |
|---|---|---|
| Lisans | Kendi kodumuz (MIT) | Müşteriye kurulacak ve satılacak; AGPL projeler (URY) bu yüzden elendi |
| Backend | Node 22+ / Fastify 5 / TypeScript | Tek süreç, düşük kaynak, Windows laptopta bile çalışır |
| Veritabanı | PGlite (gömülü Postgres), `DATABASE_URL` ile gerçek Postgres’e geçiş | Kurulumda Docker/psql derdi yok; SQL Postgres |
| Arayüz | React + Vite, PWA | Tablet tarayıcıda uygulama gibi; APK/app store yok |
| Para | Kuruş (integer), KDV dahil fiyat | Float yuvarlama hatası yok |
| Kimlik | Personel PIN’i (scrypt) + oturum token’ı | Tablette 3 saniyede giriş |
| Yazdırma | Ayrı Node köprüsü (`:9100` ağ / USB), ESC/POS | Tarayıcı ESC/POS konuşamaz |
| Fiscal | `FiscalProvider` arayüzü, bugün `noop` | ÖKC/e-Arşiv sonradan tek noktadan takılır |
| Canlılık | SSE (`/api/events`) + 15 sn yedek yenileme | Mutfak ve masa ekranı senkron kalır |

### Neden hazır proje fork edilmedi
- **URY** (ERPNext): kapsamı en yakın proje, 10+ şubede canlı; ancak **AGPL-3.0** → her müşteri kurulumunda kaynak açma yükümlülüğü. Ayrıca ERPNext (MariaDB+Redis+bench) bir pizzacı için ağır.
- **BeepBite**: MIT/Apache, mimari örnek alındı (POS/KDS/kat planı/kurye ayrımı); pre-1.0 olduğu için kod devralınmadı.
- **Odoo 18 Community**: `pos_restaurant` mevcut ama OWL frontend özelleştirmesi ve Türkiye ÖKC boşluğu nedeniyle elendi.
- **SambaPOS**: Türkçe + ÖKC + aggregator hazır, ama kapalı kaynak → ürünleştirilemez.

## 4. Bileşenler

```
Tablet (garson/kasa)  ──HTTP──┐
Mutfak ekranı         ──HTTP──┤
                              ├─► Soprano Server (Fastify)  ──►  PGlite / Postgres
Yazıcı köprüsü ──HTTP kuyruk──┘         │
                                        └──► ESC/POS → 2 termal yazıcı (adisyon + mutfak)
```

- `src/server` — API, kimlik, para hesabı, fiş kuyruğu
- `src/bridge` — kuyruğu alıp yazıcıya basan ayrı süreç (`npm run bridge`)
- `src/ui` — POS, KDS, rapor, yönetim, vardiya ekranları
- `src/server/print/escpos.ts` — fiş/KOT bayt üretimi, TR karakter güvenliği

## 5. Veri modeli

`outlets · users · sessions · floors · tables · categories · products · variants · modifier_groups · modifiers · product_modifier_groups · shifts · orders · order_lines · line_modifiers · payments · print_jobs · settings`

Öne çıkanlar:

- `order_lines` ürün adı/fiyat/KDV **snapshot**’ı taşır → menü sonradan değişse de geçmiş bozulmaz.
- `orders` üzerinde `UNIQUE INDEX ... WHERE status='open'` → bir masada iki açık adisyon olamaz.
- `half_a / half_b (jsonb)` yarım-yarım pizza için ayrıldı (v2’de UI’ı gelecek).
- `print_jobs` kuyruğu: `queued → printed | failed`, hata metni saklanır.

## 6. Para ve KDV

- Fiyatlar KDV **dahil** saklanır (menü geleneği).
- `splitVat(gross, rate)`: net = round(gross×100/(100+rate)), KDV = gross − net.
- Adisyon toplamı KDV dilimi bazında hesaplanır; `subtotal + vat = total` her zaman.
- Ödeme kaydı **tahsil edilen** tutardır: her ödeme kalan borçla sınırlanır, para üstü ayrı döner. Böylece ciro ile ödeme raporu tutar.
- 11 birim testi (`src/server/__tests__/money.test.ts`) bunu kilitler.

## 7. Yetkiler

| İşlem | Garson | Kasiyer | Yönetici |
|---|---|---|---|
| Adisyon aç / ürün ekle / gönder | ✓ | ✓ | ✓ |
| Ödeme al | — | ✓ | ✓ |
| Satır iptali | — | — | ✓ |
| Vardiya aç/kapa | — | ✓ | ✓ |
| Rapor / yönetim | — | rapor | ✓ |

Yetki sunucuda uygulanır (`requireRole`); arayüz sadece gizler.

## 8. Hata davranışı

- Ağ hatası → ekran son veriyi korur, 6 sn’de bir yeniden dener; kullanıcıya toast.
- Yazıcı yok/hatalı → iş `failed` olarak işaretlenir, adisyon akışı **durmaz** (POS kilitlenmez).
- Oturum düşerse → login ekranına döner, açık adisyon verisi kaybolmaz (sunucuda).
- Açık adisyon varken vardiya kapatma → 400 + kaç adisyon açık bilgisi.

## 9. Test stratejisi

- Birim: para/KDV/yuvarlama (11 test).
- Uçtan uca API: 27 doğrulama — PIN, yetki, adisyon, modifier, gönderim, KDS geçişi, parçalı ödeme, para üstü, fiş kuyruğu, rapor, vardiya.
- Arayüz: gerçek tarayıcıda PIN → masa → ürün → gönder → KDS → ödeme akışı elle doğrulandı (ekran görüntüleri `docs/screenshots`).
- Donanım: yazıcı yoksa `DRY_RUN=1` ile `.bin` + `.txt` üretilir; sahadaki yazıcıda codepage testi gerekir.

## 10. Açık riskler

1. **ÖKC/e-Arşiv yok** — nakit satışta yasal fiş yükümlülüğü için sonraki faz şart.
2. **ESC/POS codepage** — model bazlı; varsayılan TR→ASCII çevirisi. CP857 destekleyen yazıcıda `SOPRANO_PRINTER_CP857=1`.
3. **PGlite tek süreç** — 1 şube için yeterli; 5+ terminalde gerçek Postgres’e geçilmeli.
4. **Yedekleme** — `var/pgdata` klasörü; gecelik kopyalama henüz otomatik değil (MVP).
5. **Masa birleştirme** ve paket servis yok — sözleşmede v2.
