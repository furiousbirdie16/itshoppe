import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

// Chainable + thenable stand-in for the PostgREST builder. Every method returns
// itself, and awaiting anywhere in the chain yields an empty result set.
const query: any = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
      }
      return () => query;
    },
  },
);

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => query },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: "admin" }) }));
vi.mock("@/contexts/BranchContext", () => ({
  useBranch: () => ({ activeBranchId: null, activeBranch: null }),
}));

import BusinessInsightsPage from "./BusinessInsightsPage";

beforeAll(() => {
  // Radix (Select / Sheet) needs these; jsdom ships neither.
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView = () => {};
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
});

// An open Radix dialog marks the rest of the document aria-hidden. If a test
// ends with the drawer open, that attribute outlives cleanup and hides the next
// test's tree from role queries — so close it between tests.
afterEach(() => {
  fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
  document.querySelectorAll("[aria-hidden='true']").forEach((el) => el.removeAttribute("aria-hidden"));
});

/** `route` carries the query string, e.g. "/business-insights?item=SKU-1". */
function renderPage(route = "/business-insights") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[route]}>
      <QueryClientProvider client={client}>
        {/* The app root provides this; cards with explanations need it. */}
        <TooltipProvider>
          <BusinessInsightsPage />
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("BusinessInsightsPage", () => {
  it("renders the header and tab bar", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Business Insights" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Overview/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Products/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Customers/ })).toBeInTheDocument();
  });

  it("keeps the sales filters behind one drawer instead of an inline bar", () => {
    renderPage();
    // The toolbar shows only the range picker, the drawer trigger and export.
    expect(screen.getByRole("combobox", { name: "Date range" })).toHaveTextContent("Last 30 days");
    expect(screen.queryByText("All payments")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText("Sales source")).toBeInTheDocument();
    expect(within(drawer).getByText("Payment status")).toBeInTheDocument();
    expect(within(drawer).getByText("Category")).toBeInTheDocument();
    // Product type only affects the Products tab, so it lives there instead.
    expect(within(drawer).queryByText("Product type")).toBeNull();
  });

  it("badges the drawer trigger once a hidden filter is applied", () => {
    renderPage();
    expect(screen.queryByTestId("filter-count")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    const drawer = screen.getByRole("dialog");
    fireEvent.click(within(drawer).getByRole("button", { name: "Paid only" }));

    // Count is visible on the trigger so a filter can't stay applied unseen.
    expect(screen.getByTestId("filter-count").textContent).toBe("1");
  });

  it("clears every drawer filter from one control", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    const drawer = screen.getByRole("dialog");

    fireEvent.click(within(drawer).getByRole("button", { name: "Paid only" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Online only" }));
    expect(screen.getByTestId("filter-count").textContent).toBe("2");

    fireEvent.click(within(drawer).getByRole("button", { name: "Clear all" }));
    expect(screen.queryByTestId("filter-count")).toBeNull();
  });

  it("shows one pair of date pickers for a custom range", () => {
    renderPage();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Date range" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Custom range" }));

    const fromButtons = screen.getAllByRole("button", { name: "From" });
    expect(fromButtons).toHaveLength(1);

    fireEvent.click(fromButtons[0]);
    expect(screen.getAllByRole("grid")).toHaveLength(1);
  });

  // A "Sales History" link elsewhere in the app arrives with ?item=<sku>. It
  // used to land on today's Overview with the item nowhere in sight.
  it("opens on the product with its full history when linked to with ?item", () => {
    renderPage("/business-insights?item=SKU-42");
    expect(screen.getByRole("tab", { name: /Products/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByDisplayValue("SKU-42").length).toBeGreaterThan(0);
  });

  it("opens on Overview for the last 30 days when no item is linked", () => {
    renderPage();
    expect(screen.getByRole("tab", { name: /Overview/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox", { name: "Date range" })).toHaveTextContent("Last 30 days");
  });

  it("says so when nothing needs attention", () => {
    renderPage();
    expect(screen.getByText("Needs Attention")).toBeInTheDocument();
    expect(screen.getByText("Nothing needs attention right now.")).toBeInTheDocument();
  });

  it("offers a sort control on the Products tab so cards stay sortable without table headers", () => {
    renderPage();
    // Radix tabs activate on pointer-down, not click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Products/ }));

    // Product-only filters sit in the tab's own toolbar.
    expect(screen.getByRole("combobox", { name: "Product type" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Suggested action" })).toBeInTheDocument();

    // Direction toggle starts on the descending default and flips on tap.
    const dir = screen.getByRole("button", { name: /Desc/ });
    fireEvent.click(dir);
    expect(screen.getByRole("button", { name: /Asc/ })).toBeInTheDocument();
  });
});
