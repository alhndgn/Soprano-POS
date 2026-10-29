# Soprano Ödeme ve Adisyon Denetimi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ürün satırı seçimi, parçalı nakit/kart ödeme, iskonto, müşteri adı ve iptal denetim raporlarını Soprano POS'a güvenli ve Türkçe bir ödeme akışı olarak eklemek.

**Architecture:** Mevcut Fastify + PGlite API ve React/Vite PWA korunacak. Para/iskonto/allocation kuralları server tarafında ortak integer-kuruş yardımcılarıyla doğrulanacak; UI yalnızca önizleme yapacak. Ödeme satırları `payment_allocations` ile adisyon satırlarına bağlanacak, raporlar aynı server hesaplarını kullanacak.

**Tech Stack:** TypeScript, React 19, Vite, Fastify, Zod, PGlite/PostgreSQL uyumlu SQL, Vitest, Python HTTP e2e.

**Spec:** `docs/superpowers/specs/2026-10-29-soprano-payment-audit-design.md`

## Global Constraints

- Tüm para alanları kuruş (`integer`); frontend'de Türkçe `₺` biçimi, API'de integer.
- Para üstü ciroya yazılmaz; `payments.amount` uygulanan tutardır, tendered/change ayrı tutulur.
- Geçmiş adisyon, ödeme, satır ve iptal kayıtları hard-delete edilmez.
- İskonto yetkisi `cashier` ve `manager`; işlem yapan kullanıcı snapshot'ı korunur.
- Soprano'nun mevcut kırmızı/beyaz teması, Türkçe metinleri ve 44px dokunma hedefleri korunur.
- PGlite tek süreçtir; e2e temiz veritabanında çalıştırılır, mevcut demo verisi korunur.
- Mevcut ödeme payload'ı allocations olmadan gelirse geriye dönük uyumluluk için tüm ödenmemiş satırlar seçilmiş kabul edilir.
- Kullanıcı ekran görüntüsü istemedi; browser doğrulaması DOM/akış çıktılarıyla yapılacak, dosyaya screenshot eklenmeyecek.

## Review Focus

- Qty > 1 satırında yalnızca seçilen adet ödenmeli; aynı satırın kalan adedi sonraki ödemede tekrar seçilebilir.
- Yüzde ve sabit iskonto toplamı aşmamalı; kuruş yuvarlaması satır allocations toplamıyla birebir kapanmalı.
- Nakit tendered tutarı borcu aşarsa yalnızca fark para üstü olmalı; rapor ciroyu uygulanan net tutardan üretmeli.
- Eşzamanlı/tekrarlı ödeme veya daha önce allocation yapılmış satır ikinci kez tahsil edilmemeli.
- İptal nedeni boş/eksik, ödeme alınmış adisyon veya yetkisiz kullanıcı durumları anlaşılır 4xx ile reddedilmeli.

---

### Task 1: Kuruş, iskonto ve allocation domain kuralları

**Files:**
- Modify: `src/server/money.ts`
- Create: `src/server/__tests__/payment.test.ts`
- Modify: `src/server/db/schema.sql`

**Interfaces:**
- Produces `DiscountInput = { type: 'none' | 'percent' | 'fixed'; value: number }`.
- Produces `discountAmount(gross: number, discount: DiscountInput): number`.
- Produces `allocateDiscount(grosses: number[], discountAmount: number): number[]`; sonuçların toplamı `discountAmount` ile birebir eşleşir, hiçbir net satır negatif olmaz.
- Produces `lineGrossFromParts(unitPrice, qty, modifierTotal, ingredientTotal): number` veya mevcut `lineGross` üzerinden eşdeğer ortak hesap.
- Produces `allocatePayment(dueByLine: { lineId: number; due: number; qty: number }[], amount: number, requested: { lineId: number; qty: number }[]): { lineId: number; qty: number; amount: number }[]`.

- [ ] **Step 1: Failing unit tests yaz**
  - `%10` of `10000` → `1000` indirim, net `9000`.
  - Sabit `2500` indirim gross `2000` ise indirim `2000`, net negatif olmaz.
  - `grosses=[10000,3000]`, indirim `1300` allocation toplamı `1300` olur.
  - İki adetlik satırdan qty `1` seçilince allocation yalnızca bir birim tutarını kapsar.
  - Requested line already due `0` ise allocation üretilmez.

- [ ] **Step 2: Testlerin beklenen şekilde başarısız olduğunu doğrula**
  - Run: `npx vitest run src/server/__tests__/payment.test.ts`
  - Expected: yeni helper exportları bulunamadığı için FAIL.

- [ ] **Step 3: Integer domain helper'larını uygula**
  - `src/server/money.ts` içinde yüzdeyi `Math.round(gross * value / 100)`, sabit indirimi `Math.min(value, gross)` ile sınırla.
  - Proportional discount remainder'ını deterministik biçimde son uygun satıra vererek toplamı kapat.
  - Allocation'ı server'ın seçtiği satır sırasına göre due ile sınırla; negatif ve daha önce tamamen ödenmiş satırları dışla.
  - `schema.sql` içine idempotent `orders`, `payments` alanlarını ve `payment_allocations` tablosunu ekle. Eski payment kayıtlarında `tendered=amount`, `change_amount=0` backfill yapılmalı; yeni kolonlar backfill sonrasında `NOT NULL` olmalı.

- [ ] **Step 4: Unit testleri geçir**
  - Run: `npx vitest run src/server/__tests__/money.test.ts src/server/__tests__/payment.test.ts`
  - Expected: mevcut 13 test + yeni domain testleri PASS.

- [ ] **Step 5: Commit**
  - `git add src/server/money.ts src/server/__tests__/payment.test.ts src/server/db/schema.sql`
  - `git commit -m "Odeme domain kurallarini ve allocation semasini ekle"`

---

### Task 2: Sipariş yükleme, ödeme, iskonto, iptal ve rapor API'si

**Files:**
- Modify: `src/server/routes.ts`
- Modify: `src/ui/api.ts`
- Modify: `scripts/e2e.py` (geriye dönük body doğrulaması gerekirse)
- Create: `scripts/e2e_payments.py`

**Interfaces:**
- `GET /api/orders/:id` satırlara `paid_amount`, `remaining_amount`, `payment_status`; adisyona `customer_name`, `discount`, `paid` döndürür.
- `POST /api/orders/:id/pay` body:
  `{ payments: [{ method, amount, tendered, allocations: [{ lineId, qty }] }], discount?: { type, value }, customerName?: string }`.
- Pay response: `{ ok, change, applied, orderId, status }`.
- `POST /api/orders/:id/void` body `{ reason: string }`.
- `GET /api/reports/daily` response'a `discountTotal`, `paidOrders`, `voidedOrders` eklenir.

- [ ] **Step 1: Yeni API senaryolarını yaz**
  - `scripts/e2e_payments.py`: yönetici/kasiyer login; iki ürünlü adisyon; yüzde iskonto; tek satır allocation; eksik ödeme; nakit tendered + para üstü; müşteri adı; ödeme sonrası order snapshot; günlük rapor müşteri/iskonto/ciro; yeni açık adisyonu reason ile void; void raporu; garsonun ödeme/iskonto yetkisizliği.
  - Expected fixtures: `Margarita Büyük 30000`, `Kola 4000 x2`, `%10` discount, applied/changing totals explicitly asserted.

- [ ] **Step 2: Temiz veritabanında senaryonun başarısız olduğunu doğrula**
  - Run server on a temporary/clean `var/pgdata`, then `python scripts/e2e_payments.py`.
  - Expected: yeni alanlar/endpoint payload'ları bulunamadığı için FAIL.

- [ ] **Step 3: `loadOrder` finansal snapshot'ını genişlet**
  - `routes.ts` içinde order discount/customer alanlarını çek.
  - Payment allocations toplamını satır bazında hesapla; indirimli net satır borcunu expose et.
  - `payments` response'a `tendered`, `change_amount`, allocation bilgilerini ekle.

- [ ] **Step 4: `POST /api/orders/:id/pay` transaction'ını uygula**
  - `cashier|manager` kontrolünü koru.
  - İlk payment'ta discount snapshot'ını yaz; sonraki parçalı ödemelerde aynı discount'ı zorunlu kıl.
  - Seçili line/qty'leri server due ile doğrula; allocations insert et.
  - Nakit `tendered` >= applied tutarını zorunlu tut; `change_amount = tendered - applied` ve rapor amount yalnız applied olsun.
  - Net order due sıfırsa `paid`, customer name'i trim ederek kaydet, receipt payload'ına discount/customer/change ekle.
  - Transaction rollback ve duplicate allocation kontrollerini ekle.

- [ ] **Step 5: İptal denetimini uygula**
  - `reason` trim edilmiş en az 3 karakter olsun.
  - Yalnız manager; payment varsa 400; voided_by/voided_at/void_reason/closed_at set; lines korunur.

- [ ] **Step 6: Günlük rapor sorgularını genişlet**
  - Ciro net paid order totals üzerinden; discount toplamı ayrıca.
  - Paid orders customer/discount/payment summary ile.
  - Voided orders reason/person/time ve gross/net snapshot ile.

- [ ] **Step 7: API tipleri ve client method'larını güncelle**
  - `Order`, `OrderLine`, `Report`, `PaymentPayload`, `PaymentResult` TypeScript tiplerini ekle.
  - `api.pay` yeni body'yi, `api.voidOrder` reason'ı taşısın.

- [ ] **Step 8: E2E testlerini geçir**
  - Run: `python scripts/e2e_payments.py`
  - Run: `python scripts/e2e.py`, `python scripts/e2e_products.py`
  - Expected: yeni ödeme senaryosu PASS; mevcut 27 + ürün testleri regression vermeden PASS.

- [ ] **Step 9: Commit**
  - `git add src/server/routes.ts src/ui/api.ts scripts/e2e.py scripts/e2e_payments.py`
  - `git commit -m "Odeme allocation iskonto ve denetim API'sini ekle"`

---

### Task 3: Referans görsele uyumlu ürün seçimi ve ödeme modalı

**Files:**
- Create: `src/ui/components/PaymentModal.tsx`
- Modify: `src/ui/pages/Order.tsx`
- Modify: `src/ui/styles.css`
- Modify: `src/ui/api.ts` (yalnız Task 2 tipleri eksikse)

**Interfaces:**
- `PaymentModalProps = { order: Order; onClose: () => void; onSubmit: (payload: PaymentPayload) => Promise<PaymentResult>; onDone: (result: PaymentResult) => void; onError: (message: string) => void }`.
- Modal kendi geçici UI state'ini tutar: selected line qty, method, amount, tendered, discount, customer name, staged payments.
- `onSubmit` yalnız server'a gidecek integer payload üretir; UI hesabı server doğrulamasının yerine geçmez.

- [ ] **Step 1: UI davranış test checklist'ini tanımla**
  - Ürün satırları açılışta ödenmemiş kalan qty ile gelir.
  - Margarita/Kola seçimi selected total'ı değiştirir.
  - Qty stepper bir satırın kalan adetini aşamaz.
  - Nakit/kart seçiminde quick amount button bulunmaz.
  - Manuel tutar ve indirim preview'si görünür; net toplam ve para üstü güncellenir.
  - Müşteri adı boş bırakılabilir.

- [ ] **Step 2: `PaymentModal.tsx` oluştur**
  - Sol `payment-lines` ve sağ `payment-summary` grid'i.
  - Her satır native button/checkbox/input; seçili durum renk + metin ile.
  - Sağda büyük toplam, yüzde/TL iskonto segmented control, düzenlenebilir payment input, cash tendered, change, customer name.
  - Hazır tutar listesi ve mevcut `quick-amounts` kaldırılacak.
  - Parçalı payment rows ve `Ödeme ekle`/`Adisyonu kapat` akışını koru.
  - Error/disabled/empty states ve `aria-live` ekle.

- [ ] **Step 3: `Order.tsx` entegrasyonunu yap**
  - Inline `PaymentModal` kaldırılıp yeni component import edilir.
  - `order.totals.total` yerine modal `order` satır snapshot'ını kullanır.
  - Ödeme sonucu order refresh + tables navigation davranışı korunur.
  - Mevcut iptal aksiyonu, Task 4'te eklenecek `VoidOrderModal` için açma state'ine hazırlanır; iptal modalının kendisi Task 4'te uygulanır.

- [ ] **Step 4: CSS'i görsel sisteme bağla**
  - Referans görselin açık, kartlı ve sabit sağ özet yaklaşımı; Soprano kırmızı/beyaz tokenları.
  - Desktop iki kolon; 900px altında dikey akış; 44px dokunma hedefi.
  - Payment footer sabit; uzun ürün listesi scroll.
  - Nakit/kart semantiği yalnız renkle değil label/icon/metinle ayrılır.

- [ ] **Step 5: Typecheck/build ve browser smoke**
  - Run: `npx tsc --noEmit`
  - Run: `node node_modules/vite/bin/vite.js build`
  - Browser: login → açık adisyon → Ödeme Al; product selection, discount, method toggle, manual amount, customer field; no screenshot file required.

- [ ] **Step 6: Commit**
  - `git add src/ui/components/PaymentModal.tsx src/ui/pages/Order.tsx src/ui/styles.css src/ui/api.ts`
  - `git commit -m "Secilebilir urunlerle odeme ekranini yenile"`

---

### Task 4: İptal nedeni ve rapor ekranı

**Files:**
- Create: `src/ui/components/VoidOrderModal.tsx`
- Modify: `src/ui/pages/Order.tsx`
- Modify: `src/ui/pages/Reports.tsx`
- Modify: `src/ui/styles.css`

**Interfaces:**
- `VoidOrderModalProps = { orderId: number; onClose: () => void; onDone: () => void; onError: (message: string) => void }`.
- Reports consumes `Report.paidOrders`, `Report.voidedOrders`, `Report.discountTotal` from Task 2.

- [ ] **Step 1: Void modalı uygula**
  - Neden alanı required, en az 3 karakter; yıkıcı aksiyon ayrı renkte.
  - Submit `api.voidOrder(orderId, reason)`; başarıda tables refresh/navigation.
  - Browser `confirm()` kaldırılır.

- [ ] **Step 2: Reports UI'ı genişlet**
  - KPI: `İskonto`.
  - `Ödenen adisyonlar` paneli: no/masa/müşteri adı/net/iskonto/ödeme/zaman.
  - `İptal edilen adisyonlar` paneli: no/masa/toplam/neden/personel/zaman.
  - Boş durumları yönlendirici Türkçe metinle göster; tarih filtresi aynı report query'yi kullanır.

- [ ] **Step 3: Browser smoke ve accessibility kontrolü**
  - `role=dialog`, labelled inputs, `role=alert/status`, native controls, unnamed button count zero.
  - 1440px ve 820px viewport'ta overflow/scroll/focus kontrolü.

- [ ] **Step 4: Commit**
  - `git add src/ui/components/VoidOrderModal.tsx src/ui/pages/Order.tsx src/ui/pages/Reports.tsx src/ui/styles.css`
  - `git commit -m "Adisyon iptali ve finans raporlarini genislet"`

---

### Task 5: Tam doğrulama, migration regression ve teslim

**Files:**
- Modify: `scripts/e2e_payments.py` (yalnız test düzeltmeleri)
- Modify: `docs/superpowers/plans/2026-10-29-soprano-payment-audit-plan.md` (tamamlanan checkbox'lar)
- Optional modify: `README.md` (ödeme akışı ve rapor notu)

- [ ] **Step 1: Temiz PGlite e2e**
  - Sunucuyu geçici temiz `var/pgdata` ile başlat; `scripts/e2e.py`, `scripts/e2e_products.py`, `scripts/e2e_payments.py`, `scripts/e2e_layout.py` çalıştır.
  - Expected: 27 temel + 20 ürün + 16 layout + yeni payment/audit senaryoları PASS.
  - Mevcut demo `var/pgdata` klasörünü geri yükle.

- [ ] **Step 2: Unit/build doğrulaması**
  - `npx vitest run`
  - `npx tsc --noEmit`
  - `node node_modules/vite/bin/vite.js build`

- [ ] **Step 3: Gerçek tarayıcı akışı**
  - Açık adisyon oluştur; Margarita ve Kola satırlarını seç; yüzde iskonto uygula; nakit tendered ile kapat; müşteri adını yaz; raporda kontrol et.
  - Kart ödeme akışını ayrı bir adisyonla kontrol et.
  - Yeni adisyonu iptal et; neden/personel/zamanın iptal raporunda göründüğünü kontrol et.
  - Aynı satırı ikinci kez seçememe ve kısmi qty davranışını kontrol et.

- [ ] **Step 4: Git diff/self-review**
  - `git diff --check`, `git status --short`, `git log --oneline -5`.
  - Şema migration'larının idempotent, receipt payload'ının customer/discount/change içerdiğini kontrol et.

- [ ] **Step 5: Final commit**
  - `git add docs README.md scripts/e2e_payments.py`
  - `git commit -m "Odeme ve adisyon denetimi dogrulamasini tamamla"`
