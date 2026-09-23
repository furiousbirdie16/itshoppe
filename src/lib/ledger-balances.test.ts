import { describe, it, expect } from "vitest";
import { walkBalances, type MovementSnapshot } from "./ledger-balances";

const move = (m: Partial<MovementSnapshot>): MovementSnapshot => ({
  branch_id: "b1",
  location: null,
  dest_location: null,
  balance_before: null,
  balance_after: null,
  dest_balance_before: null,
  dest_balance_after: null,
  signed: 0,
  ...m,
});

describe("walkBalances", () => {
  it("keeps warehouse and store apart instead of sharing one column", () => {
    const [receipt, transfer] = walkBalances([
      // Stock received into the warehouse.
      move({ location: "warehouse", balance_before: 16, balance_after: 56, signed: 40 }),
      // 20 of it moved to the store.
      move({
        location: "warehouse", dest_location: "store",
        balance_before: 56, balance_after: 36,
        dest_balance_before: 1, dest_balance_after: 21,
        signed: -20,
      }),
    ]);

    expect(receipt.wh_after).toBe(56);
    expect(transfer.wh_before).toBe(56);
    expect(transfer.wh_after).toBe(36);
    expect(transfer.st_after).toBe(21);
    // The branch is no better or worse off for moving its own stock about.
    expect(transfer.total_before).toBe(transfer.total_after);
  });

  it("finds stock that changed with nothing recording it", () => {
    const [, second] = walkBalances([
      move({ location: "store", balance_before: 20, balance_after: 10, signed: -10 }),
      // The next sale found 7 on the shelf, not the 10 the last one left.
      move({ location: "store", balance_before: 7, balance_after: 2, signed: -5 }),
    ]);
    expect(second.discrepancy).toBe(-3);
  });

  it("reports a surplus as readily as a shortfall", () => {
    const [, second] = walkBalances([
      move({ location: "store", balance_before: 5, balance_after: 5, signed: 0 }),
      move({ location: "store", balance_before: 9, balance_after: 8, signed: -1 }),
    ]);
    expect(second.discrepancy).toBe(4);
  });

  // The first movement at a location has nothing to be compared against, so it
  // opens the balance rather than being reported as a mismatch.
  it("claims no gap at a location it has not seen before", () => {
    const [first] = walkBalances([
      move({ location: "store", balance_before: 40, balance_after: 39, signed: -1 }),
    ]);
    expect(first.discrepancy).toBe(0);
    expect(first.st_before).toBe(40);
    expect(first.st_after).toBe(39);
  });

  // Branches hold their own stock, so one branch's movements say nothing about
  // another's — reading them as one series invented gaps at every switch.
  it("tracks each branch separately", () => {
    const rows = walkBalances([
      move({ branch_id: "mnl", location: "store", balance_before: 10, balance_after: 8, signed: -2 }),
      move({ branch_id: "ceb", location: "store", balance_before: 50, balance_after: 49, signed: -1 }),
      move({ branch_id: "mnl", location: "store", balance_before: 8, balance_after: 7, signed: -1 }),
    ]);
    expect(rows[1].discrepancy).toBe(0);
    expect(rows[2].discrepancy).toBe(0);
    expect(rows[2].st_after).toBe(7);
  });

  it("falls back to the movement's delta where no snapshot was recorded", () => {
    const [, second] = walkBalances([
      move({ location: "store", balance_before: 10, balance_after: 10, signed: 0 }),
      move({ location: "store", signed: -4 }),
    ]);
    expect(second.st_after).toBe(6);
    expect(second.discrepancy).toBe(0);
  });
});
