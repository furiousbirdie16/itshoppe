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

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** One sale line of an item, in stock units. */
export interface DemandSale {
  /** Stable id of the line — what "include this order" remembers. */
  id: string;
  /** Invoice or order number, for showing what was left out. */
  ref: string;
  /** Days ago (0 = today). */
  daysAgo: number;
  units: number;
}

export interface Demand {
  /** Units a day the plan uses. */
  rate: number;
  /** Sales the rate is built from — the history window, less one-off big orders. */
  usedUnits: number;
  /** Days those sales are spread over — days the item existed and had enough stock to sell. */
  usedDays: number;
  /** Days left out because stock was too low to fill a typical order. */
  shortDays: number;
  /** One-off big orders set aside, unless included. */
  leftOut: DemandSale[];
  /** Big orders that would be set aside but were included by hand. */
  included: DemandSale[];
}

/**
 * How fast an item really sells, from its last 90 days of sales.
 *
 * Two things distort a plain average, and both are corrected:
 *
 * - Running short. Days that began with too little stock to fill a typical
 *   order sold little because nothing was there, not because nobody wanted it.
 *   Those days are left out. Stock per day is rebuilt backwards from today's
 *   stock using sales, PO receipts and manual adjustments; if that ever goes
 *   negative the records are incomplete, and no days are left out rather than
 *   guess.
 * - One-off big orders. A single sale at least 8× the item's usual order size
 *   and at least 15% of the period's sales (a project order) would inflate the
 *   rate for months. It is set aside and listed, and can be included by hand.
 *
 * The last 30 days still count most (50 / 30 / 20 across the three months).
 * Days before the item was created are left out, so new items are not diluted.
 */
export function itemDemand(p: {
  sales: DemandSale[];
  stockNow: number;
  /** Stock received from POs, by day. */
  receipts: { daysAgo: number; units: number }[];
  /** Manual stock corrections, signed (+ found, − missing). */
  adjustments: { daysAgo: number; units: number }[];
  createdAt?: string | null;
  today: Date;
  /** Line ids the user has chosen to count even though they look like one-offs. */
  includeIds?: Set<string>;
}): Demand {
  const sales = p.sales.filter((s) => s.daysAgo >= 0 && s.daysAgo <= HISTORY_DAYS && s.units > 0);
  const total = sales.reduce((a, s) => a + s.units, 0);

  // One-off big orders.
  const usual = median(sales.map((s) => s.units)) ?? 0;
  const big = sales.length >= 4 && usual > 0 ? sales.filter((s) => s.units >= usual * 8 && s.units >= total * 0.15) : [];
  const leftOut = big.filter((s) => !p.includeIds?.has(s.id));
  const included = big.filter((s) => p.includeIds?.has(s.id));
  const leftOutIds = new Set(leftOut.map((s) => s.id));

  // Stock change on each day (ago), to walk backwards from today's stock.
  const change = new Map<number, number>();
  const add = (ago: number, v: number) => change.set(ago, (change.get(ago) || 0) + v);
  for (const s of sales) add(s.daysAgo, -s.units);
  for (const r of p.receipts) if (r.daysAgo >= 0) add(r.daysAgo, r.units);
  for (const a of p.adjustments) if (a.daysAgo >= 0) add(a.daysAgo, a.units);

  // startOfDay[k] = stock when day k (days ago) began.
  const startOfDay: number[] = [];
  let level = p.stockNow - (change.get(0) || 0);
  for (let k = 1; k <= HISTORY_DAYS; k++) {
    level -= change.get(k) || 0;
    startOfDay[k] = level;
  }
  const reliable = startOfDay.slice(1).every((v) => v >= -0.01);
  const needed = Math.max(usual, 1e-6);

  const age = p.createdAt ? differenceInCalendarDays(p.today, parseISO(p.createdAt)) : HISTORY_DAYS;
  const windows = [0, 1, 2].map(() => ({ units: 0, days: 0 }));
  let usedUnits = 0;
  let usedDays = 0;
  let shortDays = 0;
  const soldOn = new Map<number, number>();
  for (const s of sales) if (!leftOutIds.has(s.id)) soldOn.set(s.daysAgo, (soldOn.get(s.daysAgo) || 0) + s.units);
  for (let k = 1; k <= HISTORY_DAYS; k++) {
    if (k > age) continue;
    const w = windows[Math.floor((k - 1) / 30)];
    if (reliable && startOfDay[k] < needed) {
      shortDays += 1;
      continue;
    }
    const u = soldOn.get(k) || 0;
    w.units += u;
    w.days += 1;
    usedUnits += u;
    usedDays += 1;
  }

  // Weighted across the three months, skipping a month with under 5 usable days.
  let weighted = 0;
  let weightSum = 0;
  windows.forEach((w, i) => {
    if (w.days < 5) return;
    weighted += (w.units / w.days) * WEIGHTS[i];
    weightSum += WEIGHTS[i];
  });
  const rate = weightSum > 0 ? weighted / weightSum : usedDays > 0 ? usedUnits / usedDays : 0;
  return { rate, usedUnits, usedDays, shortDays, leftOut, included };
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
 * - now: will run short before a new order could arrive (what is on order
 *   included), or below its minimum with nothing on order while still selling.
 * - ordered: low or due soon, but what is on order covers it.
 * - watch: below its minimum but not selling, or due to be ordered within two weeks.
 * - ok: nothing to do.
 */
/**
 * When stock runs out, counting what is on order from the day it arrives.
 *
 * Treating everything on order as already on the shelf is right while the
 * shelf lasts until it lands, and wrong when it does not: an item at 0 with
 * 20 due in 19 days sells nothing in between, so those 20 start being used on
 * day 19, not today. Days spent at 0 waiting for an order already placed are
 * returned too (up to `horizon`), because sales lost then do not need to be
 * bought for.
 */
export function projectStock(
  stock: number,
  rate: number,
  incoming: { qty: number; inDays: number }[],
  horizon: number,
): { runOutDay: number; waitingDays: number } {
  if (!(rate > 0)) return { runOutDay: Infinity, waitingDays: 0 };
  let level = Math.max(0, stock);
  let t = 0;
  let waitingDays = 0;
  const arrivals = [...incoming]
    .filter((a) => a.qty > 0)
    .map((a) => ({ qty: a.qty, inDays: Math.max(0, a.inDays) }))
    .sort((a, b) => a.inDays - b.inDays);
  for (const a of arrivals) {
    const emptyAt = t + level / rate;
    if (emptyAt < a.inDays) {
      // Out before it lands: nothing sells until it does.
      waitingDays += Math.max(0, Math.min(a.inDays, horizon) - Math.min(emptyAt, horizon));
      level = 0;
    } else {
      level -= rate * (a.inDays - t);
    }
    t = a.inDays;
    level += a.qty;
  }
  return { runOutDay: t + level / rate, waitingDays };
}

export function planReorder(p: {
  stock: number;
  onOrder: number;
  rate: number;
  leadDays: number;
  coverDays: number;
  minStock?: number | null;
  moq?: number | null;
  /**
   * What is on order, with days until it arrives (0 if late or undated). When
   * given, it is counted from its arrival; when not, it counts as on hand.
   */
  incoming?: { qty: number; inDays: number }[];
}): ReorderPlan {
  const stock = Math.max(0, p.stock);
  const min = Math.max(0, Number(p.minStock || 0));
  const belowMin = min > 0 && stock <= min;
  const daysLeft = p.rate > 0 ? stock / p.rate : Infinity;
  const projection = p.incoming
    ? projectStock(stock, p.rate, p.incoming, p.leadDays)
    : { runOutDay: p.rate > 0 ? (stock + p.onOrder) / p.rate : Infinity, waitingDays: 0 };
  const orderByDays = p.rate > 0 ? Math.floor(projection.runOutDay - p.leadDays - SAFETY_DAYS) : Infinity;

  // Days at 0 waiting for an order already placed are sales that will not
  // happen, so they are not bought for again.
  const byRate = p.rate > 0
    ? p.rate * (p.leadDays + SAFETY_DAYS + p.coverDays - projection.waitingDays) - stock - p.onOrder
    : 0;
  const byMin = min > 0 ? min - stock - p.onOrder : 0;
  let suggested = Math.ceil(Math.max(byRate, byMin, 0) - 1e-9);
  if (suggested > 0) suggested = Math.max(suggested, Number(p.moq || 0));

  let group: ReorderGroup = "ok";
  const shortBeforeArrival = p.rate > 0 && orderByDays <= 0;
  // Below the minimum with nothing coming: order. With something coming, it is
  // On order — the order-by date says when more will be needed.
  const minUncovered = belowMin && p.onOrder <= 0;
  if ((shortBeforeArrival || (minUncovered && p.rate > 0)) && suggested > 0) group = "now";
  else if (p.onOrder > 0 && (belowMin || (p.rate > 0 && daysLeft <= p.leadDays + SAFETY_DAYS))) group = "ordered";
  else if (belowMin || (p.rate > 0 && orderByDays <= 14)) group = "watch";

  return { group, daysLeft, orderByDays, suggested: group === "ok" ? 0 : suggested, belowMin };
}
