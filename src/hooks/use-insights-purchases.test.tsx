import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Per-table rows; the builder ignores filters except `eq`, which these tests do not rely on.
const tables: Record<string, any[]> = {
  purchase_orders: [
    { id: "po1", po_number: "PO-1", order_date: "2026-09-01", expected_delivery: "2026-09-08", status: "sent", supplier_id: "s1", total_amount: 1000, total_additional_charges: 50 },
    { id: "po2", po_number: "PO-2", order_date: "2026-08-01", expected_delivery: "2026-08-05", status: "received", supplier_id: "s1", total_amount: 500, total_additional_charges: 0 },
  ],
  purchase_order_items: [
    // Half received: the other 5 are on order and owed (local POs are paid on receipt).
    { id: "a", po_id: "po1", item_id: "i1", item_name: "Cable", quantity: 10, received_quantity: 5, unit_cost: 100, received_date: "2026-09-10" },
    { id: "b", po_id: "po2", item_id: "i1", item_name: "Cable", quantity: 5, received_quantity: 5, unit_cost: 100, received_date: "2026-08-05" },
  ],
  overseas_purchase_orders: [
    { id: "o1", po_number: "OPO-1", order_date: "2026-09-01", status: "unpaid", supplier_id: "os1", total_amount: 100, total_additional_charges: 0, exchange_rate: 50 },
    { id: "o2", po_number: "OPO-2", order_date: "2026-09-01", status: "shipped", supplier_id: "os1", total_amount: 100, total_additional_charges: 0, exchange_rate: 50 },
  ],
  overseas_purchase_order_items: [
    { id: "c", po_id: "o1", item_id: "i2", item_name: "AP", quantity: 4, received_quantity: 0, unit_cost: 25, received_date: null },
    { id: "d", po_id: "o2", item_id: "i2", item_name: "AP", quantity: 4, received_quantity: 0, unit_cost: 25, received_date: null },
  ],
  overseas_po_payments: [{ id: "p", po_id: "o1", php_amount: 2000 }],
  suppliers: [{ id: "s1", name: "Local Co" }],
  overseas_suppliers: [{ id: "os1", name: "Overseas Co" }],
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

import { useInsightsPurchases } from "./use-insights-purchases";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useInsightsPurchases", () => {
  it("converts overseas orders to pesos and counts only unreceived goods as still to arrive", async () => {
    const { result } = renderHook(() => useInsightsPurchases(null), { wrapper });
    await waitFor(() => expect(result.current.orders).toHaveLength(4));
    const po1 = result.current.orders.find((o) => o.id === "po1")!;
    expect(po1.supplier).toBe("Local Co");
    expect(po1.remainingUnits).toBe(5);
    expect(po1.remainingPhp).toBe(500);
    const o1 = result.current.orders.find((o) => o.id === "o1")!;
    expect(o1.goodsPhp).toBe(5000);
    expect(o1.remainingPhp).toBe(5000);
    // A received PO has nothing left to arrive.
    expect(result.current.orders.find((o) => o.id === "po2")!.remainingUnits).toBe(0);
  });

  it("follows the dashboard's payables rule: local unreceived goods, overseas unpaid less deposits", async () => {
    const { result } = renderHook(() => useInsightsPurchases(null), { wrapper });
    await waitFor(() => expect(result.current.orders).toHaveLength(4));
    const owed = Object.fromEntries(result.current.orders.map((o) => [o.id, o.owedPhp]));
    expect(owed).toEqual({ po1: 500, po2: 0, o1: 3000, o2: 0 });
  });

  it("totals units on order per item and measures supplier lead time from received lines", async () => {
    const { result } = renderHook(() => useInsightsPurchases(null), { wrapper });
    await waitFor(() => expect(result.current.orders).toHaveLength(4));
    expect(result.current.onOrderByItem.get("i1")).toBe(5);
    expect(result.current.onOrderByItem.get("i2")).toBe(8);
    // 9 days (Sep 1 → Sep 10, late against Sep 8) and 4 days (Aug 1 → Aug 5, on time).
    expect(result.current.leadTimeBySupplier.get("s1")).toEqual({ avgDays: 6.5, onTimePct: 50 });
  });
});
