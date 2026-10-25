import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const branches = [
  { id: "gsn", branch_name: "Gen San", branch_code: "GSN", is_active: true },
  { id: "mnl", branch_name: "Manila", branch_code: "MNL", is_active: true },
];
vi.mock("@/integrations/supabase/client", () => {
  const q: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (res: any) => Promise.resolve({ data: branches, error: null }).then(res);
      return () => q;
    },
  });
  return { supabase: { from: () => q } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, role: "admin", loading: false }) }));

import { BranchProvider, useBranch } from "./BranchContext";

let api: ReturnType<typeof useBranch>;
function Probe() {
  api = useBranch();
  return <div data-testid="active">{api.loading ? "loading" : api.activeBranchId ?? "ALL"}</div>;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BranchProvider><Probe /></BranchProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("BranchProvider", () => {
  it("opens in the home branch", async () => {
    localStorage.setItem("home_branch_id", "mnl");
    mount();
    await waitFor(() => expect(screen.getByTestId("active").textContent).toBe("mnl"));
  });

  it("does not carry All branches over to the next visit", async () => {
    const first = mount();
    await waitFor(() => expect(screen.getByTestId("active").textContent).not.toBe("loading"));
    act(() => api.setActiveBranchId("gsn"));
    act(() => api.setActiveBranchId(null));
    expect(screen.getByTestId("active").textContent).toBe("ALL");
    first.unmount();

    // A new visit: the session is gone, the last single branch remains.
    sessionStorage.clear();
    mount();
    await waitFor(() => expect(screen.getByTestId("active").textContent).toBe("gsn"));
  });

  it("keeps All branches for the rest of this visit", async () => {
    const first = mount();
    await waitFor(() => expect(screen.getByTestId("active").textContent).not.toBe("loading"));
    act(() => api.setActiveBranchId(null));
    first.unmount();
    mount();
    await waitFor(() => expect(screen.getByTestId("active").textContent).toBe("ALL"));
  });

  it("remembers the home branch set with the star", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("active").textContent).not.toBe("loading"));
    act(() => api.setHomeBranchId("mnl"));
    expect(localStorage.getItem("home_branch_id")).toBe("mnl");
    expect(api.homeBranchId).toBe("mnl");
  });
});
