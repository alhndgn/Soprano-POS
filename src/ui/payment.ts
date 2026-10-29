export type PaymentSelectionLine = {
  id: number
  qty: number
  paid_qty: number
  remaining_amount: number
  payment_status: 'unpaid' | 'partial' | 'paid'
}

export type PaymentSelection = Record<number, number>

export function remainingQty(line: PaymentSelectionLine): number {
  return Math.max(0, line.qty - line.paid_qty)
}

export function defaultPaymentSelection(lines: PaymentSelectionLine[]): PaymentSelection {
  return Object.fromEntries(
    lines
      .filter(lineIsPayable)
      .map((line) => [line.id, remainingQty(line)] as const),
  )
}

function lineIsPayable(line: PaymentSelectionLine | undefined): boolean {
  return !!line && line.payment_status !== 'paid' && remainingQty(line) > 0 && line.remaining_amount > 0
}

export function selectedPaymentTotal(lines: PaymentSelectionLine[], selection: PaymentSelection): number {
  return lines.reduce((sum, line) => {
    if (!lineIsPayable(line)) return sum
    const availableQty = remainingQty(line)
    const qty = Math.min(availableQty, Math.max(0, Math.floor(selection[line.id] ?? 0)))
    if (qty <= 0) return sum
    if (qty >= availableQty) return sum + line.remaining_amount
    return sum + Math.floor((line.remaining_amount * qty) / availableQty)
  }, 0)
}
