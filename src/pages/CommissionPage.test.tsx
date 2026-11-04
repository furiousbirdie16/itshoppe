import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { CommissionLine } from "@/lib/commission-api";

vi.mock("@/components/InvoiceDetailsDialog", () => ({ default: () => null }));

const line = (over: Partial<CommissionLine>): CommissionLine => ({
  invoice_id: "inv1", invoice_number: "INV--01320", invoice_date: "2026-10-30", paid_on: "2026-11-02",
  customer: "Juan", payment_method: "GCash", payment_account: "GCash", line_id: Math.random().toString(),
  item_id: "it1", item_name: "Shelf", category: null, quantity: 1, unit_price: 100, dp: 100, dp2: 95,
  code: "N", rate: 5, sales: 100, commission: 5, problems: [], ...over,
});

let closing: unknown = null;
const lines: CommissionLine[] = [
  line({ code: "N", sales: 200, quantity: 2, commission: 10 }),
  line({ code: "BD2", unit_price: 94, sales: 94, rate: 2, commission: 1.88, item_name: "Cheap shelf" }),
  line({ code: "B", category: "Brands", sales: 1000, rate: 0.5, commission: 5, item_name: "Hikvision cam" }),
  line({ code: null, rate: null, dp: null, dp2: null, sales: 120, commission: 0, item_name: "BNC Coupler", problems: ["no_dp"] }),
];

vi.mock("@/lib/commission-api", () => ({
  getCommissionAgents: async () => [
    { id: "g", name: "Geraldine", earns_commission: true, petty_cash_account_id: null },
    { id: "j", name: "Jomar", earns_commission: false, petty_cash_account_id: null },
  ],
  getCommissionLines: async () => lines,
  getCommissionAdjustments: async () => [
    { id: "a1", agent_id: "g", month: "2026-11-01", label: "Jason ticket 2x", amount: -5, created_at: "" },
  ],
  getCommissionClosing: async () => closing,
  getUnassignedInvoices: async () => [],
  addCommissionAdjustment: vi.fn(), deleteCommissionAdjustment: vi.fn(),
  closeCommissionMonth: vi.fn(), reopenCommissionMonth: vi.fn(),
}));

import CommissionPage from "./CommissionPage";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><CommissionPage /></MemoryRouter>
    </QueryClientProvider>,
  );

describe("CommissionPage", () => {
  beforeEach(() => { closing = null; });

  it("adds up the month by code, takes off deductions, and flags what was not counted", async () => {
    renderPage();
    expect(await screen.findByText(/^Geraldine · /)).toBeTruthy();
    const total = await screen.findByText("This month's commission");
    // 10 + 1.88 + 5 = 16.88 commission, less 5 = 11.88.
    expect(within(total.closest("tr")!).getByText("₱11.88")).toBeTruthy();
    expect(screen.getByText("₱16.88")).toBeTruthy();
    expect(screen.getByText("Not counted")).toBeTruthy();
    expect(screen.getAllByText(/No DP and no commission category/).length).toBe(1);
    // Only agents who earn commission are offered.
    expect(screen.queryByText("Jomar")).toBeNull();
  });

  it("shows the lines behind a code when it is clicked", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("BD2"));
    expect(await screen.findByText("Cheap shelf")).toBeTruthy();
    expect(screen.getAllByText("INV-01320").length).toBeGreaterThan(0);
  });

  it("shows the saved figures, and says so, once the month is closed", async () => {
    closing = {
      agent_id: "g", month: "2026-11-01", sales: 100, commission: 5, adjustments: 0, total: 5,
      summary: [], lines: [line({})], adjustment_lines: [], closed_at: "2026-11-30T10:00:00Z", closed_by_email: "boss@x",
    };
    renderPage();
    expect(await screen.findByText("Closed")).toBeTruthy();
    expect(screen.getByText("Reopen month")).toBeTruthy();
    // Live invoices (16.88) no longer match what was saved (5.00).
    expect(await screen.findByText(/The invoices have changed since this month was closed/)).toBeTruthy();
  });
});
