import { describe, it, expect } from "vitest";
import { matchesTransactionSearch, type SearchableTxn } from "./txn-search";

const txn = (o: Partial<SearchableTxn> = {}): SearchableTxn => ({
  category: "Supplies",
  payee: "Jennifer",
  reference: "OR-2201",
  notes: "",
  amount: 1500,
  ...o,
});

describe("matchesTransactionSearch", () => {
  it("finds a transaction by its amount", () => {
    // The reported bug: typing the figure returned "no transactions yet".
    expect(matchesTransactionSearch(txn({ amount: 1500 }), "1500")).toBe(true);
    expect(matchesTransactionSearch(txn({ amount: 1500 }), "1500.00")).toBe(true);
    expect(matchesTransactionSearch(txn({ amount: 1500.5 }), "1500.5")).toBe(true);
  });

  it("ignores the punctuation people type amounts with", () => {
    expect(matchesTransactionSearch(txn({ amount: 21500 }), "₱21,500")).toBe(true);
    expect(matchesTransactionSearch(txn({ amount: 21500 }), " 21500 ")).toBe(true);
  });

  it("reads amounts that arrive as strings, as PostgREST returns numerics", () => {
    expect(matchesTransactionSearch(txn({ amount: "2265.50" }), "2265.5")).toBe(true);
  });

  it("still matches the text fields", () => {
    expect(matchesTransactionSearch(txn(), "jennifer")).toBe(true);
    expect(matchesTransactionSearch(txn(), "OR-2201")).toBe(true);
    expect(matchesTransactionSearch(txn({ notes: "for the Manila run" }), "manila")).toBe(true);
  });

  it("matches partial figures, since the point is a half-remembered amount", () => {
    expect(matchesTransactionSearch(txn({ amount: 21500 }), "1500")).toBe(true);
  });

  it("does not match an unrelated amount or text", () => {
    expect(matchesTransactionSearch(txn({ amount: 900 }), "1500")).toBe(false);
    expect(matchesTransactionSearch(txn(), "geraldine")).toBe(false);
  });

  it("returns everything for an empty query", () => {
    expect(matchesTransactionSearch(txn(), "")).toBe(true);
    expect(matchesTransactionSearch(txn(), "   ")).toBe(true);
  });

  it("does not fall through to the amount for a text query that missed", () => {
    // "abc" is not a number, so it must not be coerced into one and match 0.
    expect(matchesTransactionSearch(txn({ amount: 0 }), "abc")).toBe(false);
  });
});
