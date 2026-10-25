import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { format, subDays } from "date-fns";

const daysAgo = (n: number) => format(subDays(new Date(), n), "yyyy-MM-dd");

const items = [
  // Sells 3 a day with 30 in stock: runs out long before a 30-day default lead time.
  { id: "fast", name: "Patch Cord", sku: "PC-1", quantity: 30, low_stock_threshold: 0, cost_price: 35, base_unit: "pcs", units_per_stock: 1, created_at: "2024-01-01", source: "local" },
  // Below its minimum, nothing sells: watch it.
  { id: "idle", name: "HDMI Cable", sku: "HD-1", quantity: 2, low_stock_threshold: 5, cost_price: 220, base_unit: "pcs", units_per_stock: 1, created_at: "2024-01-01", source: "local" },
  // 3 left against a minimum of 500, 300 on order: On order, with a top-up to come.
  { id: "balun", name: "Video Balun", sku: "VB-1", quantity: 3, low_stock_threshold: 500, cost_price: 26, base_unit: "pcs", units_per_stock: 1, created_at: "2024-01-01", source: "import" },
  // Plenty of stock: not listed at all.
  { id: "fine", name: "Connectors", sku: "RJ-1", quantity: 900, low_stock_threshold: 10, cost_price: 1, base_unit: "pcs", units_per_stock: 1, created_at: "2024-01-01", source: "local" },
];
const online = Array.from({ length: 60 }, (_, i) => ({
  item_id: "fast", variation_id: null, quantity: 3, deal_price: 90, order_date: daysAgo(i + 1), status: "completed",
}));
const balunSales = Array.from({ length: 90 }, (_, i) => ({
  item_id: "balun", variation_id: null, quantity: 6, deal_price: 40, order_date: daysAgo(i + 1), status: "completed",
}));
const tables: Record<string, any[]> = {
  online_sales: [...online, ...balunSales].map((r, i) => ({ id: `o${i}`, order_number: `ORD-${i}`, ...r })),
  overseas_purchase_orders: [{ id: "opo", po_number: "OPO-9", order_date: daysAgo(20), expected_delivery: daysAgo(-10), status: "shipped", supplier_id: null, total_amount: 0, exchange_rate: 1 }],
  overseas_purchase_order_items: [{ id: "l", po_id: "opo", item_id: "balun", item_name: "Video Balun", quantity: 300, received_quantity: 0, unit_cost: 0.4, received_date: null }],
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const b: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") return (res: any) => Promise.resolve({ data: tables[table] || [], error: null }).then(res);
          if (prop === "range") return (from: number) => (from === 0 ? b : { then: (res: any) => Promise.resolve({ data: [], error: null }).then(res) });
          return () => b;
        },
      });
      return b;
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: "admin" }) }));
vi.mock("@/lib/api", () => ({
  getItemsWithStock: async () => items,
  createPurchaseOrder: vi.fn(), createPOItems: vi.fn(), generatePONumber: vi.fn(),
  createOverseasPurchaseOrder: vi.fn(), createOverseasPOItems: vi.fn(), generateOverseasPONumber: vi.fn(),
}));
vi.mock("@/lib/itemSuppliers", () => ({
  listItemSuppliersForItems: async () => new Map(),
  upsertItemSupplier: vi.fn(),
}));
vi.mock("@/components/ItemHistoryDialog", () => ({ default: () => null }));
vi.mock("@/components/CostHistoryDialog", () => ({ default: () => null }));

import LowStockAlertsPage from "./LowStockAlertsPage";

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  Element.prototype.scrollIntoView = () => {};
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LowStockAlertsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Reorder List", () => {
  it("groups items into Order now / On order / Watch and leaves healthy stock out", async () => {
    renderPage();
    const table = await screen.findByRole("table");
    expect(await within(table).findByText("Patch Cord")).toBeInTheDocument();
    expect(within(table).queryByText("HDMI Cable")).toBeNull();
    expect(screen.queryAllByText("Connectors")).toHaveLength(0);

    fireEvent.click(screen.getByRole("tab", { name: /Watch/ }));
    expect(within(screen.getByRole("table")).getByText("HDMI Cable")).toBeInTheDocument();
  });

  it("lists an item below its minimum with an order coming under On order, with the top-up still to order", async () => {
    renderPage();
    const table = await screen.findByRole("table");
    await within(table).findByText("Patch Cord");
    expect(within(table).queryByText("Video Balun")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /On order/ }));
    const onOrder = screen.getByRole("table");
    expect(within(onOrder).getByText("Video Balun")).toBeInTheDocument();
    // 500 minimum − 3 in stock − 300 coming.
    expect(within(onOrder).getByText(/order 197 more by/)).toBeInTheDocument();
  });

  it("flags the 30-day default lead time when no supplier lead time is known", async () => {
    renderPage();
    expect(await screen.findByText(/use the 30-day default lead time|uses the 30-day default lead time/)).toBeInTheDocument();
  });

  it("opens the PO form for just that item from its Order button", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Order Patch Cord" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Create Purchase Orders")).toBeInTheDocument();
    expect(within(dialog).getByText("Patch Cord")).toBeInTheDocument();
  });
});
