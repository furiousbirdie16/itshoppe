import { describe, it, expect } from "vitest";
import { runningBalances, type BalanceTxn } from "./running-balance";

const txn = (o: Partial<BalanceTxn> & { id: string }): BalanceTxn => ({
  txn_date: "2026-01-01",
  direction: "in",
  amount: 0,
  ...o,
});

describe("runningBalances", () => {
  it("starts from the opening balance and applies each movement in date order", () => {
    const balances = runningBalances(1000, [
      txn({ id: "c", txn_date: "2026-01-03", direction: "out", amount: 250 }),
      txn({ id: "a", txn_date: "2026-01-01", direction: "in", amount: 500 }),
      txn({ id: "b", txn_date: "2026-01-02", direction: "out", amount: 100 }),
    ]);
    expect(balances).toEqual({ a: 1500, b: 1400, c: 1150 });
  });

  it("replays oldest-first regardless of the order rows arrive in", () => {
    const rows: BalanceTxn[] = [
      txn({ id: "old", txn_date: "2026-01-01", direction: "in", amount: 100 }),
      txn({ id: "new", txn_date: "2026-06-01", direction: "in", amount: 100 }),
    ];
    // The ledger is fetched newest-first, so the input is usually reversed.
    expect(runningBalances(0, [...rows].reverse())).toEqual({ old: 100, new: 200 });
  });

  it("breaks same-date ties on created_at so the sequence is stable", () => {
    const balances = runningBalances(0, [
      txn({ id: "second", created_at: "2026-01-01T10:00:00Z", direction: "out", amount: 40 }),
      txn({ id: "first", created_at: "2026-01-01T09:00:00Z", direction: "in", amount: 100 }),
    ]);
    expect(balances).toEqual({ first: 100, second: 60 });
  });

  it("can go negative, because an overdrawn account is a real state", () => {
    const balances = runningBalances(50, [txn({ id: "a", direction: "out", amount: 200 })]);
    expect(balances.a).toBe(-150);
  });

  it("handles string amounts, which is how PostgREST returns numerics", () => {
    const balances = runningBalances(0, [txn({ id: "a", direction: "in", amount: "1500.50" })]);
    expect(balances.a).toBe(1500.5);
  });
});
