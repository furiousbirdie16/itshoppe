import { describe, expect, it } from "vitest";
import { payableTiming } from "./payable-timing";

const today = new Date(2026, 9, 27); // Oct 27, 2026
const rent = (due: string, amt = 30000) => ({ category: "Rent", due_date: due, outstanding: amt });

describe("payableTiming", () => {
  it("counts rent only from the month it is due", () => {
    const t = payableTiming([rent("2026-10-31"), rent("2026-11-30"), rent("2027-03-31")], ["Rent"], today);
    expect(t.owedNow).toBe(30000);     // October only
    expect(t.later).toBe(60000);
    expect(t.dueSoon).toBe(30000);     // Nov 30 is beyond Oct 27 + 30 days
  });

  it("keeps a supplier check whole, however far out it is dated", () => {
    const t = payableTiming([{ category: "Supplier", due_date: "2026-12-15", outstanding: 50000 }], ["Rent"], today);
    expect(t).toEqual({ owedNow: 50000, dueSoon: 50000, later: 0, laterForCash: 0 });
  });

  it("matches the category ignoring case and spaces, and counts undated rent", () => {
    const t = payableTiming([
      { category: " rent ", due_date: "2027-01-31", outstanding: 100 },
      { category: "Rent", due_date: null, outstanding: 7 },
    ], ["Rent"], today);
    expect(t.owedNow).toBe(7);
    expect(t.later).toBe(100);
  });

  it("puts a check due within 30 days against cash", () => {
    const t = payableTiming([rent("2026-11-20")], ["Rent"], today);
    expect(t.owedNow).toBe(0);
    expect(t.dueSoon).toBe(30000);
  });

  it("ignores settled payables", () => {
    expect(payableTiming([rent("2026-10-31", 0)], ["Rent"], today).owedNow).toBe(0);
  });
});
