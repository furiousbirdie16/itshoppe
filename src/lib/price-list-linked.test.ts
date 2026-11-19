import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn() }));

import { isWalkIn, linkedPricesByItem } from "@/lib/price-list-api";

const lists = [
  { id: "new", brand: "NXT IT Shoppe", is_active: true },
  { id: "old", brand: "NXT IT Shoppe", is_active: false },
  { id: "hik", brand: "Hikvision", is_active: true },
];
const products = [
  { price_list_id: "old", model: "BNC Coupler", prices: { dp: 8, bottom: 9, srp: 9 } },
  { price_list_id: "new", model: "BNC COUPLER", prices: { dp: 8, bottom: 10, srp: 12 } },
  { price_list_id: "new", model: "No stock thing", prices: null },
  { price_list_id: "hik", model: "DS-2CE16D0T", prices: null, sdp: 2000 },
  { price_list_id: "hik", model: "DS-NOSTOCK", prices: null, sdp: null },
];

describe("linkedPricesByItem", () => {
  it("takes the prices from the brand's active list, matching names loosely", () => {
    const m = linkedPricesByItem([{ brand: " nxt it shoppe ", product: "bnc coupler", item_id: "i1" }], lists, products);
    expect(m.get("i1")).toEqual({ brand: "nxt it shoppe", product: "BNC COUPLER", bottom: 10, srp: 12, sdp: null });
  });
  it("carries SDP from a one-price list", () => {
    const m = linkedPricesByItem([{ brand: "Hikvision", product: "DS-2CE16D0T", item_id: "i3" }], lists, products);
    expect(m.get("i3")).toEqual({ brand: "Hikvision", product: "DS-2CE16D0T", bottom: null, srp: null, sdp: 2000 });
  });
  it("skips links with no price to offer", () => {
    const m = linkedPricesByItem(
      [
        { brand: "NXT IT Shoppe", product: "No stock thing", item_id: "i2" },
        { brand: "Hikvision", product: "DS-NOSTOCK", item_id: "i3" },
        { brand: "NXT IT Shoppe", product: "Renamed away", item_id: "i4" },
      ],
      lists,
      products,
    );
    expect(m.size).toBe(0);
  });
});

describe("isWalkIn", () => {
  it("is a walk-in with no customer, or a walk-in channel", () => {
    expect(isWalkIn(null)).toBe(true);
    expect(isWalkIn({ channel: "Walk-in" })).toBe(true);
    expect(isWalkIn({ channel: "Contractor" })).toBe(false);
    expect(isWalkIn({ channel: null })).toBe(false);
  });
});
