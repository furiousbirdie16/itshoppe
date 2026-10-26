import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { bundleProblems, expandBundle, skuKey } from "./sku-bundles";

const crimped = {
  sku: "CAT6 Pure Copper Indoor 100m w/ crimp",
  lines: [
    { item_id: "cable", variation_id: "cut-100", quantity: 1, gets_price: true, variation_sku: "cat6 pure copper 100m" },
    { item_id: "rj45", variation_id: null, quantity: 2, gets_price: false, item_sku: "RJ45 Passthrough 1s" },
  ],
};

describe("expandBundle", () => {
  it("puts the whole price on the priced part and ₱0 on the rest", () => {
    expect(expandBundle(crimped, 1, 2500)).toEqual([
      { item_id: "cable", variation_id: "cut-100", quantity: 1, unitPrice: 2500, label: "cat6 pure copper 100m" },
      { item_id: "rj45", variation_id: null, quantity: 2, unitPrice: 0, label: "RJ45 Passthrough 1s" },
    ]);
  });

  it("multiplies the parts by the quantity ordered", () => {
    const [cable, rj45] = expandBundle(crimped, 3, 2500);
    expect(cable.quantity).toBe(3);
    expect(cable.unitPrice).toBe(2500);
    expect(rj45.quantity).toBe(6);
  });

  it("keeps the line total right when the priced part is more than one unit", () => {
    const twoCables = { sku: "x", lines: [{ item_id: "c", variation_id: null, quantity: 2, gets_price: true }] };
    const [line] = expandBundle(twoCables, 1, 1000);
    expect(line.quantity).toBe(2);
    expect(line.quantity * line.unitPrice).toBe(1000);
  });

  it("prices the first part when none is marked", () => {
    const unmarked = { sku: "x", lines: crimped.lines.map((l) => ({ ...l, gets_price: false })) };
    expect(expandBundle(unmarked, 1, 99).map((l) => l.unitPrice)).toEqual([99, 0]);
  });

  it("is a plain rename with one part", () => {
    const alias = { sku: "Shopee name", lines: [{ item_id: "i", variation_id: null, quantity: 1, gets_price: true, item_sku: "OUR-SKU" }] };
    expect(expandBundle(alias, 4, 50)).toEqual([{ item_id: "i", variation_id: null, quantity: 4, unitPrice: 50, label: "OUR-SKU" }]);
  });
});

describe("bundleProblems", () => {
  it("accepts a complete bundle", () => {
    expect(bundleProblems(crimped)).toEqual([]);
  });
  it("names what is missing", () => {
    expect(bundleProblems({ sku: " ", lines: [] })).toEqual(["Enter the SKU", "Add at least one item"]);
    expect(bundleProblems({ sku: "x", lines: [{ item_id: "a", variation_id: null, quantity: 0, gets_price: true }] }))
      .toEqual(["Every item needs a quantity above 0"]);
  });
});

describe("skuKey", () => {
  it("ignores case and spacing", () => {
    expect(skuKey("  CAT6  Pure Copper ")).toBe(skuKey("cat6 pure copper"));
  });
});
