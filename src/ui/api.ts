// ---------- tipler ----------
export type Role = 'waiter' | 'cashier' | 'manager'
export type Me = { id: number; name: string; role: Role }

export type Variant = { id: number; product_id: number; name: string; price: number }
export type Modifier = { id: number; group_id: number; name: string; price: number }
export type ModGroup = { id: number; name: string; min: number; max: number; modifiers: Modifier[] }
export type GroupInput = {
  name: string
  min: number
  max: number
  modifiers: { id?: number; name: string; price: number }[]
}
export type TableShape = 'square' | 'round' | 'rect'
export type Ingredient = { id: number; name: string; price: number; included: boolean }
export type Product = {
  id: number
  name: string
  vatRate: number
  imageUrl: string | null
  description: string | null
  ingredients: Ingredient[]
  variants: Variant[]
  groups: ModGroup[]
}
export type Category = { id: number; name: string; emoji: string; imageUrl?: string | null; products: Product[] }
export type OpenOrder = {
  id: number
  table_id: number | null
  order_type: 'dine_in' | 'takeaway'
  customer_name: string | null
  customer_phone: string | null
  guest_count: number
  opened_at: string
  total: number
  sent_lines: number
  line_count: number
}
export type Table = {
  id: number
  floor_id: number
  name: string
  seats: number
  shape: TableShape
  x: number
  y: number
  w: number
  h: number
  order: OpenOrder | null
}

export type LayoutTable = {
  id: number
  floor_id: number
  name: string
  seats: number
  shape: TableShape
  x: number
  y: number
  w: number
  h: number
  sort: number
}
export type LayoutFloor = { id: number; name: string; sort: number; tables: LayoutTable[] }
export type Floor = { id: number; name: string; tables: Table[] }
export type Shift = { id: number; opened_at: string; opening_float: number } | null

export type AppVersion = { version: string; commit: string }
export type Prefs = {
  vatIncluded: boolean
  productDetail: boolean
  orderDetail: boolean
  tableDetail: boolean
  tableSections: boolean
  paymentPreselect: boolean
  theme: 'light' | 'dark'
}
export type Bootstrap = {
  me: Me
  version?: AppVersion
  prefs?: Prefs
  outlet: { name?: string; footer?: string; address?: string; phone?: string }
  shift: Shift
  floors: Floor[]
  /** Masaya bağlı olmayan gel al adisyonları */
  takeaway: OpenOrder[]
  menu: Category[]
}

export type LineMod = { id?: number; name: string; price: number }
export type LineIngredient = { name: string; price: number; mode: 'removed' | 'added' }
export type OrderLine = {
  id: number
  order_id: number
  name: string
  qty: number
  unit_price: number
  vat_rate: number
  note: string | null
  status: 'new' | 'sent' | 'preparing' | 'ready' | 'served' | 'void'
  modifiers: LineMod[]
  ingredients: LineIngredient[]
  paid_amount: number
  paid_qty: number
  gross_amount: number
  discount_amount: number
  remaining_amount: number
  payment_status: 'unpaid' | 'partial' | 'paid'
}
export type Discount = { type: 'none' | 'percent' | 'fixed'; value: number; amount: number }
export type PaymentAllocationInput = { lineId: number; qty: number }
export type PaymentInput = {
  method: 'cash' | 'card' | 'other'
  amount: number
  tendered?: number
  allocations: PaymentAllocationInput[]
}
export type PaymentPayload = {
  payments: PaymentInput[]
  discount?: { type: 'none' | 'percent' | 'fixed'; value: number }
  customerName?: string | null
}
export type PaymentResult = {
  ok: boolean
  change: number
  applied: { method: 'cash' | 'card' | 'other'; amount: number }[]
  orderId: number
  status: 'open' | 'paid'
}
export type PrinterTransport = 'network' | 'windows' | 'file'
export type PrinterDevice = 'receipt' | 'kitchen'
export type Printer = {
  id: number
  name: string
  device: PrinterDevice
  transport: PrinterTransport
  address: string
  paper_width: number
  enabled: boolean
  summary: string
  chars: number
}
export type PrinterInput = {
  name: string
  device: PrinterDevice
  transport: PrinterTransport
  address: string
  paperWidth: number
  enabled: boolean
}
export type PrintJob = {
  id: number
  kind: 'receipt' | 'kot' | 'cancel'
  device: PrinterDevice
  status: 'queued' | 'printing' | 'printed' | 'failed'
  error: string | null
  printer_name: string | null
  attempts: number
  created_at: string
}
export type BridgeStatus = { host: string | null; platform: string | null; at: string } | null
export type DetectedPrinter = { name: string; driver: string; port: string; status: string }
export type LanPrinter = { ip: string; port: number }
export type Totals = { subtotal: number; vat: number; total: number; vatLines: { rate: number; net: number; vat: number; gross: number }[] }
export type Order = {
  id: number
  table_id: number | null
  table_name: string | null
  staff_name: string
  status: 'open' | 'paid' | 'void'
  guest_count: number
  note: string | null
  opened_at: string
  closed_at: string | null
  order_type: 'dine_in' | 'takeaway'
  customer_name: string | null
  customer_phone: string | null
  discount: Discount
  lines: OrderLine[]
  payments: { id: number; method: string; amount: number; tendered: number; change_amount: number }[]
  totals: Totals
  paid: number
  remaining: number
}

export type KdsLine = {
  id: number
  order_id: number
  name: string
  qty: number
  note: string | null
  status: 'sent' | 'preparing' | 'ready'
  sent_at: string
  table_name: string | null
  modifiers: { name: string }[]
}

export type AdminProduct = {
  id: number
  name: string
  categoryId: number
  vatRate: number
  description: string | null
  imageUrl: string | null
  sizes: { id: number; name: string; price: number }[]
  ingredients: Ingredient[]
  groupIds: number[]
}

export type ProductInput = {
  name: string
  categoryId: number
  vatRate: number
  description: string | null
  imageUrl: string | null
  sizes: { id?: number; name: string; price: number }[]
  ingredients: { id?: number; name: string; price: number; included: boolean }[]
  groupIds: number[]
}

// ---------- istemci ----------
const TOKEN_KEY = 'soprano_token'

export const auth = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = auth.get()
  const res = await fetch(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) {
    if (res.status === 401 && !path.includes('/auth/pin')) auth.clear()
    throw new ApiError(data.error ?? `Hata ${res.status}`, res.status)
  }
  return data as T
}

export const api = {
  login: (pin: string) => request<{ user: Me; token: string }>('POST', '/api/auth/pin', { pin }),
  logout: () => request('POST', '/api/auth/logout', {}),
  bootstrap: () => request<Bootstrap>('GET', '/api/bootstrap'),
  version: () => request<AppVersion>('GET', '/api/version'),
  openShift: (openingFloat = 0) => request('POST', '/api/shift/open', { openingFloat }),
  closeShift: (closingCount: number) => request('POST', '/api/shift/close', { closingCount }),
  createOrder: (tableId: number, guestCount = 1) => request<{ id: number }>('POST', '/api/orders', { tableId, guestCount }),
  createTakeaway: (body: { customerName?: string; customerPhone?: string; note?: string }) =>
    request<{ id: number }>('POST', '/api/orders', { ...body, orderType: 'takeaway' }),
  order: (id: number) => request<Order>('GET', `/api/orders/${id}`),
  addLine: (
    orderId: number,
    body: {
      productId: number
      variantId: number | null
      qty: number
      modifierIds: number[]
      ingredients?: { id: number; mode: 'removed' | 'added' }[]
      note?: string
    },
  ) => request<Order>('POST', `/api/orders/${orderId}/lines`, body),
  patchLine: (lineId: number, body: { qty?: number; note?: string | null; void?: boolean }) =>
    request<Order>('PATCH', `/api/orders/lines/${lineId}`, body),
  send: (orderId: number) => request<Order>('POST', `/api/orders/${orderId}/send`, {}),
  voidOrder: (orderId: number, reason = 'Adisyon iptali') =>
    request<{ ok: boolean; orderId: number }>('POST', `/api/orders/${orderId}/void`, { reason }),
  move: (orderId: number, tableId: number) => request<Order>('POST', `/api/orders/${orderId}/move`, { tableId }),
  pay: (orderId: number, body: PaymentPayload | { method: 'cash' | 'card' | 'other'; amount: number }[]) => {
    const payload: PaymentPayload = Array.isArray(body)
      ? { payments: body.map((payment) => ({ ...payment, allocations: [] })) }
      : body
    return request<PaymentResult>('POST', `/api/orders/${orderId}/pay`, payload)
  },
  kds: () => request<{ lines: KdsLine[] }>('GET', '/api/kds'),
  kdsStatus: (lineId: number, status: 'preparing' | 'ready' | 'served') =>
    request('POST', `/api/kds/lines/${lineId}/status`, { status }),
  report: (date?: string) =>
    request<{
      day: string
      revenue: number
      orders: number
      byMethod: { method: string; amount: number; count: number }[]
      discountTotal: number
      byType: { order_type: 'dine_in' | 'takeaway'; orders: number; revenue: number }[]
      paidOrders: {
        order_id: number
        order_type: 'dine_in' | 'takeaway'
        table_name: string | null
        customer_name: string | null
        discount_amount: number
        total: number
        payment_methods: string
        closed_at: string
      }[]
      voidedOrders: {
        order_id: number
        table_name: string | null
        customer_name: string | null
        discount_amount: number
        gross_total: number
        total: number
        reason: string
        voided_by: string | null
        voided_at: string
      }[]
      topProducts: { name: string; qty: number; revenue: number }[]
      hourly: { hour: number; amount: number }[]
    }>('GET', `/api/reports/daily${date ? `?date=${date}` : ''}`),
  adminMenu: () =>
    request<
      {
        id: number
        name: string
        vat_rate: number
        image_url: string | null
        active: boolean
        category: string
        category_id: number
        variants: Variant[]
      }[]
    >('GET', '/api/admin/menu'),
  staff: () => request<{ id: number; name: string; role: Role; active: boolean }[]>('GET', '/api/admin/staff'),
  addStaff: (body: { name: string; role: Role; pin: string }) =>
    request('POST', '/api/admin/staff', body),

  // ürün yönetimi
  modifierGroups: () => request<ModGroup[]>('GET', '/api/admin/modifier-groups'),
  createModifierGroup: (body: GroupInput) => request<{ id: number }>('POST', '/api/admin/modifier-groups', body),
  updateModifierGroup: (id: number, body: GroupInput) =>
    request<{ ok: boolean }>('PUT', `/api/admin/modifier-groups/${id}`, body),
  deleteModifierGroup: (id: number) => request<{ ok: boolean }>('DELETE', `/api/admin/modifier-groups/${id}`),
  product: (id: number) => request<AdminProduct>('GET', `/api/admin/products/${id}`),
  createProduct: (body: ProductInput) => request<{ id: number }>('POST', '/api/admin/products', body),
  updateProduct: (id: number, body: ProductInput) => request<{ ok: boolean }>('PUT', `/api/admin/products/${id}`, body),
  deleteProduct: (id: number) => request<{ ok: boolean }>('DELETE', `/api/admin/products/${id}`),
  setProductActive: (id: number, active: boolean) =>
    request<{ ok: boolean; id: number; name: string; active: boolean }>('PATCH', `/api/admin/products/${id}/active`, { active }),
  addCategory: (name: string, emoji?: string) =>
    request<{ id: number; name: string }>('POST', '/api/admin/categories', { name, emoji }),

  // masa düzeni
  layout: () => request<LayoutFloor[]>('GET', '/api/admin/layout'),
  addFloor: (name: string) => request<{ id: number; name: string }>('POST', '/api/admin/floors', { name }),
  renameFloor: (id: number, name: string) => request('PATCH', `/api/admin/floors/${id}`, { name }),
  deleteFloor: (id: number) => request('DELETE', `/api/admin/floors/${id}`),
  addTable: (body: { floorId: number; name?: string; seats?: number; shape?: TableShape; x?: number; y?: number }) =>
    request<LayoutTable>('POST', '/api/admin/tables', body),
  patchTable: (id: number, body: { name?: string; seats?: number; shape?: TableShape; floorId?: number }) =>
    request<LayoutTable>('PATCH', `/api/admin/tables/${id}`, body),
  deleteTable: (id: number) => request('DELETE', `/api/admin/tables/${id}`),
  saveLayout: (floorId: number, tables: { id: number; x: number; y: number; w: number; h: number; shape?: TableShape }[]) =>
    request<{ ok: boolean; saved: number }>('PUT', '/api/admin/layout', { floorId, tables }),

  // ürün görseli
  uploadImage: async (productId: number, file: File) => {
    const token = auth.get()
    const body = new FormData()
    body.append('file', file)
    const res = await fetch(`/api/admin/products/${productId}/image`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      body,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new ApiError(data.error ?? 'Görsel yüklenemedi', res.status)
    return data as { ok: boolean; imageUrl: string }
  },
  deleteImage: (productId: number) => request('DELETE', `/api/admin/products/${productId}/image`),

  // ayarlar
  settings: () => request<{ prefs: Prefs }>('GET', '/api/admin/settings'),
  saveSettings: (patch: Partial<Prefs>) => request<{ prefs: Prefs }>('PUT', '/api/admin/settings', patch),
  uploadCategoryImage: async (categoryId: number, file: File) => {
    const token = auth.get()
    const body = new FormData()
    body.append('file', file)
    const res = await fetch(`/api/admin/categories/${categoryId}/image`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      body,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new ApiError(data.error ?? 'Görsel yüklenemedi', res.status)
    return data as { ok: boolean; imageUrl: string }
  },
  deleteCategoryImage: (categoryId: number) => request<{ ok: boolean }>('DELETE', `/api/admin/categories/${categoryId}/image`),

  // rapor: tarih aralığı
  reportRange: (from: string, to: string) =>
    request<{
      from: string
      to: string
      days: number
      revenue: number
      orders: number
      discountTotal: number
      avgPerDay: number
      avgTicket: number
      byMethod: { method: string; amount: number; count: number }[]
      byType: { order_type: 'dine_in' | 'takeaway'; orders: number; revenue: number }[]
      byCategory: { id: number; name: string; qty: number; revenue: number }[]
      topProducts: { name: string; qty: number; revenue: number }[]
      paidOrders: {
        order_id: number
        order_type: 'dine_in' | 'takeaway'
        table_name: string | null
        customer_name: string | null
        discount_amount: number
        total: number
        payment_methods: string
        closed_at: string
      }[]
      voidedOrders: {
        order_id: number
        order_type: 'dine_in' | 'takeaway'
        table_name: string | null
        customer_name: string | null
        discount_amount: number
        gross_total: number
        total: number
        reason: string
        voided_by: string | null
        voided_at: string | null
      }[]
    }>('GET', `/api/reports/range?from=${from}&to=${to}`),

  // yazıcılar
  printers: () =>
    request<{ printers: Printer[]; bridge: BridgeStatus; jobs: PrintJob[] }>('GET', '/api/admin/printers'),
  createPrinter: (body: PrinterInput) => request<{ printer: Printer }>('POST', '/api/admin/printers', body),
  updatePrinter: (id: number, body: Partial<PrinterInput>) =>
    request<{ printer: Printer }>('PATCH', `/api/admin/printers/${id}`, body),
  deletePrinter: (id: number) => request<{ ok: boolean }>('DELETE', `/api/admin/printers/${id}`),
  testPrinter: (id: number) => request<{ job: { id: number }; printer: Printer }>('POST', `/api/admin/printers/${id}/test`, {}),
  detectPrinters: (mode: 'windows' | 'network' = 'windows') =>
    request<{ mode: string; available?: boolean; reason?: string; via?: string; printers?: DetectedPrinter[]; candidates?: LanPrinter[] }>(
      'GET',
      `/api/admin/printers/detect?mode=${mode}`,
    ),
  retryPrintJob: (id: number) => request<{ ok: boolean }>('POST', `/api/admin/print/jobs/${id}/retry`, {}),
}

// ---------- biçimlendirme ----------
const tryFmt = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function money(kurus: number): string {
  return `${tryFmt.format(kurus / 100)} ₺`
}

export function elapsed(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return `${mins} dk`
  return `${Math.floor(mins / 60)} sa ${mins % 60} dk`
}

export function lineTotal(l: OrderLine): number {
  const mods = l.modifiers.reduce((s, m) => s + m.price, 0)
  const ings = (l.ingredients ?? []).filter((i) => i.mode === 'added').reduce((s, i) => s + i.price, 0)
  return (l.unit_price + mods + ings) * l.qty
}
