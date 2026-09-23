/**
 * Reading an item's stock history as a balance per location.
 *
 * Every movement records the balance it saw, but not of the same thing: a sale
 * records the store's, a warehouse-to-store transfer records the warehouse's as
 * its source and the store's as its destination. Shown in one "balance" column
 * those look like a single number jumping about for no reason.
 *
 * Walking oldest to newest and keeping warehouse and store apart fixes that,
 * and gives something the old backwards-from-today calculation could not: where
 * a row says the stock was already different from what the movement before it
 * left, something changed it without being recorded. That gap is what a
 * physical count disagreeing with the system is made of.
 */

export type StockLocation = "warehouse" | "store";

export interface MovementSnapshot {
  branch_id: string | null;
  location: string | null;
  dest_location: string | null;
  balance_before: number | null;
  balance_after: number | null;
  dest_balance_before: number | null;
  dest_balance_after: number | null;
  /** Net effect on the source location: positive in, negative out. */
  signed: number;
}

export interface WalkedBalances {
  wh_before: number | null;
  st_before: number | null;
  wh_after: number | null;
  st_after: number | null;
  total_before: number | null;
  total_after: number | null;
  /** Stock that changed with no movement to account for it. */
  discrepancy: number;
}

const asLocation = (v: string | null): StockLocation | null =>
  v === "warehouse" || v === "store" ? v : null;

/** Walks movements oldest-first. Returns one entry per input row, in order. */
export function walkBalances(movements: MovementSnapshot[]): WalkedBalances[] {
  type LocState = { warehouse: number | null; store: number | null };
  const byBranch = new Map<string, LocState>();
  const out: WalkedBalances[] = [];

  for (const m of movements) {
    const key = m.branch_id || "—";
    const state: LocState = byBranch.get(key) || { warehouse: null, store: null };

    const src = asLocation(m.location);
    const dst = asLocation(m.dest_location);

    // A gap can only be claimed where a carried balance and a stated one both
    // exist — the first movement at a location states one and carries none.
    let discrepancy = 0;
    if (src && m.balance_before != null && state[src] != null && state[src] !== m.balance_before) {
      discrepancy += m.balance_before - (state[src] as number);
    }
    if (dst && m.dest_balance_before != null && state[dst] != null && state[dst] !== m.dest_balance_before) {
      discrepancy += m.dest_balance_before - (state[dst] as number);
    }

    // A location seen for the first time takes its opening figure from what
    // this movement says it was, so the totals are usable from the first row
    // rather than blank until both sides happen to have been touched.
    if (src && state[src] == null && m.balance_before != null) state[src] = m.balance_before;
    if (dst && state[dst] == null && m.dest_balance_before != null) state[dst] = m.dest_balance_before;

    const whBefore = state.warehouse;
    const stBefore = state.store;


    // A recorded snapshot beats anything carried forward. Rows written before
    // the snapshots existed fall back to applying the movement's own delta.
    if (src) {
      if (m.balance_after != null) state[src] = m.balance_after;
      else if (state[src] != null) state[src] = (state[src] as number) + m.signed;
    }
    if (dst && m.dest_balance_after != null) state[dst] = m.dest_balance_after;

    byBranch.set(key, state);

    out.push({
      wh_before: whBefore,
      st_before: stBefore,
      wh_after: state.warehouse,
      st_after: state.store,
      total_before: whBefore != null && stBefore != null ? whBefore + stBefore : null,
      total_after: state.warehouse != null && state.store != null ? state.warehouse + state.store : null,
      discrepancy,
    });
  }

  return out;
}
