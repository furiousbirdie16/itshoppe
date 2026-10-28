import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { describeEdit, previousAmount, type CashEdit } from "./cash-edits";

const edit = (changes: CashEdit["changes"], at = "2026-10-28T10:00:00Z"): CashEdit => ({
  id: at, transaction_id: "t1", edited_at: at, edited_by_email: "angela@x", changes,
});

describe("previousAmount", () => {
  it("is the amount before the latest amount change", () => {
    // newest first
    expect(previousAmount([
      edit({ amount: { from: 95, to: 90 } }, "2026-10-28T11:00:00Z"),
      edit({ amount: { from: 100, to: 95 } }, "2026-10-28T10:00:00Z"),
    ])).toBe(95);
  });
  it("skips edits that did not touch the amount", () => {
    expect(previousAmount([edit({ notes: { from: "a", to: "b" } }), edit({ amount: { from: 100, to: 90 } })])).toBe(100);
  });
  it("is null when the amount never changed", () => {
    expect(previousAmount([edit({ payee: { from: "A", to: "B" } })])).toBeNull();
    expect(previousAmount(undefined)).toBeNull();
  });
});

describe("describeEdit", () => {
  it("says each change in words", () => {
    const lines = describeEdit(
      edit({ amount: { from: 100, to: 90 }, account_id: { from: "a1", to: "a2" }, notes: { from: "", to: "fixed" } }),
      { amount: (n) => `₱${n}`, account: (id) => ({ a1: "BDO", a2: "BPI" } as Record<string, string>)[id] },
    );
    expect(lines).toEqual(["Amount: ₱100 → ₱90", "Account: BDO → BPI", "Notes: — → fixed"]);
  });
});
