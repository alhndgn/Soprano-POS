# Soprano POS — Uygulama Planı

**Tarih:** 2026-10-27 · **Durum:** Faz 1–3 tamam, Faz 4 kısmi

## Faz 0 — Keşif ve ortam (tamam)
- [x] Piyasa taraması: URY, BeepBite, Odoo, SambaPOS, Floreant karşılaştırması
- [x] Lisans kararı: kendi kod (MIT), AGPL fork yok
- [x] Ortam: Node 26, npm 11; Docker/psql yok → PGlite

## Faz 1 — İskelet + menü + masa (tamam)
- [x] Proje iskeleti (Vite + React + Fastify + TS)
- [x] Şema (`schema.sql`) + tohum verisi (18 ürün, 3 modifier grubu, 9 masa, 3 personel)
- [x] PIN girişi (scrypt) + oturum + rol kontrolü
- [x] `GET /api/bootstrap` (masa, menü, vardiya tek çağrıda)
- [x] Masa ekranı + açık adisyon rayı

## Faz 2 — Adisyon + modifier + KOT (tamam)
- [x] Adisyon aç/taşı, satır ekle, adet, iptal
- [x] Boy + modifier + not seçimi (bottom sheet)
- [x] Mutfağa gönder → satır durumu `sent`, KOT işi kuyruğa
- [x] KDS üç kolon + durum geçişleri
- [x] ESC/POS fiş ve KOT üretimi, yazıcı köprüsü (dry-run + ağ yazıcı)

## Faz 3 — Ödeme, kasa, rapor (tamam)
- [x] Parçalı ödeme, para üstü, tahsilat sınırlaması (ciro tutarlılığı)
- [x] Vardiya aç/kapa + açık adisyon koruması
- [x] Günlük rapor (ciro, adet, ortalama, ödeme dağılımı, saatlik, top ürünler)
- [x] Menü/personel yönetimi ekranı
- [x] 11 birim testi + 27 uçtan uca API doğrulaması
- [x] Gerçek tarayıcıda uçtan uca akış + ekran görüntüleri

## Faz 4 — Cila (kısmi)
- [x] SSE ile canlı yenileme, 15 sn yedek
- [x] Tablet için responsive düzen, koyu tema
- [ ] PWA ikonları + service worker (çevrimdışı kabuk)
- [ ] Masa birleştirme, yarım-yarım pizza UI’ı
- [ ] Gecelik otomatik yedek

## Faz 5 — Masa düzeni + ürün görselleri (tamam)
- [x] Şema: `tables.shape/x/y/w/h`, `products.image_url` (idempotent `ALTER TABLE ... IF NOT EXISTS`)
- [x] Bölme CRUD + masa CRUD + toplu konum kaydı (`PUT /api/admin/layout`)
- [x] Sürükle-bırak plan editörü (şekil, kişi, boyut, çakışma uyarısı, sınır kırpma)
- [x] POS masa ekranı plan görünümü (yuvarlak/kare/dikdörtgen, dolu-boş renkleri, süre)
- [x] Ürün görseli yükleme (multipart, 5 MB, JPEG/PNG/WEBP) + sipariş kartlarında gösterim
- [x] Demo görsel üretici (`scripts/make_food_images.py`), 18 ürüne uygulandı
- [x] `scripts/e2e_layout.py`: 16 doğrulama (CRUD, kalıcılık, sınır, silme korumaları)
- [x] Tarayıcıda sürükle-bırak testi (pointer olaylarıyla) ve kayıt doğrulaması

## Faz 6 — Açık tema + adisyon iptali (tamam)
- [x] Tasarım sistemi v2: beyaz zemin, kırmızı vurgu, kontrastlı ikincil metin, gölge/kenarlık disiplini
- [x] Demo yemek görselleri açık zemine göre yeniden üretildi (18 ürün)
- [x] `POST /api/orders/:id/void` — yönetici, ödeme alınmamış adisyonu iptal eder
- [x] Sipariş ekranında “Adisyonu iptal” butonu (yalnızca yönetici)
- [x] `scripts/reset_demo.py` — demo verisini tazeler (iptal + yeni vardiya + 3 dolu masa)
- [x] Ekran görüntüleri yeni temayla güncellendi, görsel inceleme yapıldı

## Faz 7 — Detaylı ürün yönetimi + içindekiler (tamam)
- [x] Şema: `products.description`, `product_ingredients`, `line_ingredients`
- [x] Pizza tarifleri ve hazırlanış metinleri tohumlandı (`db/recipes.ts`)
- [x] Ürün CRUD API (boyut + içerik + seçenek grupları ile birlikte, yumuşak silme)
- [x] Ürün yönetim ekranı: temel bilgi, hazırlanış, boyutlar, içindekiler, seçenekler, görsel, özet
- [x] Sipariş panelinde hazırlanış + içindekiler (çıkar/ekle, ✓ işaretleri, fiyat farkı)
- [x] Sepet satırında “X yok / + Y” etiketleri, KOT’ta `CIKAR/EKLE` satırları
- [x] `Ek Malzeme` grubu ile içerik ekstraları tekilleştirildi
- [x] 13 birim testi, 20 ürün + 16 yerleşim e2e doğrulaması, UI’dan kaydetme testi

## Sonraki sürüm (v0.2)
1. **Paket servis**: müşteri/adres defteri, bölge, kurye ataması, teslim durumu
2. **QR menü / online sipariş**: mevcut WordPress kurulumuna bağlanır
3. **ÖKC entegrasyonu**: `FiscalProvider` implementasyonu (Ingenico/Beko/Verifone SDK)
4. **e-Arşiv/e-Fatura**: entegratör API’si (Paraşüt/Uyumsoft/Logo)
5. **Mikro aktarımı**: gün sonu satış/fatura aktarım dosyası
6. **Stok & reçete**: hamur/peynir fire, maliyet, günlük P&L

## Kabul kriterleri (v1)
- Garson PIN → masa → ürün → gönder: ≤ 4 dokunuş ✓
- KOT 2 sn içinde kuyrukta ✓ (ölçüldü: anında)
- Kasa: ödeme toplamı = ciro, para üstü ciroya yazılmaz ✓ (test)
- KDV dilimleri doğru, kuruş kaybı yok ✓ (test)
- İnternet kesintisinde LAN çalışır ✓ (mimari gereği; saha testi bekliyor)
