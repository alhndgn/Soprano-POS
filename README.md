# Soprano POS

Pizzacı için masa/adisyon, mutfak ekranı ve kasa yönetimi. Tek sunucu, tablet tarayıcı, iki termal yazıcı.

![Masalar](docs/screenshots/tables.png)

## Ne var

- **Masa planı:** bölme (iç salon / bahçe / teras), kare-yuvarlak-dikdörtgen masa, sürükle-bırak yerleşim
- **Adisyon:** boy + ek malzeme + not, mutfağa gönderim, satır iptali
- **Mutfak ekranı:** Yeni → Hazırlanıyor → Hazır, canlı güncelleme
- **Kasa:** parçalı ödeme, para üstü, vardiya aç/kapa, günlük rapor
- **Detaylı ürün yönetimi:** hazırlanış metni, boyutlar, içindekiler, seçenek grupları, görsel
- **İçindekiler siparişte:** malzemeyi çıkar/ekle (ekstralar fiyatlı), mutfağa `ÇIKAR/EKLE` olarak gider
- **Menü görselleri:** ürün fotoğrafı yükle, sipariş kartlarında görünsün
- **Açık tema:** sıcak beyaz yüzeyler + tomato red vurgu, tablette yüksek kontrast
- **Premium UI/UX:** operasyonel sidebar, KPI başlıkları, canlı servis paneli, KDS tek sipariş kartı, responsive POS
- **Adisyon iptali:** yanlış açılan adisyonu yönetici iptal eder (gerekçe + personel kaydı, raporda ayrı panel)
- **Gel Al (paket):** ayrı ekran, müşteri adı/telefon, masadan bağımsız adisyon
- **Satır bazlı ödeme:** ürün seçerek kısmi ödeme, iskonto (%/₺), nakit/kart, canlı para üstü
- **Yazıcılar:** mutfak KOT + kasa fişi + iptal fişi; ağ (9100), USB (Windows spooler) veya dosya; test fişi ve iş kuyruğu
- **Ayarlar:** KDV gösterimi, ürün detayları, sipariş detayı, masa bölümleri, masa düzeni, ödeme ön seçimi, tema
- **Raporlar:** tarih aralığı, günlük ortalama, kategori bazlı satış, en çok satanlar, ödenen/iptal adisyonlar
- **Kategori görselleri:** yönetimden kategori resmi yükle, sipariş ekranında görünsün
- **İlk açılışta kişi sayısı:** boş masaya dokununca kaç kişi sorulur
- **Tablet uyumlu:** 800–1280 px arası dikey/yatay tabletlerde tek kolon sipariş + altta sepet

## Hızlı başlangıç

```bash
npm install
npm run seed        # menü + masalar + personel (idempotent)
npm run build       # arayüzü derle
npm start           # http://localhost:8095
```

Geliştirme sırasında iki süreç:

```bash
npm run dev         # API :8095 + Vite :5175 (proxy'li)
```

Yazıcı köprüsü (ayrı terminal):

```bash
DRY_RUN=1 npm run bridge          # yazıcı yoksa var/prints/*.bin + .txt
RECEIPT_PRINTER=192.168.1.50:9100 KITCHEN_PRINTER=192.168.1.51:9100 npm run bridge
```

## Demo PIN'leri

| Kişi | Rol | PIN |
|---|---|---|
| Alihan | Yönetici | 1234 |
| Deniz | Garson | 1111 |
| Ece | Kasiyer | 2222 |

> Kurulumda **mutlaka değiştir**: `npm run seed` sonrası `users` tablosundaki `pin_hash` alanı yeniden üretilmeli (yönetim ekranından yeni personel ekleyip eskileri pasife al).

## Ekranlar

| Ekran | Yol | İş |
|---|---|---|
| Masalar | `/tables` | Masa durumu, açık adisyon rayı |
| Adisyon | `/order/:id` | Ürün/modifier seçimi, mutfağa gönderim, ödeme |
| Mutfak | `/kds` | Üç kolonlu hazırlık akışı |
| Rapor | `/reports` | Günlük ciro, ödeme dağılımı, top ürünler |
| Gel Al | `/takeaway` | Paket siparişler, yeni gel al |
| Yönetim | `/admin` | Menü + görseller, personel, masa düzeni, yazıcılar, ayarlar |
| Vardiya | `/shift` | Kasa aç/kapa |

## Mimari

```
src/server   Fastify API + para matematiği + fiş kuyruğu
src/bridge   ESC/POS yazıcı köprüsü (ayrı süreç)
src/ui       React PWA (POS, KDS, rapor, yönetim)
```

- **Veritabanı:** PGlite (gömülü Postgres) → `var/pgdata`. Gerçek Postgres’e geçiş için `SOPRANO_DB` yerine ileride `DATABASE_URL` desteği eklenir; şema birebir Postgres.
- **Para:** her şey kuruş (integer), fiyatlar KDV dahil.
- **Yetki:** garson / kasiyer / yönetici, sunucuda uygulanır.
- **Canlılık:** SSE (`/api/events`) + 15 sn yedek yenileme.

## Test

```bash
npm test            # 36 birim testi (para, KDV, iskonto, ödeme dağıtımı, fiş KDV'si)
npm run typecheck   # tsc --noEmit
python scripts/e2e_layout.py     # 16 doğrulama: bölme/masa CRUD, yerleşim, silme korumaları
python scripts/e2e_products.py   # 20 doğrulama: ürün CRUD, içerik fiyatı, KOT içeriği
python scripts/make_food_images.py <token>   # demo yemek görselleri üret + yükle
```

Uçtan uca API senaryosu (27 doğrulama) `scripts/e2e.py` içinde — **temiz veritabanında** (`var/` silinip yeniden tohumlandıktan sonra) sunucu açıkken `python scripts/e2e.py`.

## Yapılandırma

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | 8095 | API portu |
| `SOPRANO_DB` | `var/pgdata` | Veri klasörü |
| `SOPRANO_API` | `http://127.0.0.1:8095` | Köprünün bağlanacağı sunucu |
| `RECEIPT_PRINTER` | — | `host:port` (adisyon yazıcısı) |
| `KITCHEN_PRINTER` | — | `host:port` (mutfak yazıcısı) |
| `DRY_RUN` | yazıcı yoksa 1 | Fişi dosyaya yazar |
| `SOPRANO_PRINTER_CP857` | 0 | 1 ise Türkçe karakterler ham gönderilir |

## Güncelleme (şubeler)

Kurulum git ile alınmışsa (`git clone`), yeni sürüm için:

1. Sunucu penceresini kapat (veya **Soprano Kapat.bat**)
2. **GUNCELLE.bat** çift tıkla → `git fetch` + `npm install` + build + uygulamayı başlatır
3. Veriler `var/` klasöründe kalır, güncellemeden etkilenmez

Geliştirme makinesinde yayınlama:

```bash
git add -A
git commit -m "Aciklama"
git push
```

## Yol haritası

v0.2: kurye takibi · QR menü · ÖKC/e-Arşiv · Mikro aktarımı · stok-reçete · masa birleştirme.
Ayrıntı: `docs/superpowers/specs/2026-10-27-soprano-pos-design.md`
