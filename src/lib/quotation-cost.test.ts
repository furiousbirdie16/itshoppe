import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { summariseQuotationCost } from "./quotation-cost";

describe("summariseQuotationCost", () => {
  it("adds cost and profit over the lines", () => {
    const s = summariseQuotationCost(
      [
        { id: "a", item_id: "i1", variation_id: null, quantity: 2, unit_price: 100 },
        { id: "b", item_id: "i2", variation_id: "v1", quantity: 3, unit_price: 50 },
      ],
      { a: 60, b: 20 },
    );
    expect(s.total).toBe(350);
    expect(s.cost).toBe(180);
    expect(s.profit).toBe(170);
    expect(s.margin).toBeCloseTo(48.571, 2);
    expect(s.uncosted).toBe(0);
  });

  it("leaves lines with no cost out of profit and margin", () => {
    const s = summariseQuotationCost(
      [
        { id: "a", item_id: "i1", variation_id: null, quantity: 1, unit_price: 100 },
        { id: "b", item_id: null, variation_id: null, quantity: 1, unit_price: 5000 },
        { id: "c", item_id: "i3", variation_id: null, quantity: 1, unit_price: 300 },
      ],
      { a: 60, b: null, c: null },
    );
    expect(s.total).toBe(5400);
    expect(s.costedTotal).toBe(100);
    expect(s.profit).toBe(40);
    expect(s.margin).toBeCloseTo(40);
    expect(s.uncosted).toBe(2);
  });

  it("no margin on a zero total", () => {
    expect(summariseQuotationCost([], {}).margin).toBeNull();
  });
});
