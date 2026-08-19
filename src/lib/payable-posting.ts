/** The fields that decide whether a payable moves money. */
export interface PostablePayable {
  status: string;
  cash_account_id?: string | null;
  amount: number | string;
  amount_paid?: number | string | null;
}

export interface PayablePosting {
  /** Whether a withdrawal should exist for this payable right now. */
  shouldPost: boolean;
  accountId: string | null;
  /** What the withdrawal is for; 0 when nothing should be posted. */
  amount: number;
}

/**
 * Whether a payable has money out against it, and how much.
 *
 * Keyed on `paid` alone: `cleared` is about the check reaching the bank, and
 * treating both as settlement would deduct the same money twice.
 *
 * The posting is the payable's full amount, never `amount - amount_paid`.
 * Marking a payable Paid sets amount_paid to the full amount, so the
 * outstanding balance is zero by then and an outstanding-based posting is for
 * nothing — which is exactly what went wrong. Partial payments are not posted;
 * only settling is.
 */
export function payablePosting(p: PostablePayable): PayablePosting {
  const accountId = p.cash_account_id || null;
  const shouldPost = p.status === "paid" && !!accountId;
  return {
    shouldPost,
    accountId,
    amount: shouldPost ? Number(p.amount) : 0,
  };
}
