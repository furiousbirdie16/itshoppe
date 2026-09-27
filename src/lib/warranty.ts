import { addMonths, differenceInCalendarDays } from "date-fns";

export type WarrantyState = "covered" | "expired" | "not_started" | "none";

export interface WarrantyStatus {
  state: WarrantyState;
  startsAt: Date | null;
  expiresAt: Date | null;
  /** Negative once expired; null when there is nothing to count toward. */
  daysLeft: number | null;
}

/**
 * Whether a sold unit is still covered.
 *
 * The clock starts at collection, not payment: a customer who pays on the 1st
 * and collects on the 10th is covered from the 10th. An invoice that never gets
 * marked shipped therefore has no start date at all — reported as `not_started`
 * rather than guessed at, because guessing would quietly hand out days of cover
 * nobody agreed to.
 */
export function warrantyStatus(
  unit: { warranty_starts_at?: string | null; warranty_months?: number | null },
  now: Date = new Date(),
): WarrantyStatus {
  const months = Number(unit.warranty_months || 0);
  if (!unit.warranty_starts_at) {
    return { state: months > 0 ? "not_started" : "none", startsAt: null, expiresAt: null, daysLeft: null };
  }
  const startsAt = new Date(unit.warranty_starts_at);
  if (Number.isNaN(startsAt.getTime())) {
    return { state: "none", startsAt: null, expiresAt: null, daysLeft: null };
  }
  if (months <= 0) {
    return { state: "none", startsAt, expiresAt: null, daysLeft: null };
  }
  const expiresAt = addMonths(startsAt, months);
  const daysLeft = differenceInCalendarDays(expiresAt, now);
  return { state: daysLeft >= 0 ? "covered" : "expired", startsAt, expiresAt, daysLeft };
}
