import { describe, expect, it } from "vitest";
import { costFromRows } from "./branch-cost";

describe("costFromRows", () => {
  it("uses the one branch's own cost", () => {
    expect(costFromRows(100, [{ quantity: 5, cost_price: 120 }])).toBe(120);
  });
  it("falls back to the company cost when the branch has none", () => {
    expect(costFromRows(100, [{ quantity: 5, cost_price: null }])).toBe(100);
    expect(costFromRows(100, [])).toBe(100);
  });
  it("blends branches by stock held", () => {
    // 10 at 100 and 5 at 130 → 110
    expect(costFromRows(0, [{ quantity: 10, cost_price: 100 }, { quantity: 5, cost_price: 130 }])).toBe(110);
  });
  it("averages plainly when no branch holds stock, ignoring negative stock", () => {
    expect(costFromRows(0, [{ quantity: 0, cost_price: 100 }, { quantity: -3, cost_price: 120 }])).toBe(110);
  });
});
