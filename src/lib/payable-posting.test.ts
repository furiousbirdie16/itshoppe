import { describe, it, expect } from "vitest";
import { payablePosting } from "./payable-posting";

const payable = (o: Partial<Parameters<typeof payablePosting>[0]> = {}) => ({
  status: "unpaid",
  cash_account_id: "acct-1",
  amount: 2265496,
  ...o,
});

describe("payablePosting", () => {
  it("posts the full amount even once amount_paid has caught up", () => {
    // Marking a payable Paid fills in amount_paid, so an outstanding-based
    // figure would be zero — the bug this guards against.
    const posting = payablePosting(payable({ status: "paid", amount: 50000, amount_paid: 50000 }));
    expect(posting.shouldPost).toBe(true);
    expect(posting.amount).toBe(50000);
  });

  it("posts nothing while the payable is unpaid or partial", () => {
    expect(payablePosting(payable({ status: "unpaid" })).shouldPost).toBe(false);
    expect(payablePosting(payable({ status: "partial", amount_paid: 1000 })).shouldPost).toBe(false);
  });

  it("does not post on cleared, which would double the deduction", () => {
    expect(payablePosting(payable({ status: "cleared" })).shouldPost).toBe(false);
  });

  it("reverses on a bounced check and on cancellation", () => {
    expect(payablePosting(payable({ status: "bounced" })).shouldPost).toBe(false);
    expect(payablePosting(payable({ status: "cancelled" })).shouldPost).toBe(false);
  });

  it("leaves balances alone when no account is named", () => {
    expect(payablePosting(payable({ status: "paid", cash_account_id: null })).shouldPost).toBe(false);
    expect(payablePosting(payable({ status: "paid", cash_account_id: "" })).shouldPost).toBe(false);
  });

  it("handles string amounts, which is how PostgREST returns numerics", () => {
    expect(payablePosting(payable({ status: "paid", amount: "2265496.50" })).amount).toBe(2265496.5);
  });
});
