import { describe, it, expect } from "vitest";
import { DEFAULT_LEAD_DAYS, itemDemand, median, planReorder, projectStock, resolveLeadTime, stockUnitsSold, weightedDailyRate, type DemandSale } from "./restock";

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
  it("puts it under On order when below its minimum but an order is coming", () => {
    // 3 in stock, 300 coming, minimum 500, ~6/day, 31-day lead: the Video Balun case.
    const p = planReorder({ stock: 3, onOrder: 300, rate: 6, leadDays: 31, coverDays: 30, minStock: 500 });
    expect(p.group).toBe("ordered");
    // Still 197 short of the minimum, to order in ~12 days.
    expect(p.suggested).toBe(197);
    expect(p.orderByDays).toBe(12);
  });
  it("leaves healthy stock alone", () => {
    expect(planReorder({ stock: 500, onOrder: 0, rate: 2, leadDays: 10, coverDays: 30 })).toMatchObject({ group: "ok", suggested: 0 });
  });
});

describe("itemDemand", () => {
  const today = new Date(2026, 9, 25);
  const daily = (perDay: number, from: number, to: number, prefix = "s"): DemandSale[] =>
    Array.from({ length: to - from + 1 }, (_, i) => ({ id: `${prefix}${from + i}`, ref: "INV", daysAgo: from + i, units: perDay }));
  const base = { receipts: [], adjustments: [], createdAt: "2024-01-01", today };

  it("gives the plain rate when stock never ran short", () => {
    const d = itemDemand({ ...base, sales: daily(2, 1, 90), stockNow: 50 });
    expect(d.rate).toBeCloseTo(2);
    expect(d.shortDays).toBe(0);
  });

  it("leaves out days that started without enough stock to sell", () => {
    // Sold 4 a day until 30 days ago, then ran out: the empty month is not "no demand".
    const d = itemDemand({ ...base, sales: daily(4, 31, 90), stockNow: 0 });
    expect(d.shortDays).toBe(30);
    expect(d.usedDays).toBe(60);
    expect(d.rate).toBeCloseTo(4);
  });

  it("sets aside a one-off big order, and counts it when included", () => {
    const sales = [...daily(2, 1, 90), { id: "big", ref: "INV-1234", daysAgo: 45, units: 400 }];
    const d = itemDemand({ ...base, sales, stockNow: 1000 });
    expect(d.leftOut.map((o) => o.ref)).toEqual(["INV-1234"]);
    expect(d.rate).toBeCloseTo(2);
    const withIt = itemDemand({ ...base, sales, stockNow: 1000, includeIds: new Set(["big"]) });
    expect(withIt.leftOut).toHaveLength(0);
    expect(withIt.included).toHaveLength(1);
    expect(withIt.rate).toBeGreaterThan(2);
  });

  it("leaves no days out when the stock records do not add up", () => {
    // 100 received 5 days ago with nothing before it: earlier stock would be negative.
    const d = itemDemand({ ...base, sales: daily(1, 1, 90), stockNow: 50, receipts: [{ daysAgo: 5, units: 100 }] });
    expect(d.shortDays).toBe(0);
    expect(d.usedDays).toBe(90);
  });

  it("counts receipts and corrections when rebuilding stock", () => {
    // Out of stock until a delivery of 60 ten days ago; 3 a day since.
    const d = itemDemand({ ...base, sales: daily(3, 1, 10), stockNow: 30, receipts: [{ daysAgo: 10, units: 60 }] });
    // Only the days since the delivery had stock.
    expect(d.usedDays).toBe(9);
    expect(d.rate).toBeCloseTo(3, 0);
  });
});

describe("incoming stock counted from its arrival", () => {
  // Data Cabinet 9u: out of stock, 20 due in 19 days, 0.52 sold a day, 37-day lead.
  const cabinet = { stock: 0, onOrder: 20, rate: 0.52, leadDays: 37, coverDays: 30 };

  it("runs out 38 days after the order lands, not 38 days from today", () => {
    const p = projectStock(0, 0.52, [{ qty: 20, inDays: 19 }], 37);
    expect(p.runOutDay).toBeCloseTo(19 + 20 / 0.52);
    expect(p.waitingDays).toBe(19);
  });

  it("is On order with time to spare, not Order now", () => {
    const counted = planReorder({ ...cabinet, incoming: [{ qty: 20, inDays: 19 }] });
    expect(counted.group).toBe("ordered");
    // run out ≈ day 57.5; less 37 lead and 7 safety → order within 13 days
    expect(counted.orderByDays).toBe(13);
    // 0.52 × (37 + 7 + 30 − 19 days waiting) − 20 ≈ 8.6 → 9
    expect(counted.suggested).toBe(9);

    // The old reading, as if the 20 were already here.
    const asOnHand = planReorder(cabinet);
    expect(asOnHand.group).toBe("now");
    expect(asOnHand.orderByDays).toBe(-6);
  });

  it("changes nothing when stock on hand lasts until the order lands", () => {
    const base = { stock: 100, onOrder: 50, rate: 2, leadDays: 20, coverDays: 30 };
    const timed = planReorder({ ...base, incoming: [{ qty: 50, inDays: 10 }] });
    const plain = planReorder(base);
    expect(timed.orderByDays).toBe(plain.orderByDays);
    expect(timed.suggested).toBe(plain.suggested);
  });

  it("treats a late or undated order as arriving now", () => {
    const p = planReorder({ ...cabinet, incoming: [{ qty: 20, inDays: -5 }] });
    expect(p.orderByDays).toBe(planReorder(cabinet).orderByDays);
  });
});
