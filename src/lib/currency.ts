/**
 * Hiding amounts.
 *
 * A shop screen gets looked at — by a customer at the counter, someone across
 * a cafe, a friend being shown round. The toggle blanks every figure at the
 * formatter rather than at each of the hundreds of places that print one, so
 * nothing can be missed by forgetting to mask it.
 *
 * A module flag rather than React state because `peso` is a plain function
 * called from everywhere. The provider in PrivacyContext owns the truth, sets
 * this on every render, and re-renders the app when it changes.
 */
let hidden = false;

/** Set by the privacy provider. Not for calling from a component. */
export function setAmountsHidden(value: boolean) {
  hidden = value;
}

export function areAmountsHidden(): boolean {
  return hidden;
}

/** What a hidden figure shows. Fixed width, so a table does not jump about. */
const MASK = "••••";

export function peso(n: number): string {
  if (hidden) return "₱" + MASK;
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
