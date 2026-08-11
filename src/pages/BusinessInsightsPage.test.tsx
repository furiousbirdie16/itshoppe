import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BusinessInsightsPage />
    </QueryClientProvider>,
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

  it("keeps the secondary filters behind a drawer instead of inline on mobile", () => {
    const { container } = renderPage();

    // The mobile toolbar exposes only date presets, search and the drawer trigger.
    const mobileBar = container.querySelector(".md\\:hidden");
    expect(mobileBar).not.toBeNull();
    expect(within(mobileBar as HTMLElement).getByText("Today")).toBeInTheDocument();

    // Source / payment / category controls are not in the mobile toolbar.
    expect(within(mobileBar as HTMLElement).queryByText("All payments")).toBeNull();

    // They live in the drawer, which opens on demand.
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText("Sales source")).toBeInTheDocument();
    expect(within(drawer).getByText("Payment status")).toBeInTheDocument();
    expect(within(drawer).getByText("Product type")).toBeInTheDocument();
  });

  it("badges the drawer trigger once a hidden filter is applied", () => {
    renderPage();
    // Captured before opening: the trigger goes aria-hidden while the drawer is up.
    const trigger = screen.getByRole("button", { name: /filter/i });
    expect(trigger.textContent).toBe("");

    fireEvent.click(trigger);
    const drawer = screen.getByRole("dialog");
    fireEvent.click(within(drawer).getByRole("button", { name: "Paid only" }));

    // Count is visible on the trigger so a filter can't stay applied unseen.
    expect(trigger.textContent).toBe("1");
  });

  it("clears every drawer filter from one control", () => {
    renderPage();
    const trigger = screen.getByRole("button", { name: /filter/i });
    fireEvent.click(trigger);
    const drawer = screen.getByRole("dialog");

    fireEvent.click(within(drawer).getByRole("button", { name: "Paid only" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Online only" }));
    expect(trigger.textContent).toBe("2");

    fireEvent.click(within(drawer).getByRole("button", { name: "Clear all" }));
    expect(trigger.textContent).toBe("");
  });

  it("opens only the date picker that was tapped", () => {
    renderPage();
    // Custom range renders in both the desktop and the mobile toolbar, and both
    // stay mounted — only CSS hides one. Sharing open state made the hidden copy
    // dismiss the visible one the moment it took focus.
    fireEvent.click(screen.getAllByRole("button", { name: "Custom" })[0]);

    const fromButtons = screen.getAllByRole("button", { name: "From" });
    expect(fromButtons).toHaveLength(2);

    fireEvent.click(fromButtons[0]);
    expect(screen.getAllByRole("grid")).toHaveLength(1);
  });

  it("offers a sort control on the Products tab so cards stay sortable without table headers", () => {
    renderPage();
    // Radix tabs activate on pointer-down, not click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Products/ }));

    // Direction toggle starts on the descending default and flips on tap.
    const dir = screen.getByRole("button", { name: /Desc/ });
    fireEvent.click(dir);
    expect(screen.getByRole("button", { name: /Asc/ })).toBeInTheDocument();
  });
});
