import { supabase } from "@/integrations/supabase/client";
import type { CommissionCode } from "@/lib/commission";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface CommissionRate {
  id: string;
  code: CommissionCode;
  /** Percent: 0.5 means 0.5%. */
  rate: number;
  effective_from: string;
}

export interface CommissionCategory {
  id: string;
  category: string;
  code: CommissionCode;
}

export interface CommissionAgent {
  id: string;
  name: string;
  earns_commission: boolean;
  petty_cash_account_id: string | null;
}

/** One invoice line an agent was paid for, as commission_lines() returns it. */
export interface CommissionLine {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string | null;
  paid_on: string;
  customer: string | null;
  payment_method: string | null;
  payment_account: string | null;
  line_id: string;
  item_id: string | null;
  item_name: string | null;
  category: string | null;
  quantity: number;
  unit_price: number;
  dp: number | null;
  dp2: number | null;
  code: CommissionCode | null;
  rate: number | null;
  sales: number;
  commission: number;
  problems: string[];
}

export interface UnassignedInvoice {
  invoice_id: string;
  invoice_number: string;
  paid_on: string;
  customer: string | null;
  sales_agent: string | null;
  total_amount: number;
}

export interface CommissionAdjustment {
  id: string;
  agent_id: string;
  month: string;
  label: string;
  amount: number;
  created_at: string;
}

export interface CommissionClosing {
  agent_id: string;
  month: string;
  sales: number;
  commission: number;
  adjustments: number;
  total: number;
  summary: { code: CommissionCode; sales: number; commission: number; rate: number | null; line_count: number }[];
  lines: CommissionLine[];
  adjustment_lines: { label: string; amount: number }[];
  closed_at: string;
  closed_by_email: string | null;
}

const num = (v: unknown) => Number(v ?? 0);

export async function getCommissionRates(): Promise<CommissionRate[]> {
  const { data, error } = await db.from("commission_rates").select("*").order("code").order("effective_from", { ascending: false });
  if (error) throw error;
  return (data || []).map((r: any) => ({ ...r, rate: num(r.rate) }));
}

/** A new rate from a day on. The same day again replaces that day's rate. */
export async function setCommissionRate(code: CommissionCode, rate: number, effectiveFrom: string) {
  const { error } = await db.from("commission_rates")
    .upsert({ code, rate, effective_from: effectiveFrom }, { onConflict: "code,effective_from" });
  if (error) throw error;
}

export async function deleteCommissionRate(id: string) {
  const { error } = await db.from("commission_rates").delete().eq("id", id);
  if (error) throw error;
}

/** The rate in force on a day: the latest one started on or before it. */
export function rateOn(rates: CommissionRate[], code: CommissionCode, day: string): CommissionRate | null {
  return rates
    .filter((r) => r.code === code && r.effective_from <= day)
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0] ?? null;
}

export async function getCommissionCategories(): Promise<CommissionCategory[]> {
  const { data, error } = await db.from("commission_categories").select("*").order("code").order("category");
  if (error) throw error;
  return data || [];
}

export async function addCommissionCategory(category: string, code: CommissionCode) {
  const { error } = await db.from("commission_categories").insert({ category: category.trim(), code });
  if (error) {
    if (error.code === "23505") throw new Error(`"${category.trim()}" already has a code.`);
    throw error;
  }
}

export async function deleteCommissionCategory(id: string) {
  const { error } = await db.from("commission_categories").delete().eq("id", id);
  if (error) throw error;
}

export async function getCommissionAgents(): Promise<CommissionAgent[]> {
  const { data, error } = await db.from("sales_agents").select("id, name, earns_commission, petty_cash_account_id").order("name");
  if (error) throw error;
  return data || [];
}

export async function updateCommissionAgent(id: string, patch: Partial<Pick<CommissionAgent, "earns_commission" | "petty_cash_account_id">>) {
  const { error } = await db.from("sales_agents").update(patch).eq("id", id);
  if (error) throw error;
}

export async function getCommissionLines(agentId: string, month: string): Promise<CommissionLine[]> {
  const { data, error } = await db.rpc("commission_lines", { p_agent_id: agentId, p_month: month });
  if (error) throw error;
  return (data || []).map((l: any) => ({
    ...l,
    quantity: num(l.quantity),
    unit_price: num(l.unit_price),
    dp: l.dp == null ? null : num(l.dp),
    dp2: l.dp2 == null ? null : num(l.dp2),
    rate: l.rate == null ? null : num(l.rate),
    sales: num(l.sales),
    commission: num(l.commission),
    problems: l.problems || [],
  }));
}

export async function getUnassignedInvoices(month: string): Promise<UnassignedInvoice[]> {
  const { data, error } = await db.rpc("commission_unassigned_invoices", { p_month: month });
  if (error) throw error;
  return (data || []).map((r: any) => ({ ...r, total_amount: num(r.total_amount) }));
}

export async function getCommissionAdjustments(agentId: string, month: string): Promise<CommissionAdjustment[]> {
  const { data, error } = await db.from("commission_adjustments").select("*")
    .eq("agent_id", agentId).eq("month", month).order("created_at");
  if (error) throw error;
  return (data || []).map((a: any) => ({ ...a, amount: num(a.amount) }));
}

export async function addCommissionAdjustment(agentId: string, month: string, label: string, amount: number) {
  const { data: { session } } = await supabase.auth.getSession();
  const { error } = await db.from("commission_adjustments").insert({
    agent_id: agentId, month, label: label.trim(), amount, created_by_email: session?.user?.email || null,
  });
  if (error) throw error;
}

export async function deleteCommissionAdjustment(id: string) {
  const { error } = await db.from("commission_adjustments").delete().eq("id", id);
  if (error) throw error;
}

export async function getCommissionClosing(agentId: string, month: string): Promise<CommissionClosing | null> {
  const { data, error } = await db.from("commission_closings").select("*")
    .eq("agent_id", agentId).eq("month", month).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...data,
    sales: num(data.sales),
    commission: num(data.commission),
    adjustments: num(data.adjustments),
    total: num(data.total),
    summary: (data.summary || []).map((s: any) => ({ ...s, sales: num(s.sales), commission: num(s.commission), rate: s.rate == null ? null : num(s.rate) })),
    lines: (data.lines || []).map((l: any) => ({ ...l, problems: l.problems || [] })),
    adjustment_lines: (data.adjustment_lines || []).map((a: any) => ({ ...a, amount: num(a.amount) })),
  };
}

export async function closeCommissionMonth(agentId: string, month: string) {
  const { error } = await db.rpc("close_commission_month", { p_agent_id: agentId, p_month: month });
  if (error) throw error;
}

/** Reopens a closed month: the saved figures go, and it is worked out live again. */
export async function reopenCommissionMonth(agentId: string, month: string) {
  const { error } = await db.from("commission_closings").delete().eq("agent_id", agentId).eq("month", month);
  if (error) throw error;
}
