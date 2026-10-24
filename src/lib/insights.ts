// Display helpers shared by the Business Insights table and its mobile cards.
import { addDays, addMonths, addWeeks, differenceInCalendarDays, format, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import type { ProductAction } from "@/types/insights";

export const ACTION_CLASS: Record<ProductAction, string> = {
  Buy: "bg-red-500/10 text-red-600 border-red-500/30",
  Maintain: "bg-green-500/10 text-green-600 border-green-500/30",
  Reduce: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  Overstock: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  Dead: "bg-muted text-muted-foreground border-border",
};

/** Whole numbers as-is; fractions (a cut off a roll) to two places. */
export const fmtUnits = (n: number) => (Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(2));

export const fmtDays = (d: number) => (d === Infinity ? "∞" : d > 999 ? ">999" : Math.round(d).toString());

export type Bucket = "day" | "week" | "month";
export interface BucketSlot {
  key: string;
  /** Axis label, e.g. "Oct 3" or "Oct 2026". */
  label: string;
  /** Tooltip heading, e.g. "Week of Oct 3, 2026". */
  title: string;
  start: Date;
}

/**
 * Chart buckets covering start..end: daily up to ~2 months, weekly up to a
 * year, then monthly — so a chart never has hundreds of slivers or one bar.
 */
export function makeBuckets(start: Date, end: Date, force?: Bucket) {
  const span = differenceInCalendarDays(end, start) + 1;
  const bucket: Bucket = force ?? (span <= 62 ? "day" : span <= 371 ? "week" : "month");
  const keyOf = (d: Date) =>
    bucket === "day" ? format(d, "yyyy-MM-dd") : bucket === "week" ? format(startOfWeek(d), "yyyy-MM-dd") : format(d, "yyyy-MM");
  const slots: BucketSlot[] = [];
  let cursor = bucket === "week" ? startOfWeek(start) : bucket === "month" ? startOfMonth(start) : startOfDay(start);
  while (cursor <= end) {
    slots.push({
      key: keyOf(cursor),
      label: bucket === "month" ? format(cursor, "MMM yyyy") : format(cursor, "MMM d"),
      title: bucket === "day" ? format(cursor, "EEE, MMM d yyyy") : bucket === "week" ? `Week of ${format(cursor, "MMM d, yyyy")}` : format(cursor, "MMMM yyyy"),
      start: cursor,
    });
    cursor = bucket === "day" ? addDays(cursor, 1) : bucket === "week" ? addWeeks(cursor, 1) : addMonths(cursor, 1);
  }
  return { bucket, keyOf, slots };
}
