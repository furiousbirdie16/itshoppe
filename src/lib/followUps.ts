import { supabase } from "@/integrations/supabase/client";
import { differenceInCalendarDays } from "date-fns";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface FollowUpEntry {
  id: string;
  customer_id: string;
  followed_up_at: string;
  user_id: string | null;
  user_email: string | null;
  sales_agent: string | null;
  notes: string;
  created_at: string;
}

export type FollowUpStatus = "active" | "needs" | "never";

export interface FollowUpInfo {
  status: FollowUpStatus;
  days: number | null;
  label: string;
  /** Tailwind classes for badge/tag rendering. */
  className: string;
  /** Solid dot color for inline indicators. */
  dotClass: string;
}

export function getFollowUpInfo(lastAt: string | null | undefined): FollowUpInfo {
  if (!lastAt) {
    return {
      status: "never",
      days: null,
      label: "Missed",
      className: "bg-destructive/15 text-destructive border-destructive/30",
      dotClass: "bg-destructive",
    };
  }
  const days = differenceInCalendarDays(new Date(), new Date(lastAt));
  const compact = `${days}d`;
  if (days <= 10) {
    return {
      status: "active",
      days,
      label: compact,
      className: "bg-success/15 text-success border-success/30",
      dotClass: "bg-success",
    };
  }
  if (days <= 14) {
    return {
      status: "active",
      days,
      label: compact,
      className: "bg-warning/15 text-warning border-warning/30",
      dotClass: "bg-warning",
    };
  }
  return {
    status: "needs",
    days,
    label: `Pending · ${compact}`,
    className: "bg-destructive/15 text-destructive border-destructive/30",
    dotClass: "bg-destructive",
  };
}

export async function markFollowedUp(customerId: string, notes = "", salesAgent = "") {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await db.from("customer_follow_ups").insert({
    customer_id: customerId,
    user_id: user?.id ?? null,
    user_email: user?.email ?? null,
    sales_agent: salesAgent || null,
    notes,
  });
  if (error) throw error;
}

export async function getFollowUpHistory(customerId: string): Promise<FollowUpEntry[]> {
  const { data, error } = await db
    .from("customer_follow_ups")
    .select("*")
    .eq("customer_id", customerId)
    .order("followed_up_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data as FollowUpEntry[];
}

export const CLASSIFICATIONS = [
  { value: "retail", label: "Retail", className: "bg-primary/15 text-primary border-primary/30", description: "Walk-in, one-time, or small qty" },
  { value: "wholesale", label: "Wholesale", className: "bg-accent/30 text-accent-foreground border-accent/50", description: "Bulk buyers or resellers" },
  { value: "recurring", label: "Recurring", className: "bg-success/15 text-success border-success/30", description: "Repeat customers" },
] as const;

export type ClassificationValue = (typeof CLASSIFICATIONS)[number]["value"];

export function classificationMeta(value: string | null | undefined) {
  return CLASSIFICATIONS.find((c) => c.value === value) || CLASSIFICATIONS[0];
}
