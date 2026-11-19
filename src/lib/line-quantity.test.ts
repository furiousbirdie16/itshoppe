import { describe, it, expect } from "vitest";
import { parseQty, parsePrice, needsWholeQty, wholeQtyError } from "./line-quantity";

const variations = [{ id: "cut1", type: "cut" }, { id: "pack1", type: "pack" }];

describe("line quantities", () => {
  it("parses decimals", () => {
    expect(parseQty("2.5")).toBe(2.5);
    expect(parseQty("0.1")).toBe(0.1);
    expect(parseQty("1.23456")).toBe(1.235);
    expect(parseQty("")).toBe(0);
    expect(parsePrice("12.555")).toBe(12.56);
    expect(parsePrice("12.5")).toBe(12.5);
  });
  it("whole only for stocked pieces and packs", () => {
    expect(needsWholeQty({ item_id: "i", variation_id: null }, variations)).toBe(true);
    expect(needsWholeQty({ item_id: "i", variation_id: "pack1" }, variations)).toBe(true);
    expect(needsWholeQty({ item_id: "i", variation_id: "cut1" }, variations)).toBe(false);
    expect(needsWholeQty({ item_id: "", variation_id: null }, variations)).toBe(false);
  });
  it("explains a decimal on a whole-only line", () => {
    expect(wholeQtyError("Cable", 2.5, true)).toContain("whole pieces");
    expect(wholeQtyError("Cable", 2, true)).toBeNull();
    expect(wholeQtyError("Labor", 2.5, false)).toBeNull();
  });
});
