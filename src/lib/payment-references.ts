/**
 * The screenshots attached to a payment.
 *
 * Stored newline-separated in one column, so a row holding a single URL —
 * every invoice settled before more than one was allowed — still reads back as
 * a one-image list.
 */
export const paymentReferenceUrls = (value?: string | null): string[] =>
  (value || "").split("\n").map((u) => u.trim()).filter(Boolean);
