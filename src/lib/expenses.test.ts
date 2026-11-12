import { describe, it, expect } from "vitest";
import {
  summariseExpenses, uncountedOutflows, monthsEnding, dueDateIn, recurringState, changePct,
  type ExpenseCategory, type ExpenseTxn,
} from "./expenses";

const cat = (name: string, is_expense = true): ExpenseCategory => ({ id: name, name, is_expense, is_active: true, sort_order: 0 });
const txn = (id: string, txn_date: string, category: string, php: number, extra: Partial<ExpenseTxn> = {}): ExpenseTxn => ({
  id, txn_date, direction: "out", category, php, transfer_group_id: null, ...extra,
});

const categories = [cat("Rent"), cat("Shopee Ads"), cat("Supplier Payment", false)];

describe("summariseExpenses", () => {
  it("adds money out under expense categories by month, matching case and spaces loosely", () => {
    const s = summariseExpenses([
      txn("1", "2026-10-03", "Rent", 20000),
      txn("2", "2026-11-03", " rent ", 20000),
      txn("3", "2026-11-10", "Shopee Ads", 1500.5),
      txn("4", "2026-11-11", "Shopee Ads", 499.5),
    ], categories, ["2026-10", "2026-11"]);
    expect(s.byCategory.get("Rent")).toEqual({ "2026-10": 20000, "2026-11": 20000 });
    expect(s.byCategory.get("Shopee Ads")).toEqual({ "2026-10": 0, "2026-11": 2000 });
    expect(s.totals).toEqual({ "2026-10": 20000, "2026-11": 22000 });
  });

  it("leaves out transfers, money in, non-expense categories and months outside the range", () => {
    const s = summariseExpenses([
      txn("1", "2026-11-03", "Rent", 100, { transfer_group_id: "g" }),
      txn("2", "2026-11-03", "Rent", 100, { direction: "in" }),
      txn("3", "2026-11-03", "Supplier Payment", 100),
      txn("4", "2026-09-30", "Rent", 100),
      txn("5", "2026-11-03", "", 100),
    ], categories, ["2026-10", "2026-11"]);
    expect(s.byCategory.size).toBe(0);
    expect(s.totals["2026-11"]).toBe(0);
  });
});

describe("uncountedOutflows", () => {
  it("groups the month's money out that is not counted, blank and non-expense alike", () => {
    const out = uncountedOutflows([
      txn("1", "2026-11-03", "Meralco", 3000),
      txn("2", "2026-11-04", "meralco", 500),
      txn("3", "2026-11-05", "", 200),
      txn("4", "2026-11-05", "Rent", 200),
      txn("5", "2026-11-05", "Meralco", 999, { transfer_group_id: "g" }),
      txn("6", "2026-10-05", "Meralco", 999),
    ], categories, "2026-11");
    expect(out).toEqual([
      { category: "Meralco", total: 3500, count: 2 },
      { category: "", total: 200, count: 1 },
    ]);
  });
});

describe("months and due dates", () => {
  it("lists months across a year boundary", () => {
    expect(monthsEnding("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("puts a day past the month's end on its last day", () => {
    expect(dueDateIn(31, "2026-11")).toBe("2026-11-30");
    expect(dueDateIn(30, "2027-02")).toBe("2027-02-28");
    expect(dueDateIn(5, "2026-11")).toBe("2026-11-05");
  });

  it("reads a bill as paid, skipped, due or upcoming", () => {
    const base = { dayOfMonth: 15, period: "2026-11", paid: false, skipped: false };
    expect(recurringState({ ...base, today: "2026-11-14" })).toBe("upcoming");
    expect(recurringState({ ...base, today: "2026-11-15" })).toBe("due");
    expect(recurringState({ ...base, today: "2026-11-20", skipped: true })).toBe("skipped");
    expect(recurringState({ ...base, today: "2026-11-20", paid: true, skipped: true })).toBe("paid");
  });

  it("gives no change against a month with nothing in it", () => {
    expect(changePct(0, 100)).toBeNull();
    expect(changePct(200, 250)).toBe(25);
  });
});

describe("categorySource", () => {
  it("tells the starting list, added and typed-before categories apart", async () => {
    const { categorySource } = await import("./expenses");
    expect(categorySource({ sort_order: 40 })).toBe("standard");
    expect(categorySource({ sort_order: 800 })).toBe("added");
    expect(categorySource({ sort_order: 900 })).toBe("typed");
  });
});
