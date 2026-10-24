// The one reorder calculation, shared by the Reorder List page and the
// Business Insights Forecast tab so both give the same answer to "how many,
// and by when?".
import { differenceInCalendarDays, parseISO } from "date-fns";

/** Used when a supplier link has no lead time and there is no delivery history. */
export const DEFAULT_LEAD_DAYS = 30;
/** Extra days of stock kept on top of the lead time, for late deliveries and sales spikes. */
export const SAFETY_DAYS = 7;
/** Days of sales the rate is worked out from. */
export const HISTORY_DAYS = 90;
// Weights for the last 30 days, the 30 before, and the 30 before that. Recent
// weeks count most so a product picking up (or dying off) shows quickly.
const WEIGHTS = [0.5, 0.3, 0.2];

/**
 * Stock units a sale uses. A plain sale is 1:1. A pack variation (a 10-pack)
 * uses `factor` units; a cut variation (3 m off a 305 m roll) uses
 * factor / units_per_stock of a unit — the same rules stock deduction follows.
 */
export function stockUnitsSold(
  qty: number,
  variation: { type?: string | null; factor?: number | null } | null | undefined,
  unitsPerStock?: number | null,
) {
  if (!variation) return qty;
  const base = Number(variation.factor || 1) * qty;
  return variation.type === "cut" ? base / Math.max(1, Number(unitsPerStock || 1)) : base;
}

/** Weighted daily rate from per-day amounts keyed by days ago (1 = yesterday). */
export function weightedDailyRate(byDaysAgo: Map<number, number>) {
  const windows = [0, 0, 0];
  for (const [ago, v] of byDaysAgo) {
    if (ago < 1 || ago > HISTORY_DAYS) continue;
    windows[Math.min(2, Math.floor((ago - 1) / 30))] += v;
  }
  return windows.reduce((s, w, i) => s + (w / 30) * WEIGHTS[i], 0);
}

/**
 * An item's daily sales rate. One newer than the history window is averaged
 * over its own life (at least a week), so days it did not exist do not dilute it.
 */
export function itemDailyRate(byDaysAgo: Map<number, number>, createdAt: string | null | undefined, today: Date) {
  const age = createdAt ? differenceInCalendarDays(today, parseISO(createdAt)) : HISTORY_DAYS;
  if (age >= HISTORY_DAYS) return weightedDailyRate(byDaysAgo);
  let total = 0;
  for (const [ago, v] of byDaysAgo) if (ago >= 1 && ago <= HISTORY_DAYS) total += v;
  return total / Math.max(7, age);
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** What past deliveries say about a supplier. Medians, so one disaster does not skew it. */
export interface SupplierLeadStats {
  /** Order → received, in days. */
  days: number;
  /** Deliveries it is based on. */
  deliveries: number;
  /** Overseas only: order → shipped. Null when ship dates were not recorded. */
  productionDays: number | null;
  /** Overseas only: shipped → received. */
  transitDays: number | null;
  /** Share received by the expected date, when one was set. */
  onTimePct: number | null;
}

export interface LeadTime {
  /** The figure the plan uses. */
  days: number;
  source: "set" | "history" | "default";
  /** The typed figure from the supplier link, if any. */
  setDays: number | null;
  learned: SupplierLeadStats | null;
  /**
   * Past deliveries took noticeably longer or shorter than the typed figure —
   * a prompt to update it. Needs at least two deliveries to say so.
   */
  mismatch: boolean;
}

/** The typed lead time wins; otherwise what past deliveries show; otherwise the default. */
export function resolveLeadTime(setDays: number | null | undefined, learned: SupplierLeadStats | null | undefined): LeadTime {
  const typed = setDays != null && setDays > 0 ? setDays : null;
  const l = learned ?? null;
  const mismatch = typed != null && !!l && l.deliveries >= 2 && Math.abs(l.days - typed) >= Math.max(7, typed * 0.3);
  if (typed != null) return { days: typed, source: "set", setDays: typed, learned: l, mismatch };
  if (l) return { days: Math.round(l.days), source: "history", setDays: null, learned: l, mismatch: false };
  return { days: DEFAULT_LEAD_DAYS, source: "default", setDays: null, learned: null, mismatch: false };
}

export type ReorderGroup = "now" | "ordered" | "watch" | "ok";

export interface ReorderPlan {
  group: ReorderGroup;
  /** Days the stock on hand lasts at the current rate. Infinity when nothing sells. */
  daysLeft: number;
  /** Days from today until an order must be placed to arrive in time (≤ 0 = now). Infinity when nothing sells. */
  orderByDays: number;
  /** Units to order, rounded up and lifted to the minimum order quantity. 0 when none needed. */
  suggested: number;
  belowMin: boolean;
}

/**
 * How much to order and when. An order placed today arrives after `leadDays`;
 * it should then cover `coverDays` more of sales plus a safety buffer, less
 * what is on hand and already on order. A minimum stock level set on the item
 * is always respected.
 *
 * Groups:
 * - now: will run short before a new order could arrive, or below its minimum
 *   with nothing on order while still selling.
 * - ordered: low or due soon, but what is on order covers it.
 * - watch: below its minimum but not selling, or due to be ordered within two weeks.
 * - ok: nothing to do.
 */
export function planReorder(p: {
  stock: number;
  onOrder: number;
  rate: number;
  leadDays: number;
  coverDays: number;
  minStock?: number | null;
  moq?: number | null;
}): ReorderPlan {
  const stock = Math.max(0, p.stock);
  const min = Math.max(0, Number(p.minStock || 0));
  const belowMin = min > 0 && stock <= min;
  const daysLeft = p.rate > 0 ? stock / p.rate : Infinity;
  const orderByDays = p.rate > 0 ? Math.floor((stock + p.onOrder) / p.rate - p.leadDays - SAFETY_DAYS) : Infinity;

  const byRate = p.rate > 0 ? p.rate * (p.leadDays + SAFETY_DAYS + p.coverDays) - stock - p.onOrder : 0;
  const byMin = min > 0 ? min - stock - p.onOrder : 0;
  let suggested = Math.ceil(Math.max(byRate, byMin, 0) - 1e-9);
  if (suggested > 0) suggested = Math.max(suggested, Number(p.moq || 0));

  let group: ReorderGroup = "ok";
  const shortBeforeArrival = p.rate > 0 && orderByDays <= 0;
  const minUncovered = belowMin && stock + p.onOrder <= min;
  if ((shortBeforeArrival || (minUncovered && p.rate > 0)) && suggested > 0) group = "now";
  else if (p.onOrder > 0 && (belowMin || (p.rate > 0 && daysLeft <= p.leadDays + SAFETY_DAYS))) group = "ordered";
  else if (belowMin || (p.rate > 0 && orderByDays <= 14)) group = "watch";

  return { group, daysLeft, orderByDays, suggested: group === "ok" ? 0 : suggested, belowMin };
}
