/**
 * The gap between what an invoice asked for and what actually arrived.
 *
 * One definition, used by the list, the invoice itself and anything else that
 * needs to say "₱200 over": if they disagreed about what counts as a
 * difference, the list would flag invoices whose detail showed nothing wrong.
 */

/** Below half a centavo is rounding in a currency column, not a discrepancy. */
const TOLERANCE = 0.005;

/**
 * Returns the signed difference — positive for money over, negative for short —
 * or null when there is nothing to report, either because no separate amount
 * was recorded or because it matches the invoice.
 */
export function paymentVariance(
  total: number | null | undefined,
  received: number | null | undefined,
): number | null {
  if (received == null) return null;
  const diff = Number(received) - Number(total || 0);
  return Math.abs(diff) <= TOLERANCE ? null : diff;
}
