-- Soprano POS — Postgres şeması (PGlite üzerinde birebir çalışır)
-- Tüm para alanları kuruş (integer). Tüm zamanlar timestamptz.

CREATE TABLE IF NOT EXISTS outlets (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  currency    text NOT NULL DEFAULT 'TRY',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  outlet_id     integer NOT NULL DEFAULT 1,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('waiter','cashier','manager')),
  pin_hash      text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token       text PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS floors (
  id    serial PRIMARY KEY,
  name  text NOT NULL,
  sort  integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tables (
  id        serial PRIMARY KEY,
  floor_id  integer NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  name      text NOT NULL,
  seats     integer NOT NULL DEFAULT 4,
  sort      integer NOT NULL DEFAULT 0,
  active    boolean NOT NULL DEFAULT true
);

-- Masa düzeni (yerleşim planı): konum/boyut 1000x600 mantıksal tuvalde
ALTER TABLE tables ADD COLUMN IF NOT EXISTS shape text NOT NULL DEFAULT 'square';
ALTER TABLE tables ADD COLUMN IF NOT EXISTS x integer NOT NULL DEFAULT 0;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS y integer NOT NULL DEFAULT 0;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS w integer NOT NULL DEFAULT 120;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS h integer NOT NULL DEFAULT 110;
ALTER TABLE tables DROP CONSTRAINT IF EXISTS tables_shape_check;
ALTER TABLE tables ADD CONSTRAINT tables_shape_check CHECK (shape IN ('square','round','rect'));

CREATE TABLE IF NOT EXISTS categories (
  id    serial PRIMARY KEY,
  name  text NOT NULL,
  emoji text,
  sort  integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id           serial PRIMARY KEY,
  category_id  integer NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name         text NOT NULL,
  vat_rate     integer NOT NULL DEFAULT 10,   -- %10 yiyecek, %20 içecek
  active       boolean NOT NULL DEFAULT true,
  sort         integer NOT NULL DEFAULT 0
);

-- Ürün görseli (yüklenen dosyanın yolu: /uploads/products/...)
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text;
-- Uzun açıklama / hazırlanış (menüde ve sipariş ekranında gösterilir)
ALTER TABLE products ADD COLUMN IF NOT EXISTS description text;
-- Yumuşak silme: silinen ürün yönetim listesinde de görünmez (pasiften farkı budur)
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
-- Kategori görseli (sipariş ekranındaki kategori şeridinde gösterilir)
ALTER TABLE categories ADD COLUMN IF NOT EXISTS image_url text;

-- Ürünün içindekiler: dahil olanlar ve ekstra fiyatlı eklenebilirler
CREATE TABLE IF NOT EXISTS product_ingredients (
  id          serial PRIMARY KEY,
  product_id  integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name        text NOT NULL,
  price       integer NOT NULL DEFAULT 0,   -- 0 = ücretsiz
  included    boolean NOT NULL DEFAULT true, -- true: varsayılan içerik, false: ekstra
  sort        integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS product_ingredients_idx ON product_ingredients(product_id) WHERE active;

-- Boyut/varyant: pizzalarda Küçük/Orta/Büyük, diğerlerinde tek "Standart"
CREATE TABLE IF NOT EXISTS variants (
  id          serial PRIMARY KEY,
  product_id  integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name        text NOT NULL,
  price       integer NOT NULL,               -- kuruş, KDV dahil
  sort        integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS modifier_groups (
  id        serial PRIMARY KEY,
  name      text NOT NULL,
  min_sel   integer NOT NULL DEFAULT 0,
  max_sel   integer NOT NULL DEFAULT 99,
  sort      integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS modifiers (
  id        serial PRIMARY KEY,
  group_id  integer NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name      text NOT NULL,
  price     integer NOT NULL DEFAULT 0,
  active    boolean NOT NULL DEFAULT true,
  sort      integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_modifier_groups (
  product_id  integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_id    integer NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, group_id)
);

CREATE TABLE IF NOT EXISTS shifts (
  id             serial PRIMARY KEY,
  opened_by      integer NOT NULL REFERENCES users(id),
  opened_at      timestamptz NOT NULL DEFAULT now(),
  opening_float  integer NOT NULL DEFAULT 0,
  closed_by      integer REFERENCES users(id),
  closed_at      timestamptz,
  closing_count  integer
);

CREATE TABLE IF NOT EXISTS orders (
  id           serial PRIMARY KEY,
  outlet_id    integer NOT NULL DEFAULT 1,
  table_id     integer REFERENCES tables(id),
  shift_id     integer REFERENCES shifts(id),
  opened_by    integer NOT NULL REFERENCES users(id),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','void')),
  guest_count  integer NOT NULL DEFAULT 1,
  note         text,
  opened_at    timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz
);

-- Ödeme/denetim snapshot'ları: mevcut kurulumlarda idempotent migration.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_type text NOT NULL DEFAULT 'none';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_value integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discounted_by integer REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discounted_at timestamptz;
-- Gel al / paket siparişler: masa yok, müşteri adı ve telefon opsiyonel
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'dine_in';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_order_type_check CHECK (order_type IN ('dine_in','takeaway'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS voided_by integer REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_discount_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_discount_type_check CHECK (discount_type IN ('none','percent','fixed'));

-- Bir adisyon aynı masada birden fazla açık olamaz
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_open_per_table
  ON orders(table_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS order_lines (
  id            serial PRIMARY KEY,
  order_id      integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    integer NOT NULL REFERENCES products(id),
  variant_id    integer REFERENCES variants(id),
  name          text NOT NULL,               -- sipariş anındaki snapshot
  qty           integer NOT NULL DEFAULT 1,
  unit_price    integer NOT NULL,            -- kuruş, KDV dahil, modifier hariç
  vat_rate      integer NOT NULL DEFAULT 10,
  note          text,
  status        text NOT NULL DEFAULT 'new'
                CHECK (status IN ('new','sent','preparing','ready','served','void')),
  -- yarım-yarım pizza: iki yarımın ürün/varyant bilgisi
  half_a        jsonb,
  half_b        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);

CREATE INDEX IF NOT EXISTS lines_order_idx ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS lines_kds_idx ON order_lines(status) WHERE status IN ('sent','preparing','ready');

CREATE TABLE IF NOT EXISTS line_modifiers (
  id          serial PRIMARY KEY,
  line_id     integer NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  modifier_id integer NOT NULL REFERENCES modifiers(id),
  name        text NOT NULL,
  price       integer NOT NULL DEFAULT 0
);

-- Sipariş satırında içerik değişikliği (çıkarıldı / eklendi)
CREATE TABLE IF NOT EXISTS line_ingredients (
  id            serial PRIMARY KEY,
  line_id       integer NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  ingredient_id integer REFERENCES product_ingredients(id) ON DELETE SET NULL,
  name          text NOT NULL,
  mode          text NOT NULL CHECK (mode IN ('removed','added')),
  price         integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS line_ingredients_idx ON line_ingredients(line_id);

CREATE TABLE IF NOT EXISTS payments (
  id          serial PRIMARY KEY,
  order_id    integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method      text NOT NULL CHECK (method IN ('cash','card','other','account')),
  amount      integer NOT NULL,
  taken_by    integer NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Cari (veresiye) ödemeleri için 'account' yöntemini mevcut veritabanlarına ekle.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('cash','card','other','account'));

-- Eski ödeme kayıtlarını bozmadan tendered/change bilgisi ekle.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tendered integer;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS change_amount integer;
UPDATE payments SET tendered = amount WHERE tendered IS NULL;
UPDATE payments SET change_amount = 0 WHERE change_amount IS NULL;
ALTER TABLE payments ALTER COLUMN tendered SET DEFAULT 0;
ALTER TABLE payments ALTER COLUMN change_amount SET DEFAULT 0;
ALTER TABLE payments ALTER COLUMN tendered SET NOT NULL;
ALTER TABLE payments ALTER COLUMN change_amount SET NOT NULL;

CREATE TABLE IF NOT EXISTS payment_allocations (
  id          serial PRIMARY KEY,
  payment_id  integer NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  line_id     integer NOT NULL REFERENCES order_lines(id),
  qty         integer NOT NULL CHECK (qty > 0),
  amount      integer NOT NULL CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS payment_allocations_line_idx ON payment_allocations(line_id);
CREATE INDEX IF NOT EXISTS payment_allocations_payment_idx ON payment_allocations(payment_id);

CREATE TABLE IF NOT EXISTS print_jobs (
  id          serial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('receipt','kot')),
  device      text NOT NULL DEFAULT 'receipt' CHECK (device IN ('receipt','kitchen')),
  order_id    integer REFERENCES orders(id) ON DELETE SET NULL,
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','printed','failed')),
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS print_queue_idx ON print_jobs(status) WHERE status = 'queued';

-- ---------- cari (veresiye) hesaplar ----------
CREATE TABLE IF NOT EXISTS customers (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  phone         text,
  note          text,
  credit_limit  integer NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_uniq
  ON customers (phone) WHERE phone IS NOT NULL AND phone <> '';

-- amount: + borç (satış), - alacak (tahsilat). Bakiye = SUM(amount).
CREATE TABLE IF NOT EXISTS customer_ledger (
  id          serial PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id    integer REFERENCES orders(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('sale','payment','adjust')),
  amount      integer NOT NULL,
  method      text,
  note        text,
  created_by  integer REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_ledger_customer_idx ON customer_ledger(customer_id);
CREATE INDEX IF NOT EXISTS customer_ledger_order_idx ON customer_ledger(order_id);

CREATE TABLE IF NOT EXISTS settings (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL
);

-- Yazıcı tanımları: her rol (kasa fişi / mutfak KOT) için tek aktif yazıcı.
CREATE TABLE IF NOT EXISTS printers (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  device      text NOT NULL CHECK (device IN ('receipt','kitchen')),
  transport   text NOT NULL CHECK (transport IN ('network','windows','file')),
  address     text NOT NULL,
  paper_width integer NOT NULL DEFAULT 80 CHECK (paper_width IN (58,80)),
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS printers_device_idx ON printers(device) WHERE enabled = true;

ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS printer_name text;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_kind_check;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_kind_check
  CHECK (kind IN ('receipt','kot','cancel'));
ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_status_check;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_status_check
  CHECK (status IN ('queued','printing','printed','failed'));
