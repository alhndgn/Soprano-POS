# Soprano POS — Ödeme, İskonto ve Adisyon Denetim Tasarımı

**Tarih:** 2026-10-29  
**Durum:** Kullanıcı tasarım yönünü ve kasa+yönetici iskonto yetkisini onayladı; implementasyon öncesi spec incelemesi bekleniyor.

## 1. Amaç

Kasiyerin ödeme sırasında masadaki ürünleri seçerek kısmi veya tam ödeme alabilmesi, nakit/kart tutarını gerektiğinde değiştirebilmesi, iskonto uygulayabilmesi ve müşteri adını opsiyonel kaydedebilmesi. Yönetici daha sonra ödenmiş ve iptal edilmiş adisyonları denetleyebilmeli.

Arayüz, gönderilen referans görseldeki ferah ürün + sabit işlem özeti yaklaşımını Soprano'nun mevcut kırmızı/beyaz marka kimliğiyle birleştirir. Turuncu kopyalanmaz; kırmızı yalnızca marka/önemli aksiyonlarda, ödeme tutarı ve ürün satırları ise nötr yüksek kontrastta kullanılır.

## 2. Onaylanan kararlar

- İskonto yetkisi: `cashier` ve `manager`.
- İskonto biçimleri: yüzde veya sabit TL.
- Ödeme yöntemi: nakit veya kart; mevcut parçalı ödeme davranışı korunur.
- Nakit ödeme tutarı düzenlenebilir; alınan tutar ödeme borcunu aşarsa para üstü ayrı hesaplanır.
- Ödeme ekranındaki mevcut nakit/kart altı hazır tutar düğmeleri kaldırılır; ürün seçimleri ve ödeme özeti yerleşir.
- Müşteri adı opsiyoneldir ve ödeme tamamlanırken kaydedilir.
- İptal edilen adisyon silinmez; neden, personel ve zamanla raporlanır.
- Ürün satırları tek tek seçilebilir. Qty > 1 satırında seçilen adet ayrıca ayarlanabilir.

## 3. Ödeme ekranı

### 3.1 Sol panel — Ödenecek ürünler

Her açık ve henüz tamamen ödenmemiş sipariş satırı:

- checkbox/seçim durumu,
- küçük ürün görseli veya kategori yer tutucusu,
- ürün adı, boyut ve modifier/içerik özeti,
- kalan adet için stepper,
- satırın kalan tutarı,
- `Ödenmedi`, `Kısmi ödendi`, `Ödendi` durumu

gösterir.

Satıra dokunmak seçim durumunu değiştirir; klavye ve native button/input semantiği korunur. Ödenmiş satır tekrar seçilemez. Seçili kalem toplamı anında sağ panele yansır.

### 3.2 Sağ panel — Ödeme özeti

Üstten alta:

1. Büyük `Ödenecek` tutar.
2. `İskonto` bölümü: `Yüzde` / `TL` seçimi, düzenlenebilir değer, indirim tutarı.
3. İskonto sonrası net tutar ve seçili ürünlerin toplamı.
4. İki büyük yöntem kartı: `Nakit`, `Kart`.
5. Düzenlenebilir `Ödeme tutarı` alanı; varsayılan seçili kalem borcudur.
6. Nakit seçilirse `Müşteriden alınan` alanı ve `Para üstü`; kartta bu alan gizlenir.
7. Opsiyonel `Müşteri adı` alanı.
8. Daha önce eklenmiş parçalı ödeme satırları.
9. `Ödeme ekle` / `Adisyonu kapat` ana aksiyonu ve `Vazgeç`.

Hazır tutar düğmeleri ödeme yöntemi altında gösterilmez. Tutar input'u virgül/nokta kabul eder ve Türkçe biçimde gösterir.

### 3.3 Ödeme davranışı

- Modal açılışında tüm ödenmemiş satırlar seçili gelir.
- Seçim değişince varsayılan ödeme tutarı seçili kalan borca eşitlenir; kasiyerin elle değiştirdiği tutar gereksiz yere ezilmez.
- Ödeme tutarı düşükse kalan tutar gösterilir ve ödeme eklenebilir; yüksekse yalnızca borca uygulanan kısım kaydedilir, nakitte fark para üstü olur.
- Seçili ürünlerin borcundan küçük manuel ödeme, allocations tablosuna sırayla dağıtılır; satır `Kısmi ödendi` kalır.
- Tüm sipariş borcu kapandığında adisyon `paid` olur. Fazla tendered tutar ciroya yazılmaz.
- Müşteri adı yalnızca boş olmayan trim edilmiş değer olarak kaydedilir.
- İskonto ödeme eklenmeden önce ekranda önizlenir; ilk ödeme transaction'ında adisyona snapshot olarak yazılır. İskonto uygulandıktan sonra aynı açık adisyonda tekrar değiştirilmez; denetim ve tutarlılık korunur.

## 4. Veri modeli

### 4.1 `orders` alanları

Idempotent migration ile:

- `customer_name text` — nullable.
- `discount_type text NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none','percent','fixed'))`.
- `discount_value integer NOT NULL DEFAULT 0` — yüzde için 0–100, sabit için kuruş.
- `discount_amount integer NOT NULL DEFAULT 0` — hesaplanan kuruş snapshot'ı.
- `discounted_by integer REFERENCES users(id)`.
- `discounted_at timestamptz`.
- `void_reason text` — nullable.
- `voided_by integer REFERENCES users(id)`.
- `voided_at timestamptz`.

Mevcut `status='void'`, `closed_at` ve satırların korunması devam eder.

### 4.2 `payments` alanları

Mevcut `amount` uygulanan/tahsilata yazılan tutar olmaya devam eder. Ek olarak:

- `tendered integer NOT NULL DEFAULT 0` — müşteriden alınan brüt tutar.
- `change_amount integer NOT NULL DEFAULT 0` — para üstü.

Eski ödeme kayıtları için migration varsayılanı `tendered=amount`, `change_amount=0` olur.

### 4.3 `payment_allocations`

Ürün seçimi ile gerçek ödeme arasında kalıcı bağ:

- `id serial primary key`.
- `payment_id integer NOT NULL REFERENCES payments(id) ON DELETE CASCADE`.
- `line_id integer NOT NULL REFERENCES order_lines(id)`.
- `amount integer NOT NULL` — bu ödeme ile satıra uygulanan net kuruş.
- `qty integer NOT NULL DEFAULT 1` — bu allocation'ın kapsadığı adet.

Bir satırın kalan borcu, indirim payı düşülmüş satır toplamından allocation toplamı çıkarılarak hesaplanır. Aynı ürünün eski adisyon satırı ve yeni satırı birbirine karıştırılmaz.

## 5. API sözleşmesi

### 5.1 Sipariş yükleme

`GET /api/orders/:id` mevcut yapıyı korur ve ekler:

- `customer_name`,
- `discount: { type, value, amount }`,
- `paid` ve satır bazlı `paid_amount`, `remaining_amount`, `payment_status`.

### 5.2 Ödeme

`POST /api/orders/:id/pay`

```json
{
  "payments": [
    {
      "method": "cash",
      "amount": 18000,
      "tendered": 20000,
      "allocations": [
        { "lineId": 42, "qty": 1 }
      ]
    }
  ],
  "discount": { "type": "percent", "value": 10 },
  "customerName": "Ayşe Yılmaz"
}
```

Sunucu transaction içinde:

1. Kullanıcı rolünü ve açık adisyonu doğrular.
2. Satırların kalan borcunu hesaplar.
3. İskontoyu doğrular ve yalnızca ilk ödeme öncesinde snapshot yazar.
4. Seçili allocation'ları kalan borçla sınırlar.
5. `payments` ve `payment_allocations` ekler.
6. `tendered - applied` farkını yalnızca nakitte `change_amount` olarak yazar.
7. Borç sıfırsa adisyonu kapatır ve fiş payload'ına müşteri adı/iskonto/para üstünü ekler.
8. `paid` event'i yayınlar.

Aşırı iskonto, negatif tutar, ödenmiş satır seçimi, bilinmeyen line id ve toplamdan fazla indirim reddedilir.

### 5.3 İptal

`POST /api/orders/:id/void`

```json
{ "reason": "Müşteri siparişi iptal etti" }
```

Yalnızca yönetici; ödeme alınmış adisyon iptal edilemez. `void_reason`, `voided_by`, `voided_at`, `closed_at` set edilir. Satır ve snapshot verileri silinmez.

## 6. Raporlar

`GET /api/reports/daily?date=YYYY-MM-DD` mevcut özet alanlarını korur ve ekler:

- `paidOrders`: adisyon no, masa, müşteri adı, iskonto, net toplam, ödeme yöntemi, kapanış zamanı.
- `voidedOrders`: adisyon no, masa, müşteri adı, brüt/net toplam, iptal nedeni, iptal eden, iptal zamanı.
- `discountTotal`: gün içindeki iskonto toplamı.

UI:

- KPI'larda `İskonto` toplamı.
- `Ödenen adisyonlar` tablosunda müşteri adı görünür; boşsa `—`.
- `İptal edilen adisyonlar` panelinde neden/personel/zaman görünür.
- Tarih filtresi tüm listeleri aynı güne bağlar.

Ciro yalnızca ödenmiş adisyonların net tutarıdır; para üstü ve iptal adisyon ciroya girmez.

## 7. Görsel sistem

- Referans görseldeki ürün listesi + sabit işlem özeti düzeni korunur.
- Soprano kırmızı/beyaz tema, mevcut sidebar ve 44px dokunma hedefleri korunur.
- Ödeme ekranında toplam ve ana aksiyon kırmızıyla öne çıkar; satır fiyatları koyu nötr; iskonto yeşil değil, ayrı bir bilgi tonu ile gösterilir.
- Seçili ürünler açık kırmızı zemin + checkbox + metinle belirtilir; renk tek başına anlam taşımaz.
- Ödenmiş satırlarda metin etiketi ve pasif durum kullanılır.
- Modal uzun içerikte sabit footer ve içeride scroll kullanır.
- Türkçe metin; İngilizce mikro başlık yok.

## 8. Hata ve güvenlik

- Kasa ve yönetici iskonto uygulayabilir; işlem yapan kullanıcı snapshot'ı tutulur.
- Ödeme transaction'ı başarısız olursa hiçbir payment/allocation/order güncellemesi kalmaz.
- Aynı açık adisyona iki kasiyer eşzamanlı ödeme gönderirse server kalan borcu transaction içinde tekrar doğrular; fazla tahsilat yaratmaz.
- PGlite tek süreç kuralı korunur.
- Geçmiş satır, payment ve iptal kayıtları hard-delete edilmez.

## 9. Kabul kriterleri

- [ ] Ödeme modalında hazır tutar düğmeleri yok; ürün satırları geliyor.
- [ ] Margarita + Kola seçilince seçilen toplam otomatik hesaplanıyor.
- [ ] Seçili miktar değişince toplam güncelleniyor.
- [ ] Nakit/kart seçimi kart biçiminde; ödeme tutarı elle değiştirilebiliyor.
- [ ] Nakit müşteriden alınan ve para üstü doğru; para üstü ciroya girmiyor.
- [ ] Yüzde ve sabit iskonto doğru, negatif/aşırı değer reddediliyor.
- [ ] Müşteri adı ödeme sonrası adisyon ve raporda görünüyor.
- [ ] İptal nedeni/personel/zaman raporda görünüyor; iptal ciroya girmiyor.
- [ ] Parçalı ödeme ve satır bazlı allocation aynı adisyonu iki kez ödetmiyor.
- [ ] `npx tsc --noEmit`, Vite build, Vitest, mevcut e2e ve yeni ödeme/rapor e2e testleri geçiyor.
- [ ] Tarayıcıda gerçek akış: ürün seçimi → iskonto → nakit para üstü → müşteri adı → rapor; ayrıca kart ve iptal akışı.
