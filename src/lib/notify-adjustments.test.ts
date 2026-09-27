import { describe, it, expect, vi, beforeEach } from "vitest";

// The notifier posts to Telegram through the supabase client; the test is about
// what it does with the ids it is handed, so the transport is stubbed out.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() }, auth: { getUser: vi.fn(), getSession: vi.fn() } },
}));

import { notifyInventoryAdjustments } from "./api";

describe("notifyInventoryAdjustments", () => {
  beforeEach(() => vi.clearAllMocks());

  // Editing an item without changing its quantities produced no movements, and
  // setBranchQuantities used to answer that with undefined — which crashed the
  // save with "Cannot read properties of undefined (reading 'filter')" after
  // the item had already been written.
  it("survives being handed nothing", () => {
    expect(() => notifyInventoryAdjustments(undefined)).not.toThrow();
    expect(() => notifyInventoryAdjustments(null)).not.toThrow();
    expect(() => notifyInventoryAdjustments([])).not.toThrow();
  });

  it("survives a list with holes in it", () => {
    expect(() => notifyInventoryAdjustments(["" as string])).not.toThrow();
  });
});
