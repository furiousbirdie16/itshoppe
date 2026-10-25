import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OverseasPOItemsBreakdown } from "./OverseasPOItemsBreakdown";

const items = [
  { id: "a", item_id: "i1", item_name: "CAT6 Roll", description: "305m box", quantity: 20, received_quantity: 8, unit_cost: 48, items: { sku: "CAT6-1" }, received_date: "2026-10-22" },
  { id: "b", item_id: null, item_name: "Sample fee", quantity: 1, received_quantity: 0, unit_cost: 10 },
];

describe("OverseasPOItemsBreakdown", () => {
  it("shows what is still to come per product", () => {
    render(<OverseasPOItemsBreakdown items={items} currency="USD" exchangeRate={57} isAdmin />);
    // Phone card and desktop table both render (CSS picks one).
    expect(screen.getAllByText("12 to come").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not stocked").length).toBeGreaterThan(0);
    // 20 × $48 × 57
    expect(screen.getAllByText(/54,720/).length).toBeGreaterThan(0);
  });

  it("keeps costs from staff", () => {
    render(<OverseasPOItemsBreakdown items={items} currency="USD" exchangeRate={57} isAdmin={false} />);
    expect(screen.queryByText(/54,720/)).toBeNull();
    expect(screen.queryByText("PHP value")).toBeNull();
  });
});
