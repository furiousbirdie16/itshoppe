import { describe, expect, it } from "vitest";
import { categoryKey, dealerPriceOf, dp2Of, monthKey, priceBand } from "./commission";

describe("priceBand", () => {
  it("is N at DP or above", () => {
    expect(priceBand(100, 100)).toBe("N");
    expect(priceBand(150, 100)).toBe("N");
  });
  it("is BD1 below DP, down to and including DP2", () => {
    expect(priceBand(99, 100)).toBe("BD1");
    expect(priceBand(95, 100)).toBe("BD1");
  });
  it("is BD2 only below DP2", () => {
    expect(priceBand(94.99, 100)).toBe("BD2");
    expect(priceBand(94, 100)).toBe("BD2");
  });
  it("has nothing to say without a DP", () => {
    expect(priceBand(100, null)).toBeNull();
    expect(priceBand(100, undefined)).toBeNull();
    expect(priceBand(100, 0)).toBeNull();
  });
});

describe("dp2Of", () => {
  it("is 5% below DP", () => {
    expect(dp2Of(100)).toBe(95);
    expect(dp2Of(1234)).toBe(1172.3);
  });
});

describe("dealerPriceOf", () => {
  const item = { dealer_price: 10, units_per_stock: 1 };
  it("is the item's DP for the item itself", () => {
    expect(dealerPriceOf(item)).toBe(10);
  });
  it("scales the item's DP for a pack", () => {
    expect(dealerPriceOf(item, { factor: 10 })).toBe(100);
  });
  it("prefers the variation's own DP", () => {
    expect(dealerPriceOf(item, { factor: 10, dealer_price: 90 })).toBe(90);
  });
  it("divides by units per stock for a cut from a roll", () => {
    expect(dealerPriceOf({ dealer_price: 3050, units_per_stock: 305 }, { factor: 1 })).toBe(10);
  });
  it("is null when nothing has a DP", () => {
    expect(dealerPriceOf({ dealer_price: null }, { factor: 5 })).toBeNull();
    expect(dealerPriceOf(null)).toBeNull();
  });
});

describe("categoryKey / monthKey", () => {
  it("ignores case and outer spaces", () => {
    expect(categoryKey(" TP-Link ")).toBe(categoryKey("tp-link"));
  });
  it("keys a month by its first day", () => {
    expect(monthKey(new Date(2026, 10, 30))).toBe("2026-11-01");
  });
});

describe("summarizeByCode", () => {
  it("adds up by code in the sheet's order and leaves uncoded lines out", async () => {
    const { summarizeByCode } = await import("./commission");
    const s = summarizeByCode([
      { code: "N", rate: 5, sales: 100, commission: 5 },
      { code: "B", rate: 0.5, sales: 1000, commission: 5 },
      { code: "N", rate: 5, sales: 33.33, commission: 1.6665 },
      { code: null, rate: null, sales: 500, commission: 0 },
    ]);
    expect(s.codes.map((c) => c.code)).toEqual(["B", "N"]);
    expect(s.codes[1].commission).toBe(6.67);
    expect(s.sales).toBeCloseTo(1133.33);
    expect(s.commission).toBe(11.67);
    expect(s.uncounted).toBe(500);
  });
  it("keeps both rates when one changed mid-month", async () => {
    const { summarizeByCode } = await import("./commission");
    const s = summarizeByCode([
      { code: "N", rate: 5, sales: 100, commission: 5 },
      { code: "N", rate: 4, sales: 100, commission: 4 },
    ]);
    expect(s.codes[0].rates).toEqual([4, 5]);
  });
});

describe("agentMonthStats / productBreakdown", () => {
  const l = (o: Partial<import("./commission").SoldLine>) => ({
    invoice_id: "i1", customer_id: "c1", customer: "Ana", item_id: "a", item_name: "Shelf",
    quantity: 1, code: "N" as const, rate: 5, sales: 100, commission: 5, ...o,
  });
  it("counts orders, customers by id, and walk-ins apart", async () => {
    const { agentMonthStats } = await import("./commission");
    const s = agentMonthStats([
      l({}), l({ item_name: "Cam" }),
      l({ invoice_id: "i2", customer_id: "c2", customer: "Ana" }),
      l({ invoice_id: "i3", customer_id: null, customer: null }),
      l({ invoice_id: "i4", customer_id: undefined, customer: "Ben" }),
    ]);
    expect(s).toEqual({ orders: 4, customers: 3, walkInOrders: 1, sales: 500 });
  });
  it("adds up each product across invoices and codes", async () => {
    const { productBreakdown } = await import("./commission");
    const rows = productBreakdown([
      l({ quantity: 2, sales: 200, commission: 10 }),
      l({ invoice_id: "i2", code: "BD1", rate: 3, sales: 99, commission: 2.97 }),
      l({ item_id: "b", item_name: "Cam", sales: 1000, code: "B", rate: 0.5, commission: 5 }),
      l({ item_id: null, item_name: "Labour", code: null, rate: null, sales: 300, commission: 0 }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Cam", "Labour", "Shelf"]);
    const shelf = rows[2];
    expect(shelf).toMatchObject({ quantity: 3, sales: 299, commission: 12.97, orders: 2, codes: ["BD1", "N"], uncounted: false });
    expect(rows[1].uncounted).toBe(true);
  });
});
