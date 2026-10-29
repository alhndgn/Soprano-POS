export function reportCustomerName(name: string | null | undefined): string {
  return name?.trim() || '—'
}

export function reportPaymentLabel(methods: string | null | undefined): string {
  if (!methods?.trim()) return '—'
  return methods
    .split(',')
    .map((method) => method.trim())
    .filter(Boolean)
    .map((method) => (method === 'cash' ? 'Nakit' : method === 'card' ? 'Kart' : 'Diğer'))
    .join(' · ')
}
