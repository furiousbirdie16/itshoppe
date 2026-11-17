import { describe, expect, it } from "vitest";
import { balanceAdjustment } from "./cash-ledger-forms";

describe("balanceAdjustment", () => {
  const base = { current: 150000, oldOpening: 0, newOpening: 0 };
  it("records the rise as an inflow", () => {
    expect(balanceAdjustment({ ...base, target: 160000 })).toEqual({ direction: "in", amount: 10000 });
  });
  it("records the drop as an outflow", () => {
    expect(balanceAdjustment({ ...base, target: 145500.5 })).toEqual({ direction: "out", amount: 4499.5 });
  });
  it("records nothing when the balance is unchanged", () => {
    expect(balanceAdjustment({ ...base, target: 150000 })).toBeNull();
  });
  it("allows for an opening balance changed in the same save", () => {
    // Opening up by 5,000 already lifts the balance to 155,000.
    expect(balanceAdjustment({ ...base, newOpening: 5000, target: 160000 })).toEqual({ direction: "in", amount: 5000 });
  });
});
