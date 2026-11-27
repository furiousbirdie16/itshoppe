import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SaleLinesPanel, type SaleLine } from "./SaleLinesPanel";
import { peso } from "@/lib/currency";

const lines: SaleLine[] = [
  // 2 x 500 = 1000 sales, 600 cost -> 400 profit (40%)
  { id: "a", name: "Router", sku: "RT-1", quantity: 2, unitPrice: 500, lineCost: 600 },
  // 1 x 300 = 300 sales, 350 cost -> -50 profit
  { id: "b", name: "Cable", quantity: 1, unitPrice: 300, lineCost: 350 },
  // typed-in, no cost: in sales, out of profit
  { id: "c", name: "Labour", quantity: 1, unitPrice: 200, lineCost: null },
];

describe("SaleLinesPanel", () => {
  it("shows each line's profit and the order's total profit to admins", () => {
    const { container } = render(<SaleLinesPanel lines={lines} showProfit />);
    const text = container.textContent || "";
    expect(text).toContain(peso(400));
    expect(text).toContain("40.0%");
    expect(text).toContain(peso(-50));
    // Total profit 350 over the 1300 of costed sales; the typed-in line is excluded.
    expect(text).toContain(`Total profit ${peso(350)}`);
    expect(text).toContain("26.9%");
    expect(text).toContain(`Sales ${peso(1500)}`);
    expect(text).toContain("1 line has no cost");
  });

  it("shows no cost or profit at all without showProfit", () => {
    const { container } = render(<SaleLinesPanel lines={lines} />);
    const text = container.textContent || "";
    expect(text).toContain("Router");
    expect(text).not.toContain("Profit");
    expect(text).not.toContain("Cost");
    expect(text).not.toContain(peso(600));
  });
});
