import { describe, it, expect } from "vitest";
import { replayFx, fxPosition } from "./fx";
import type { CashTransaction } from "@/types/database";

let seq = 0;
const txn = (o: Partial<CashTransaction>): CashTransaction =>
  ({
    id: `t${seq++}`,
    account_id: "alipay",
    txn_date: "2026-10-01",
    direction: "in",
    amount: 0,
    fx_rate: null,
    created_at: `2026-10-01T00:00:${String(seq).padStart(2, "0")}Z`,
    ...o,
  }) as CashTransaction;

describe("replayFx", () => {
  it("averages the rates paid across top-ups", () => {
    const { quantity, averageRate } = fxPosition([
      txn({ direction: "in", amount: 1000, fx_rate: 9.0 }),
      txn({ direction: "in", amount: 1000, fx_rate: 9.1 }),
    ]);
    expect(quantity).toBe(2000);
    expect(averageRate).toBe(9.05);
  });

  it("values a spend at the average in force", () => {
    const steps = replayFx([
      txn({ direction: "in", amount: 1000, fx_rate: 9.0 }),
      txn({ direction: "out", amount: 400 }),
    ]);
    expect(steps[1].phpAmount).toBe(3600);
    expect(steps[1].quantity).toBe(600);
  });

  // The Alipay case: spends entered before the deposit that covered them, so
  // the account dips below zero. Clamping at zero made a later ¥10,000 read as
  // ¥10,000 held rather than ¥9,241.92 — currency out of nowhere.
  it("does not invent currency when a deposit is entered late", () => {
    const { quantity } = fxPosition([
      txn({ direction: "in", amount: 15_484.92, fx_rate: 9.5 }),
      txn({ direction: "out", amount: 74 }),
      txn({ direction: "out", amount: 12_750 }),
      txn({ direction: "out", amount: 1_207 }),
      txn({ direction: "out", amount: 2_286 }),
      txn({ direction: "in", amount: 10_000, fx_rate: 9.58 }),
    ]);
    expect(quantity).toBeCloseTo(9_167.92, 2);
  });

  it("carries a negative holding rather than resetting it", () => {
    const steps = replayFx([
      txn({ direction: "in", amount: 100, fx_rate: 9 }),
      txn({ direction: "out", amount: 250 }),
    ]);
    expect(steps[1].quantity).toBe(-150);
  });

  it("recovers the right balance once the money is in", () => {
    const { quantity } = fxPosition([
      txn({ direction: "in", amount: 100, fx_rate: 9 }),
      txn({ direction: "out", amount: 250 }),
      txn({ direction: "in", amount: 400, fx_rate: 9 }),
    ]);
    expect(quantity).toBe(250);
  });

  it("keeps the last rate while there is nothing to average", () => {
    const steps = replayFx([
      txn({ direction: "in", amount: 100, fx_rate: 9.2 }),
      txn({ direction: "out", amount: 100 }),
    ]);
    expect(steps[1].quantity).toBe(0);
    expect(steps[1].averageRate).toBe(9.2);
  });

  it("replays oldest first, whatever order the rows arrive in", () => {
    const { quantity } = fxPosition([
      txn({ txn_date: "2026-10-05", direction: "out", amount: 300 }),
      txn({ txn_date: "2026-10-01", direction: "in", amount: 1000, fx_rate: 9 }),
    ]);
    expect(quantity).toBe(700);
  });
});
