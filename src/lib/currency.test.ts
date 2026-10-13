import { describe, it, expect, afterEach } from "vitest";
import { peso, setAmountsHidden, areAmountsHidden } from "./currency";
import { foreignAmount } from "./fx";

afterEach(() => setAmountsHidden(false));

describe("peso", () => {
  it("formats pesos with two decimals and separators", () => {
    expect(peso(1234567.5)).toBe("₱1,234,567.50");
  });

  // The point of masking at the formatter: a page cannot forget to do it.
  it("blanks the figure when amounts are hidden", () => {
    setAmountsHidden(true);
    expect(peso(1234567.5)).toBe("₱••••");
    expect(peso(0)).toBe("₱••••");
  });

  it("gives the figure back when shown again", () => {
    setAmountsHidden(true);
    setAmountsHidden(false);
    expect(peso(12)).toBe("₱12.00");
  });

  it("reports which way it is set", () => {
    expect(areAmountsHidden()).toBe(false);
    setAmountsHidden(true);
    expect(areAmountsHidden()).toBe(true);
  });
});

describe("foreignAmount", () => {
  it("formats a foreign balance with its symbol", () => {
    expect(foreignAmount(8059.92, "RMB")).toBe("¥8,059.92");
  });

  // A yuan balance gives away as much as a peso one.
  it("is hidden alongside pesos", () => {
    setAmountsHidden(true);
    expect(foreignAmount(8059.92, "RMB")).toBe("¥••••");
  });
});
