import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import InventoryMobileCard from "./InventoryMobileCard";

const noop = vi.fn();
const handlers = {
  onToggleSelect: noop, onTransfer: noop, onAdjust: noop, onHistory: noop, onSuppliers: noop,
  onBundles: noop, onEdit: noop, onArchive: noop, onRestore: noop, onDelete: noop,
};
const item = { id: "i1", name: "DC Male", sku: "DC-M", quantity: 10, low_stock_threshold: 5, base_unit: "pcs", cost_price: 5, selling_price: 12, source: "local" };

describe("InventoryMobileCard", () => {
  it("shows incoming and reserved stock, as the desktop table does", () => {
    render(<InventoryMobileCard item={{ ...item, incoming_quantity: 52, reserved_quantity: 3 }} branchLabel="MNL" isAdmin viewArchived={false} selected={false} {...handlers} />);
    expect(screen.getByText("Incoming")).toBeInTheDocument();
    expect(screen.getByText("52")).toBeInTheDocument();
    expect(screen.getByText("on order")).toBeInTheDocument();
    expect(screen.getByText("Reserved")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows a dash when nothing is coming or held", () => {
    render(<InventoryMobileCard item={{ ...item, incoming_quantity: 0, reserved_quantity: 0 }} branchLabel="MNL" isAdmin viewArchived={false} selected={false} {...handlers} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});
