import { describe, it, expect } from "vitest";
import { applyVariationDelta } from "./variations";

const roll = (quantity: number, open = 0, perStock = 305) => ({
  quantity,
  open_roll_remaining: open,
  units_per_stock: perStock,
});
const cut = (factor: number) => ({ type: "cut" as const, factor });
const pack = (factor: number) => ({ type: "pack" as const, factor });

/** Total metres however it is split between whole rolls and an open one. */
const metres = (s: { quantity: number; open_roll_remaining: number }, perStock = 305) =>
  s.quantity * perStock + s.open_roll_remaining;

describe("applyVariationDelta — cut", () => {
  it("draws from the open roll before touching a whole one", () => {
    expect(applyVariationDelta(roll(10, 200), cut(1), 50)).toEqual({
      quantity: 10,
      open_roll_remaining: 150,
    });
  });

  it("opens a new roll when the open one runs out", () => {
    expect(applyVariationDelta(roll(10, 20), cut(1), 50)).toEqual({
      quantity: 9,
      open_roll_remaining: 275,
    });
  });

  // INV--01354: the item stood at -9 rolls after an earlier oversell, a 5m cut
  // was sold, and the stock came back as 0 — nine rolls conjured out of a
  // clamp. A sale must never raise the stock.
  it("does not invent stock when selling from an already negative balance", () => {
    const before = roll(-9, 0);
    const after = applyVariationDelta(before, cut(1), 5);
    expect(after.quantity).toBeLessThan(0);
    expect(metres(after)).toBe(metres(before) - 5);
  });

  it("goes negative rather than stopping at zero, as a plain sale does", () => {
    const before = roll(0, 0);
    const after = applyVariationDelta(before, cut(1), 10);
    expect(metres(after)).toBe(-10);
  });

  it("keeps the total metres exact across a sale that spans several rolls", () => {
    const before = roll(3, 100);
    const after = applyVariationDelta(before, cut(1), 700);
    expect(metres(after)).toBe(metres(before) - 700);
  });

  it("puts a return back, closing whole rolls as they fill", () => {
    const before = roll(2, 300);
    const after = applyVariationDelta(before, cut(1), -10);
    expect(after).toEqual({ quantity: 3, open_roll_remaining: 5 });
    expect(metres(after)).toBe(metres(before) + 10);
  });

  it("reverses a sale exactly", () => {
    const before = roll(4, 50);
    const sold = applyVariationDelta(before, cut(2), 30);     // 60m out
    const restored = applyVariationDelta(
      { ...sold, units_per_stock: 305 },
      cut(2),
      -30,
    );
    expect(restored).toEqual({ quantity: before.quantity, open_roll_remaining: before.open_roll_remaining });
  });

  it("does nothing at all for a zero quantity", () => {
    expect(applyVariationDelta(roll(5, 120), cut(1), 0)).toEqual({
      quantity: 5,
      open_roll_remaining: 120,
    });
  });
});

describe("applyVariationDelta — pack", () => {
  it("deducts the whole pack from stock", () => {
    expect(applyVariationDelta(roll(50, 0, 1), pack(5), 3)).toEqual({
      quantity: 35,
      open_roll_remaining: 0,
    });
  });
});
