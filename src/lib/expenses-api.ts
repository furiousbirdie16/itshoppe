import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/paginate";
import { createCashTransaction, getCashTransactions } from "@/lib/api";
import { fxPhpAmountById, isForeign } from "@/lib/fx";
import { categoryKey, dueDateIn, type ExpenseCategory, type ExpenseTxn } from "@/lib/expenses";
import type { CashTransaction } from "@/types/database";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/** One cache for the list, so a category added in any dropdown shows in all of them. */
export const EXPENSE_CATEGORIES_KEY = ["expense-categories"] as const;

export const getExpenseCategories = async (): Promise<ExpenseCategory[]> => {
  const { data, error } = await db.from("expense_categories")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return data || [];
};

/** Adds a category, or hands back the one already there under that name. */
export const createExpenseCategory = async (name: string, isExpense = true): Promise<ExpenseCategory> => {
  const clean = name.trim();
  if (!clean) throw new Error("Enter a category name");
  const existing = (await getExpenseCategories()).find((c) => categoryKey(c.name) === categoryKey(clean));
  if (existing) return existing;
  const { data, error } = await db.from("expense_categories")
    .insert({ name: clean, is_expense: isExpense, sort_order: 800 })
    .select().single();
  if (error) throw error;
  return data;
};

export const updateExpenseCategory = async (id: string, patch: Partial<Pick<ExpenseCategory, "is_expense" | "is_active" | "sort_order">>) => {
  const { error } = await db.from("expense_categories")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
};

/** Renames the category and every entry that uses it. */
export const renameExpenseCategory = async (id: string, name: string) => {
  const { error } = await db.rpc("rename_expense_category", { p_id: id, p_name: name });
  if (error) throw error;
};

/** Moves every entry under one category to another, then removes the first. */
export const mergeExpenseCategory = async (fromId: string, intoId: string) => {
  const { error } = await db.rpc("merge_expense_category", { p_from: fromId, p_into: intoId });
  if (error) throw error;
};

// ---------------------------------------------------------------------------
// Spending
// ---------------------------------------------------------------------------

export type ExpenseRow = ExpenseTxn & {
  amount: number;
  account_id: string;
  account_name: string;
  currency: string;
  payee: string;
  notes: string;
  reference: string;
  payable_id: string | null;
  recurring_expense_id: string | null;
  recurring_period: string | null;
};

/**
 * Every outflow between two dates, from every account, with its peso value.
 * Categories are left as they are; which ones count is decided on the page,
 * so the list of uncounted outflows comes from the same read.
 */
export const getOutflows = async (fromDate: string, toDate: string): Promise<ExpenseRow[]> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await fetchAllRows<any>(() =>
    db.from("cash_transactions")
      .select("id, txn_date, direction, amount, category, payee, notes, reference, transfer_group_id, account_id, payable_id, recurring_expense_id, recurring_period, cash_accounts(name, currency, account_type)")
      .eq("direction", "out")
      .gte("txn_date", fromDate)
      .lte("txn_date", toDate)
      .order("txn_date", { ascending: true })
      .order("id"),
  );

  // A foreign account's outflow is worth what that currency cost on average,
  // which only the account's whole history can say.
  const foreignIds = [...new Set(rows.filter((r) => isForeign(r.cash_accounts || {})).map((r) => r.account_id as string))];
  const phpById: Record<string, number> = {};
  if (foreignIds.length) {
    const history = await getCashTransactions(foreignIds);
    // One replay per account: the average rate is each account's own.
    for (const id of foreignIds) Object.assign(phpById, fxPhpAmountById(history.filter((t) => t.account_id === id)));
  }

  return rows.map((r) => ({
    id: r.id,
    txn_date: r.txn_date,
    direction: r.direction,
    category: r.category,
    transfer_group_id: r.transfer_group_id,
    amount: Number(r.amount || 0),
    php: isForeign(r.cash_accounts || {}) ? Number(phpById[r.id] ?? 0) : Number(r.amount || 0),
    account_id: r.account_id,
    account_name: r.cash_accounts?.name || "",
    currency: r.cash_accounts?.currency || "PHP",
    payee: r.payee || "",
    notes: r.notes || "",
    reference: r.reference || "",
    payable_id: r.payable_id ?? null,
    recurring_expense_id: r.recurring_expense_id ?? null,
    recurring_period: r.recurring_period ?? null,
  }));
};

// ---------------------------------------------------------------------------
// Recurring bills
// ---------------------------------------------------------------------------

export interface RecurringExpense {
  id: string;
  name: string;
  category: string;
  payee: string;
  account_id: string | null;
  amount: number;
  day_of_month: number;
  auto_post: boolean;
  is_active: boolean;
  notes: string;
  created_at: string;
}

export const getRecurringExpenses = async (): Promise<RecurringExpense[]> => {
  const { data, error } = await db.from("recurring_expenses")
    .select("*")
    .order("day_of_month", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return data || [];
};

export const saveRecurringExpense = async (r: Partial<RecurringExpense> & { id?: string }) => {
  const { id, created_at: _c, ...rest } = r;
  const q = id
    ? db.from("recurring_expenses").update({ ...rest, updated_at: new Date().toISOString() }).eq("id", id)
    : db.from("recurring_expenses").insert(rest);
  const { error } = await q;
  if (error) throw error;
};

export const deleteRecurringExpense = async (id: string) => {
  const { error } = await db.from("recurring_expenses").delete().eq("id", id);
  if (error) throw error;
};

export const getRecurringSkips = async (period: string): Promise<string[]> => {
  const { data, error } = await db.from("recurring_expense_skips").select("recurring_id").eq("period", period);
  if (error) throw error;
  return ((data as { recurring_id: string }[]) || []).map((r) => r.recurring_id);
};

export const skipRecurring = async (recurringId: string, period: string) => {
  const { error } = await db.from("recurring_expense_skips").insert({ recurring_id: recurringId, period });
  if (error && error.code !== "23505") throw error;
};

export const unskipRecurring = async (recurringId: string, period: string) => {
  const { error } = await db.from("recurring_expense_skips").delete().eq("recurring_id", recurringId).eq("period", period);
  if (error) throw error;
};

/** Records a month's payment of a bill as an ordinary withdrawal, so it notifies and shows in the ledger like one. */
export const payRecurring = async (r: RecurringExpense, args: {
  period: string; accountId: string; amount: number; date?: string; notes?: string;
}) => {
  try {
    return await createCashTransaction({
      account_id: args.accountId,
      direction: "out",
      amount: args.amount,
      txn_date: args.date || dueDateIn(r.day_of_month, args.period),
      category: r.category,
      payee: r.payee,
      notes: args.notes?.trim() || `Recurring: ${r.name}`,
      recurring_expense_id: r.id,
      recurring_period: args.period,
    } as Partial<CashTransaction>);
  } catch (e) {
    if ((e as { code?: string })?.code === "23505") throw new Error(`${r.name} is already paid for ${args.period}.`);
    throw e;
  }
};

/** The withdrawals that paid bills for a month, whatever day they were made. */
export const getRecurringPayments = async (period: string): Promise<{ id: string; recurring_expense_id: string; amount: number; txn_date: string; account_id: string }[]> => {
  const { data, error } = await db.from("cash_transactions")
    .select("id, recurring_expense_id, amount, txn_date, account_id")
    .eq("recurring_period", period)
    .not("recurring_expense_id", "is", null);
  if (error) throw error;
  return data || [];
};

/**
 * Re-files one entry under another category. Not the full edit: no Telegram
 * message for a filing fix. The edit is still recorded by the database.
 */
export const setTransactionCategory = async (id: string, category: string) => {
  const { data: { session } } = await supabase.auth.getSession();
  const { error } = await db.from("cash_transactions")
    .update({
      category: category.trim(),
      updated_at: new Date().toISOString(),
      updated_by: session?.user?.id ?? null,
      updated_by_email: session?.user?.email ?? "",
    })
    .eq("id", id);
  if (error) throw error;
};
