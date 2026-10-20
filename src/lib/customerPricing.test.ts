import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { latestPricesFrom } from "./customerPricing";

const row = (item: string, price: number, sold: string, extra: Partial<{ variation_id: string; created_at: string; ref: string }> = {}) => ({
  item_id: item,
  variation_id: extra.variation_id ?? null,
  unit_price: price,
  sold_at: sold,
  reference_number: extra.ref ?? null,
  created_at: extra.created_at ?? sold,
});

describe("latestPricesFrom", () => {
  it("keeps the newest price per product and counts every purchase", () => {
    const out = latestPricesFrom([
      row("a", 100, "2026-08-01"),
      row("a", 120, "2026-09-01", { ref: "INV--2" }),
      row("a", 90, "2026-07-01"),
    ]);
    expect(out).toEqual([
      { item_id: "a", variation_id: null, unit_price: 120, sold_at: "2026-09-01", reference_number: "INV--2", times_bought: 3 },
    ]);
  });

  it("treats each variation as its own product", () => {
    const out = latestPricesFrom([
      row("a", 100, "2026-08-01"),
      row("a", 15, "2026-08-02", { variation_id: "cut" }),
    ]);
    expect(out.map((r) => r.variation_id)).toEqual(["cut", null]);
  });

  it("breaks a same-day tie by the later entry", () => {
    const out = latestPricesFrom([
      row("a", 100, "2026-08-01", { created_at: "2026-08-01T09:00" }),
      row("a", 110, "2026-08-01", { created_at: "2026-08-01T15:00" }),
    ]);
    expect(out[0].unit_price).toBe(110);
  });

  it("lists the most recently bought first", () => {
    const out = latestPricesFrom([row("old", 1, "2026-01-01"), row("new", 1, "2026-10-01")]);
    expect(out.map((r) => r.item_id)).toEqual(["new", "old"]);
  });
});
