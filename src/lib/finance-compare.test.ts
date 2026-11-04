import { describe, expect, it } from "vitest";
import { changeLines, freeToSpend, metricValue, netAssetValue, snapshotForDaysAgo, type FinanceFigures } from "./finance-compare";

const then: FinanceFigures = {
  inventory: 1000, reserved: 50, receivables: 300, incoming: 200, cash: 500,
  supplierPos: 400, billsOwedNow: 150, billsDueSoon: 160, dueToOwner: 20, loans: 100,
};
const now: FinanceFigures = { ...then, cash: 470, supplierPos: 420, billsDueSoon: 142, dueToOwner: -30, inventory: 1100 };

describe("the totals", () => {
  it("match the dashboard's sums", () => {
    expect(freeToSpend(then)).toBe(500 - 400 - 160);
    expect(netAssetValue(then)).toBe(1000 + 50 + 300 + 200 + 500 - 150 - 20 - 100);
  });
  it("count an owner who owes the company as an asset", () => {
    expect(netAssetValue({ ...then, dueToOwner: -30 }) - netAssetValue({ ...then, dueToOwner: 0 })).toBe(30);
  });
});

describe("changeLines", () => {
  it("adds up to the change, for both cards", () => {
    for (const m of ["free", "nav"] as const) {
      const sum = changeLines(m, then, now).reduce((s, l) => s + l.effect, 0);
      expect(sum).toBeCloseTo(metricValue(m, now) - metricValue(m, then));
    }
  });
  it("marks owing more as hurting and owing less as helping", () => {
    const lines = changeLines("free", then, now);
    expect(lines.find((l) => l.key === "cash")!.effect).toBe(-30);
    expect(lines.find((l) => l.key === "supplierPos")!.effect).toBe(-20);
    expect(lines.find((l) => l.key === "billsDueSoon")!.effect).toBe(18);
  });
});

describe("snapshotForDaysAgo", () => {
  const snaps = [{ date: "2026-10-20" }, { date: "2026-10-27" }, { date: "2026-11-02" }];
  it("takes that day's record", () => {
    expect(snapshotForDaysAgo(snaps, "2026-11-03", 1)!.date).toBe("2026-11-02");
    expect(snapshotForDaysAgo(snaps, "2026-11-03", 7)!.date).toBe("2026-10-27");
  });
  it("takes the nearest earlier one, else the earliest", () => {
    expect(snapshotForDaysAgo(snaps, "2026-11-03", 3)!.date).toBe("2026-10-27");
    expect(snapshotForDaysAgo(snaps, "2026-11-03", 90)!.date).toBe("2026-10-20");
    expect(snapshotForDaysAgo([], "2026-11-03", 7)).toBeNull();
  });
});
