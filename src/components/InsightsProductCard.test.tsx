import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InsightsProductCard } from "./InsightsProductCard";
import type { ProductMetric, SaleTxn } from "@/types/insights";

const product: ProductMetric = {
  key: "item-1|",
  itemId: "item-1",
  variationId: null,
  kind: "parent",
  name: "CAT6 Pure Copper Outdoor roll",
  sku: "CAT6-PC-OUT",
  variationLabel: null,
  source: "import",
  stock: 151,
  cost: 100,
  sellingPrice: 180,
  threshold: 20,
  qtySold: 12,
  revenue: 2160,
  totalCost: 1200,
  grossProfit: 960,
  margin: 44.4,
  dailySales: 2,
  daysRemaining: 75.5,
  gmroi: 1.8,
  avgInventoryValue: 533,
  action: "Maintain",
};

const txns: SaleTxn[] = [
  {
    date: "2026-08-08",
    customer: "Acme Corp",
    agent: "Jane",
    source: "invoice",
    reference: "INV-001",
    quantity: 5,
    unitPrice: 180,
    amount: 900,
    profit: 400,
    paymentStatus: "paid",
  },
  {
    date: "2026-08-07",
    customer: "Shopee",
    agent: "—",
    source: "online",
    reference: "ORD-77",
    quantity: 7,
    unitPrice: 180,
    amount: 1260,
    paymentStatus: "unpaid",
  },
];

const money = (n: number) => `₱${n.toLocaleString()}`;

describe("InsightsProductCard", () => {
  it("shows the money columns that the desktop table hides behind horizontal scroll", () => {
    render(
      <InsightsProductCard product={product} txns={txns} isAdmin money={money} isOpen={false} onToggle={() => {}} />,
    );

    expect(screen.getByText("CAT6 Pure Copper Outdoor roll")).toBeInTheDocument();
    expect(screen.getByText("CAT6-PC-OUT")).toBeInTheDocument();
    // Stock / Sold / Days left
    expect(screen.getByText("151")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("76")).toBeInTheDocument();
    // Revenue / GP / Margin
    expect(screen.getByText("₱2,160")).toBeInTheDocument();
    expect(screen.getByText("₱960")).toBeInTheDocument();
    expect(screen.getByText("44.4%")).toBeInTheDocument();
  });

  it("hides money figures from non-admins but keeps stock and units", () => {
    render(
      <InsightsProductCard product={product} txns={txns} isAdmin={false} money={money} isOpen={false} onToggle={() => {}} />,
    );

    expect(screen.getByText("151")).toBeInTheDocument();
    expect(screen.queryByText("Revenue")).not.toBeInTheDocument();
    expect(screen.queryByText("Gross profit")).not.toBeInTheDocument();
    expect(screen.queryByText("₱2,160")).not.toBeInTheDocument();
  });

  it("keeps sales history collapsed until tapped", () => {
    const onToggle = vi.fn();
    render(
      <InsightsProductCard product={product} txns={txns} isAdmin money={money} isOpen={false} onToggle={onToggle} />,
    );

    expect(screen.getByText("2 sales in range")).toBeInTheDocument();
    expect(screen.queryByText("INV-001")).not.toBeInTheDocument();

    const card = screen.getByRole("button", { name: /CAT6 Pure Copper Outdoor roll/ });
    expect(card).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(card);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders per-order history when expanded, flagging unpaid lines", () => {
    render(
      <InsightsProductCard product={product} txns={txns} isAdmin money={money} isOpen onToggle={() => {}} />,
    );

    expect(screen.getByText("INV-001")).toBeInTheDocument();
    expect(screen.getByText("ORD-77")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp · Jane")).toBeInTheDocument();
    // Online row has no agent, so no trailing separator.
    expect(screen.getByText("Shopee")).toBeInTheDocument();
    // Unpaid line is marked and its gross profit is deferred.
    expect(screen.getByText("₱1,260*")).toBeInTheDocument();
    expect(screen.getByText("Pending payment")).toBeInTheDocument();
  });

  it("marks low stock against the item's threshold", () => {
    const low: ProductMetric = { ...product, stock: 5 };
    const { container } = render(
      <InsightsProductCard product={low} txns={[]} isAdmin money={money} isOpen={false} onToggle={() => {}} />,
    );

    expect(container.querySelector(".text-destructive")?.textContent).toBe("5");
    expect(screen.getByText("0 sales in range")).toBeInTheDocument();
  });
});
