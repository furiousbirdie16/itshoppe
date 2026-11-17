import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn() }));

import { isWalkIn, linkedPricesByItem, linkedStartPrice } from "@/lib/price-list-api";

const lists = [
  { id: "new", brand: "NXT IT Shoppe", is_active: true },
  { id: "old", brand: "NXT IT Shoppe", is_active: false },
  { id: "hik", brand: "Hikvision", is_active: true },
];
const products = [
  { price_list_id: "old", model: "BNC Coupler", prices: { dp: 8, bottom: 9, srp: 9 } },
  { price_list_id: "new", model: "BNC COUPLER", prices: { dp: 8, bottom: 10, srp: 12 } },
  { price_list_id: "new", model: "No stock thing", prices: null },
  { price_list_id: "hik", model: "DS-2CE16D0T", prices: null },
];

describe("linkedPricesByItem", () => {
  it("takes the prices from the brand's active list, matching names loosely", () => {
    const m = linkedPricesByItem([{ brand: " nxt it shoppe ", product: "bnc coupler", item_id: "i1" }], lists, products);
    expect(m.get("i1")).toEqual({ brand: "nxt it shoppe", product: "BNC COUPLER", bottom: 10, srp: 12 });
  });
  it("skips links with no Bottom or SRP to offer", () => {
    const m = linkedPricesByItem(
      [
        { brand: "NXT IT Shoppe", product: "No stock thing", item_id: "i2" },
        { brand: "Hikvision", product: "DS-2CE16D0T", item_id: "i3" },
        { brand: "NXT IT Shoppe", product: "Renamed away", item_id: "i4" },
      ],
      lists,
      products,
    );
    expect(m.size).toBe(0);
  });
});

describe("start price", () => {
  const p = { brand: "x", product: "y", bottom: 10, srp: 12 };
  it("is SRP for walk-ins and Bottom for everyone else", () => {
    expect(linkedStartPrice(p, isWalkIn(null))).toBe(12);
    expect(linkedStartPrice(p, isWalkIn({ channel: "Walk-in" }))).toBe(12);
    expect(linkedStartPrice(p, isWalkIn({ channel: "Contractor" }))).toBe(10);
    expect(linkedStartPrice(p, isWalkIn({ channel: null }))).toBe(10);
  });
  it("falls back to the other price, and is null when not linked", () => {
    expect(linkedStartPrice({ ...p, srp: null }, true)).toBe(10);
    expect(linkedStartPrice({ ...p, bottom: null }, false)).toBe(12);
    expect(linkedStartPrice(undefined, false)).toBeNull();
  });
});
