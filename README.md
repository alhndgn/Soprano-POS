# Soprano POS

Pizzacı için masa/adisyon, mutfak ekranı ve kasa yönetimi. Tek sunucu, tablet tarayıcı, iki termal yazıcı.

![Masalar](docs/screenshots/tables.png)

## Ne var

- **Masa planı:** bölme (iç salon / bahçe / teras), kare-yuvarlak-dikdörtgen masa, sürükle-bırak yerleşim
- **Adisyon:** boy + ek malzeme + not, mutfağa gönderim, satır iptali
- **Mutfak ekranı:** Yeni → Hazırlanıyor → Hazır, canlı güncelleme
- **Kasa:** parçalı ödeme, para üstü, vardiya aç/kapa, günlük rapor
- **Menü görselleri:** ürün fotoğrafı yükle, sipariş kartlarında görünsün
- **Açık tema:** beyaz zemin + kırmızı vurgu, tablette yüksek kontrast
- **Adisyon iptali:** yanlış açılan adisyonu yönetici iptal eder

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
| Yönetim | `/admin` | Masa düzeni, menü + görseller, personel |
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
npm test            # 11 birim testi (para, KDV, yuvarlama, para üstü)
npm run typecheck   # tsc --noEmit
python scripts/e2e_layout.py     # 16 doğrulama: bölme/masa CRUD, yerleşim, silme korumaları
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

## Yol haritası

v0.2: paket servis + kurye · QR menü · ÖKC/e-Arşiv · Mikro aktarımı · stok-reçete · masa birleştirme.
Ayrıntı: `docs/superpowers/specs/2026-10-27-soprano-pos-design.md`
