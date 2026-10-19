/**
 * How a document number is shown.
 *
 * The numbering prefixes were set up as "INV-", "OPO-" and so on, and the
 * generator adds its own dash, so every stored number reads INV--01191. The
 * stored numbers are left alone — they are what old printouts, bank lines and
 * references were written with — and only the display collapses the dash.
 * Searches match both spellings.
 */
export function docNo(value: string | null | undefined): string {
  if (!value) return value ?? "";
  return value.replace(/-{2,}/g, "-");
}
