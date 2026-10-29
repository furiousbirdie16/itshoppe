import { describe, it, expect } from "vitest";
import { niceTicks } from "./chart-ticks";

describe("niceTicks", () => {
  it("uses round steps and ends above the maximum", () => {
    expect(niceTicks(0, 248_148)).toEqual([0, 100_000, 200_000, 300_000]);
    expect(niceTicks(0, 5_100_000)).toEqual([0, 2_000_000, 4_000_000, 6_000_000]);
  });

  it("reaches below zero when the data does", () => {
    expect(niceTicks(-115_460, 300_000)).toEqual([-200_000, 0, 200_000, 400_000]);
  });

  it("never puts the top tick on the maximum", () => {
    expect(niceTicks(0, 200).at(-1)).toBeGreaterThan(200);
  });
});
