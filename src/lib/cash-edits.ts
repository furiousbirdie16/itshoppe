import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/paginate";

/** One edit to a cash or bank line: which fields changed, from what to what. */
export interface CashEdit {
  id: string;
  transaction_id: string;
  edited_at: string;
  edited_by_email: string | null;
  changes: Record<string, { from: unknown; to: unknown }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * Every edit the user can see, newest first per line. Fetched whole rather
 * than by line: edits are few, and a ledger can hold thousands of lines.
 */
export async function getCashEdits(): Promise<Map<string, CashEdit[]>> {
  const out = new Map<string, CashEdit[]>();
  try {
    const rows = await fetchAllRows<CashEdit>(() =>
      db.from("cash_transaction_edits")
        .select("id, transaction_id, edited_at, edited_by_email, changes")
        .order("edited_at", { ascending: false })
        .order("id"),
    );
    for (const e of rows) out.set(e.transaction_id, [...(out.get(e.transaction_id) || []), e]);
  } catch {
    // Not there yet (the migration has not been run): no edits to show.
  }
  return out;
}

/**
 * What the amount was before it was changed, for showing it struck through:
 * the figure before the most recent amount change. Null if never changed.
 */
export function previousAmount(edits: CashEdit[] | undefined): number | null {
  const e = (edits || []).find((x) => x.changes?.amount);
  return e ? Number(e.changes.amount.from) : null;
}

const LABELS: Record<string, string> = {
  amount: "Amount",
  direction: "In / out",
  account_id: "Account",
  txn_date: "Date",
  category: "Category",
  payee: "Payee",
  reference: "Reference",
  notes: "Notes",
  fx_rate: "Rate",
};

/** One line per changed field, e.g. "Amount: 100 → 90". */
export function describeEdit(
  edit: CashEdit,
  fmt: { amount: (n: number) => string; account: (id: string) => string },
): string[] {
  return Object.entries(edit.changes || {}).map(([field, { from, to }]) => {
    const show = (v: unknown) => {
      if (v === null || v === undefined || v === "") return "—";
      if (field === "amount") return fmt.amount(Number(v));
      if (field === "account_id") return fmt.account(String(v));
      return String(v);
    };
    return `${LABELS[field] || field}: ${show(from)} → ${show(to)}`;
  });
}
