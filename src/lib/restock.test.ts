import { describe, it, expect } from "vitest";
import { DEFAULT_LEAD_DAYS, median, planReorder, resolveLeadTime, stockUnitsSold, weightedDailyRate } from "./restock";

describe("stockUnitsSold", () => {
  it("counts a plain sale one for one", () => {
    expect(stockUnitsSold(3, null, 305)).toBe(3);
  });
  it("counts a pack as factor units", () => {
    expect(stockUnitsSold(2, { type: "pack", factor: 10 }, 1)).toBe(20);
  });
  it("counts a cut as its share of a roll", () => {
    expect(stockUnitsSold(61, { type: "cut", factor: 5 }, 305)).toBe(1);
  });
});

describe("weightedDailyRate", () => {
  it("returns the plain rate when sales are steady", () => {
    const m = new Map(Array.from({ length: 90 }, (_, i) => [i + 1, 2] as [number, number]));
    expect(weightedDailyRate(m)).toBeCloseTo(2);
  });
  it("leans on the last 30 days", () => {
    const recentOnly = new Map(Array.from({ length: 30 }, (_, i) => [i + 1, 3] as [number, number]));
    expect(weightedDailyRate(recentOnly)).toBeCloseTo(1.5);
  });
});

describe("median", () => {
  it("is not dragged by one outlier", () => {
    expect(median([10, 12, 11, 90])).toBe(11.5);
    expect(median([])).toBeNull();
  });
});

describe("resolveLeadTime", () => {
  const learned = { days: 23, deliveries: 6, productionDays: 15, transitDays: 8, onTimePct: 50 };
  it("prefers the typed lead time and flags when deliveries disagree", () => {
    const l = resolveLeadTime(14, learned);
    expect(l).toMatchObject({ days: 14, source: "set", mismatch: true });
  });
  it("falls back to past deliveries, then the 30-day default", () => {
    expect(resolveLeadTime(null, learned)).toMatchObject({ days: 23, source: "history" });
    expect(resolveLeadTime(null, null)).toMatchObject({ days: DEFAULT_LEAD_DAYS, source: "default" });
    expect(DEFAULT_LEAD_DAYS).toBe(30);
  });
});

describe("planReorder", () => {
  it("orders now when stock runs out before a new order could arrive", () => {
    // 2/day, 20 in stock lasts 10 days; lead 10 + safety 7 = 17.
    const p = planReorder({ stock: 20, onOrder: 0, rate: 2, leadDays: 10, coverDays: 30 });
    expect(p.group).toBe("now");
    // 2 × (10 + 7 + 30) − 20 = 74
    expect(p.suggested).toBe(74);
  });
  it("lifts the quantity to the minimum order quantity", () => {
    expect(planReorder({ stock: 20, onOrder: 0, rate: 2, leadDays: 10, coverDays: 30, moq: 100 }).suggested).toBe(100);
  });
  it("puts it under On order when what is coming covers it", () => {
    expect(planReorder({ stock: 20, onOrder: 60, rate: 2, leadDays: 10, coverDays: 30 }).group).toBe("ordered");
  });
  it("watches an item below its minimum that is not selling", () => {
    const p = planReorder({ stock: 2, onOrder: 0, rate: 0, leadDays: 10, coverDays: 30, minStock: 5 });
    expect(p.group).toBe("watch");
    expect(p.suggested).toBe(3);
  });
  it("orders now when below its minimum and still selling", () => {
    expect(planReorder({ stock: 50, onOrder: 0, rate: 0.5, leadDays: 10, coverDays: 30, minStock: 60 }).group).toBe("now");
  });
  it("leaves healthy stock alone", () => {
    expect(planReorder({ stock: 500, onOrder: 0, rate: 2, leadDays: 10, coverDays: 30 })).toMatchObject({ group: "ok", suggested: 0 });
  });
});
