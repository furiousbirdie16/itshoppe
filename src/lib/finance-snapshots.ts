import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/paginate";
import { docNo } from "@/lib/doc-number";
import { peso } from "@/lib/currency";
import { foreignAmount } from "@/lib/fx";
import type { FinanceSnapshot, LineKey } from "@/lib/finance-compare";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const n = (v: unknown) => Number(v || 0);

/**
 * Every saved day, oldest first. Exact records from finance_snapshots; days
 * before those fall back to the chart's asset_snapshots, marked approximate
 * because they did not keep bills due within 30 days or the owner's full
 * balance, and valued stock at one company cost.
 */
export async function getFinanceSnapshots(): Promise<FinanceSnapshot[]> {
  const [exact, older] = await Promise.all([
    fetchAllRows<any>(() => db.from("finance_snapshots").select("*").order("snapshot_date")).catch(() => []),
    fetchAllRows<any>(() =>
      db.from("asset_snapshots")
        .select("snapshot_date, captured_at, inventory_value, reserved_stock_value, receivables_value, incoming_assets_value, cash_value, accounts_payable_value, bills_payable_value, owner_due_value, loans_outstanding_value, net_asset_value")
        .order("snapshot_date"),
    ).catch(() => []),
  ]);
  const exactDates = new Set(exact.map((r: any) => r.snapshot_date));
  const out: FinanceSnapshot[] = [
    ...older
      // Rows from before the net figure existed hold zeros throughout.
      .filter((r: any) => !exactDates.has(r.snapshot_date) && n(r.net_asset_value) !== 0)
      .map((r: any): FinanceSnapshot => ({
        date: r.snapshot_date,
        capturedAt: r.captured_at,
        approximate: true,
        inventory: n(r.inventory_value),
        reserved: n(r.reserved_stock_value),
        receivables: n(r.receivables_value),
        incoming: n(r.incoming_assets_value),
        cash: n(r.cash_value),
        supplierPos: n(r.accounts_payable_value),
        billsOwedNow: n(r.bills_payable_value),
        billsDueSoon: n(r.bills_payable_value),
        dueToOwner: n(r.owner_due_value),
        loans: n(r.loans_outstanding_value),
      })),
    ...exact.map((r: any): FinanceSnapshot => ({
      date: r.snapshot_date,
      capturedAt: r.captured_at,
      approximate: false,
      inventory: n(r.inventory),
      reserved: n(r.reserved),
      receivables: n(r.receivables),
      incoming: n(r.incoming),
      cash: n(r.cash),
      supplierPos: n(r.supplier_pos),
      billsOwedNow: n(r.bills_owed_now),
      billsDueSoon: n(r.bills_due_soon),
      dueToOwner: n(r.due_to_owner),
      loans: n(r.loans),
    })),
  ];
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface ChangeRecord {
  id: string;
  when: string;
  title: string;
  detail: string;
  amount: string;
}

const LIMIT = 200;
const stamp = (iso: string) => format(new Date(iso), "MMM d, h:mm a");

async function cashRecords(since: string, owner: boolean): Promise<ChangeRecord[]> {
  const { data, error } = await db
    .from("cash_transactions")
    .select("id, created_at, direction, amount, category, payee, notes, cash_accounts!inner(name, currency, account_type)")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  const money = (v: number, cur: string) => (cur && cur !== "PHP" ? foreignAmount(v, cur) : peso(v));
  const rows: ChangeRecord[] = (data || [])
    .filter((t: any) => (t.cash_accounts?.account_type === "owner") === owner)
    .map((t: any) => ({
      id: `txn-${t.id}`,
      when: t.created_at,
      title: t.payee || t.category || t.notes || "Transaction",
      detail: [t.cash_accounts?.name, t.category].filter(Boolean).join(" · "),
      amount: `${t.direction === "in" ? "+" : "−"}${money(n(t.amount), t.cash_accounts?.currency)}`,
    }));

  // Edits move the balance too, on lines entered before the date compared with.
  const { data: edits } = await db
    .from("cash_transaction_edits")
    .select("id, edited_at, changes, cash_transactions!inner(payee, category, cash_accounts!inner(name, currency, account_type))")
    .gte("edited_at", since)
    .limit(LIMIT);
  for (const e of edits || []) {
    const t = e.cash_transactions;
    if (!e.changes?.amount || (t?.cash_accounts?.account_type === "owner") !== owner) continue;
    const cur = t.cash_accounts?.currency;
    rows.push({
      id: `edit-${e.id}`,
      when: e.edited_at,
      title: `Edited: ${t.payee || t.category || "line"}`,
      detail: t.cash_accounts?.name || "",
      amount: `${money(n(e.changes.amount.from), cur)} → ${money(n(e.changes.amount.to), cur)}`,
    });
  }
  return rows;
}

async function poRecords(since: string): Promise<ChangeRecord[]> {
  const [local, overseas, deposits] = await Promise.all([
    db.from("purchase_orders").select("id, updated_at, po_number, status, total_amount, suppliers(name)").gte("updated_at", since).order("updated_at", { ascending: false }).limit(LIMIT),
    db.from("overseas_purchase_orders").select("id, updated_at, po_number, status, total_amount, currency, exchange_rate, overseas_suppliers(name)").gte("updated_at", since).order("updated_at", { ascending: false }).limit(LIMIT),
    db.from("overseas_po_payments").select("id, created_at, php_amount, overseas_purchase_orders(po_number)").gte("created_at", since).limit(LIMIT),
  ]);
  const label = (s: string) => String(s || "").replace(/_/g, " ");
  return [
    ...(local.data || []).map((p: any) => ({
      id: `po-${p.id}`, when: p.updated_at, title: docNo(p.po_number),
      detail: [p.suppliers?.name, label(p.status)].filter(Boolean).join(" · "), amount: peso(n(p.total_amount)),
    })),
    ...(overseas.data || []).map((p: any) => ({
      id: `opo-${p.id}`, when: p.updated_at, title: docNo(p.po_number),
      detail: [p.overseas_suppliers?.name, label(p.status)].filter(Boolean).join(" · "),
      amount: peso(n(p.total_amount) * (n(p.exchange_rate) || 1)),
    })),
    ...(deposits.data || []).map((d: any) => ({
      id: `dep-${d.id}`, when: d.created_at, title: `Down payment: ${docNo(d.overseas_purchase_orders?.po_number)}`,
      detail: "Overseas PO", amount: peso(n(d.php_amount)),
    })),
  ];
}

async function billRecords(since: string): Promise<ChangeRecord[]> {
  const { data, error } = await db
    .from("payables")
    .select("id, updated_at, payee, category, status, amount, amount_paid, due_date, is_check, check_number")
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  return (data || []).map((p: any) => ({
    id: `pay-${p.id}`,
    when: p.updated_at,
    title: p.payee || p.category || "Payable",
    detail: [p.is_check && p.check_number ? `Check ${p.check_number}` : "", p.category, p.status, p.due_date ? `due ${p.due_date}` : ""].filter(Boolean).join(" · "),
    amount: peso(n(p.amount) - n(p.amount_paid)),
  }));
}

async function invoiceRecords(since: string, status?: string): Promise<ChangeRecord[]> {
  let q = db
    .from("invoices")
    .select("id, updated_at, invoice_number, status, total_amount, customers(name)")
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(LIMIT);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  const rows: ChangeRecord[] = (data || []).map((i: any) => ({
    id: `inv-${i.id}`,
    when: i.updated_at,
    title: docNo(i.invoice_number),
    detail: [i.customers?.name, String(i.status || "").replace(/_/g, " ")].filter(Boolean).join(" · "),
    amount: peso(n(i.total_amount)),
  }));
  if (status) return rows;
  const { data: manual } = await db
    .from("manual_receivables")
    .select("id, updated_at, description, status, amount")
    .gte("updated_at", since)
    .limit(LIMIT);
  for (const m of manual || []) {
    rows.push({ id: `mr-${m.id}`, when: m.updated_at, title: m.description || "Manual receivable", detail: m.status, amount: peso(n(m.amount)) });
  }
  return rows;
}

const MOVE_LABELS: Record<string, string> = {
  out_invoice: "Sold (invoice)",
  out_online_sale: "Sold (online)",
  in_po: "Received or returned",
  adjust_surplus: "Adjusted up",
  adjust_missing: "Adjusted down",
  transfer_b2b_in: "Transfer in",
  transfer_b2b_out: "Transfer out",
};

/** Stock in and out, added up per item and kind, and any cost changes. */
async function inventoryRecords(since: string): Promise<ChangeRecord[]> {
  const moves = await fetchAllRows<any>(() =>
    db.from("inventory_movements")
      .select("id, created_at, item_id, type, quantity, unit, items(name)")
      .gte("created_at", since)
      .not("type", "in", "(transfer_w2s,transfer_s2w)")
      .order("id"),
  );
  const grouped = new Map<string, ChangeRecord & { qty: number; unit: string }>();
  for (const m of moves) {
    const key = `${m.item_id}|${m.type}|${m.unit || ""}`;
    const cur = grouped.get(key);
    if (cur) {
      cur.qty += n(m.quantity);
      if (m.created_at > cur.when) cur.when = m.created_at;
    } else {
      grouped.set(key, {
        id: `mv-${key}`, when: m.created_at, title: m.items?.name || "Item",
        detail: MOVE_LABELS[m.type] || String(m.type).replace(/_/g, " "),
        amount: "", qty: n(m.quantity), unit: m.unit || "pcs",
      });
    }
  }
  const rows: ChangeRecord[] = [...grouped.values()].map(({ qty, unit, ...r }) => ({ ...r, amount: `${qty} ${unit}` }));

  const { data: costs } = await db
    .from("item_cost_history")
    .select("id, created_at, previous_cost, new_cost, items(name)")
    .gte("created_at", since)
    .limit(LIMIT);
  for (const c of costs || []) {
    rows.push({
      id: `cost-${c.id}`, when: c.created_at, title: c.items?.name || "Item", detail: "Cost changed",
      amount: `${peso(n(c.previous_cost))} → ${peso(n(c.new_cost))}`,
    });
  }
  return rows;
}

async function loanRecords(since: string): Promise<ChangeRecord[]> {
  const { data } = await db.from("loans").select("id, updated_at, lender, principal_amount").gte("updated_at", since).limit(LIMIT);
  return (data || []).map((l: any) => ({ id: `loan-${l.id}`, when: l.updated_at, title: l.lender || "Loan", detail: "Loan changed", amount: peso(n(l.principal_amount)) }));
}

/** The records behind a line, newest first, since the moment compared with. */
export async function getChangeRecords(key: LineKey, since: string): Promise<ChangeRecord[]> {
  const rows = await (() => {
    switch (key) {
      case "cash": return cashRecords(since, false);
      case "dueToOwner": return cashRecords(since, true);
      case "supplierPos":
      case "incoming": return poRecords(since);
      case "billsDueSoon":
      case "billsOwedNow": return billRecords(since);
      case "receivables": return invoiceRecords(since);
      case "reserved": return invoiceRecords(since, "reserved");
      case "inventory": return inventoryRecords(since);
      case "loans": return loanRecords(since);
    }
  })();
  return rows.sort((a, b) => b.when.localeCompare(a.when));
}

export { stamp as recordStamp };
