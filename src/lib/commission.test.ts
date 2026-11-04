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
