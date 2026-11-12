import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

const accounts = [{ id: "bdo", name: "BDO", account_type: "bank", currency: "PHP", opening_balance: 0, sort_order: 1, is_active: true }];
const txns = Array.from({ length: 250 }, (_, i) => ({
  id: `t${i}`, account_id: "bdo", txn_date: "2026-11-01", created_at: "2026-11-01T00:00:00Z", direction: "out",
  amount: 100, category: "Rent", payee: `Payee ${i}`, reference: "", notes: "", cash_accounts: { name: "BDO" },
}));
const tables: Record<string, any[]> = { cash_accounts: accounts, cash_transactions: txns };

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
    auth: { getUser: async () => ({ data: { user: null } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: "admin", user: { id: "u1", email: "a@b.c" } }) }));

import { CashLedger } from "./CashLedger";

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
});

function renderLedger(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <CashLedger accountType="bank" title="Bank" description="" showAccountFilter />
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("CashLedger", () => {
  it("puts 100 lines on screen at a time, and only the layout for the screen", async () => {
    renderLedger(390);
    await screen.findByText("Payee 0");
    // One copy each: the hidden desktop table is not built on a phone.
    expect(screen.getAllByText("Payee 0")).toHaveLength(1);
    expect(screen.queryByText("Payee 100")).toBeNull();
    expect(screen.getByText("Showing 100 of 250")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Payee 150")).toBeInTheDocument();
  });

  it("builds the table on a wide screen", async () => {
    renderLedger(1280);
    await screen.findByText("Payee 0");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByText("Payee 0")).toHaveLength(1);
  });
});
