import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn() }));

import { startingListId } from "./PriceListSearch";

// Newest first, as the page lists them.
const active = [
  { id: "hik", brand: "Hikvision" },
  { id: "own-new", brand: "NXT IT Shoppe" },
  { id: "own-old", brand: "NXT IT Shoppe" },
];

describe("startingListId", () => {
  it("opens the newest list of the brand last looked at", () => {
    expect(startingListId(active, "NXT IT Shoppe")).toBe("own-new");
    expect(startingListId(active, " nxt it shoppe ")).toBe("own-new");
  });
  it("opens the newest list when nothing is remembered, or that brand is gone", () => {
    expect(startingListId(active, "")).toBe("hik");
    expect(startingListId(active, "Dahua")).toBe("hik");
  });
  it("is empty with no lists", () => {
    expect(startingListId([], "Hikvision")).toBe("");
  });
});
