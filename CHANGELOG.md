# Sürüm geçmişi

## v0.2.3 — 2 Kasım 2026

- Sol menüdeki profil alanı ve tema düğmesi kaldırıldı; ikisi de Yönetim → Ayarlar'da
- Tablet/telefonda üst menü tam genişliğe yayıldı, taşma giderildi
- Çıkış düğmesi tablette yazılı ve görünür (eski sürümde ekran dışına taşıyordu)
- Kısa ekranlarda menü daraltıldı; TeqStudio rozeti yer açmak için gizleniyor

## v0.2.2 — 2 Kasım 2026

- Tek başlatıcı: `Soprano.vbs` — sunucu + yazıcı köprüsü birlikte, gizli pencerelerde
- Sistem tepsisi simgesi: panele git, köprüyü yeniden başlat, günlükleri aç, durdur
- Eski `Soprano-POS.bat` artık sadece yeni başlatıcıyı çağırıyor
- `Soprano Kapat.bat` tepsi sürecini de kapatıyor

## v0.2.1 — 2 Kasım 2026

- Tablet uyumu: sayfa artık kaydırılıyor, sepet ekranın altında yapışık kalıyor
- 900 px altında iki, 640 px altında tek kolon akışkan yerleşim
- Modaller tablet ekranına göre sınırlandı (94vw / 90dvh)
- Parmakla yakınlaştırma açıldı
- Alt bileşenlerde (KPI, rapor, yönetim) yatay taşma giderildi

## v0.2.0 — 2 Kasım 2026

Bu sürümde restoranın günlük akışını tamamlayan modüller eklendi.

### Cari (veresiye) hesaplar
- Müşteri kartı: ad, telefon, not, kredi limiti
- Adisyonu tek tuşla cariye yazma; kalan tutar müşteri hesabına borç
- Hesap ekstresi (satış / tahsilat / düzeltme), bakiye takibi
- Nakit veya kartla tahsilat, kısmi ödeme
- Aylık cari satış ve tahsilat özeti, borçlu listesi
- WhatsApp ile borç hatırlatma bağlantısı

### Masa işlem menüsü
- Dolu masalarda `⋯` menüsü: Öde, Hızlı Öde, İptal, Yazdır, Masa Değiştir, Masaları Birleştir, Adisyon Aktar
- Ön hesap fişi (masayı kapatmadan)
- İki adisyonu birleştirme; adisyonu başka masaya aktarma

### Ayarlar: modül anahtarları
- Cari hesap, masa işlem menüsü, mutfak efektleri ve Gel Al modülleri açılıp kapatılabilir
- Kapatılan modül menüden kalkar, adresi Masalar'a yönlenir

### Arayüz
- Dolu masalar yeşil; içinde tutar, süre ve kişi sayısı
- Mutfak: turuncu (Başla) → mavi (Hazır) → yeşil (Servis) butonlar ve bildirim animasyonu
- Ödeme ekranı 1366×720 ve üzeri ekranlara tek seferde sığıyor
- Menü sırası: Masalar · Mutfak · Gel Al · Cari · Rapor · Yönetim · Vardiya
- TeqStudio imzası ve logosu

### Altyapı
- API yanıtlarında `cache-control: no-store` (bayat rapor/ayar sorunu)
- Sayfa geçişindeki `transform`, sabit konumlu pencereleri kaydırıyordu — düzeltildi
- Masa ekleme artık isim soruyor; masa adları özelleştirilebilir

## v0.1.0 — 1 Kasım 2026

- Masa planı, adisyon, mutfak ekranı (KDS), kasa ve vardiya
- Satır bazlı ödeme, iskonto, para üstü, müşteri adı
- Ürün yönetimi: açıklama, boyut, içindekiler, seçenek grupları, görsel
- Mutfak KOT, kasa fişi ve iptal fişi; ağ/USB/dosya yazıcı desteği
- Gel Al (paket) siparişleri
- Tarih aralıklı raporlar, kategori bazlı satış
- Tercihler: KDV, ürün/sipariş/masa detayı, masa bölümleri, tema
