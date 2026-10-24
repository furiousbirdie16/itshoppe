import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { format, subDays } from "date-fns";

const daysAgo = (n: number) => format(subDays(new Date(), n), "yyyy-MM-dd");

// 2 units a day for the last 90 days, through online sales only.
const online = Array.from({ length: 90 }, (_, i) => ({
  id: `o${i}`, order_date: daysAgo(i + 1), quantity: 2, posted_price: 100, item_id: "i1", variation_id: null,
}));
const tables: Record<string, any[]> = {
  online_sales: online,
  item_suppliers: [{ id: "l1", item_id: "i1", supplier_id: "s1", overseas_supplier_id: null, is_primary: true, lead_time_days: 10, moq: 0 }],
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

import { InsightsForecastTab } from "./InsightsForecastTab";

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
});

function renderTab(stock: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const items = [{ id: "i1", name: "Router", sku: "RT-1", quantity: stock, cost_price: 60, created_at: "2024-01-01" }];
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <InsightsForecastTab branchId={null} isAdmin={false} money={() => "—"} items={items} variations={[]} allowedItemIds={null} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("InsightsForecastTab reorder planner", () => {
  it("suggests enough for lead time, safety stock and the horizon, less stock on hand", async () => {
    renderTab(20);
    // 2/day × (10 lead + 7 safety + 30 horizon) = 94, less 20 in stock = 74.
    const row = (await screen.findByText("Router")).closest("tr")!;
    expect(within(row).getByText("74")).toBeInTheDocument();
    // 20 units at 2/day lasts 10 days — under the 17-day lead + safety, so order now.
    expect(within(row).getByText("Now")).toBeInTheDocument();
  });

  it("leaves out items whose stock already covers the horizon", async () => {
    renderTab(500);
    expect(await screen.findByText(/covers the next 30 days for every selling item/)).toBeInTheDocument();
    expect(screen.queryByText("Router")).toBeNull();
  });
});
