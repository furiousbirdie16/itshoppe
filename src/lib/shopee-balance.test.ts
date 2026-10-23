import { describe, expect, it } from "vitest";
import { balanceHeaderIndex, isShopeeBalanceReport, parseShopeeBalanceReport } from "./shopee-balance";

// Laid out as Shopee's own report: summary first, transactions further down.
const REPORT = [
  ["Report", "", "", "", "", "", "", ""],
  ["Account Info", "", "", "", "", "", "", ""],
  ["Username (Seller)", "itshoppe8", "", "", "", "", "", ""],
  ["Summary", "", "", "", "$", "Currency", "No. of Transactions", ""],
  ["Total Money In", "", "", "", "111540.61", "PHP", "232", ""],
  ["Transaction Details", "", "", "", "", "", "", ""],
  ["Date", "Transaction Type", "Description", "Order ID", "Money Direction", "Amount", "Status", "Balance After Transactions"],
  ["2026-10-21 23:22:44", "Withdrawals", "Withdrawal", "-", "Money Out", "-101259.11", "Transaction Completed", "0"],
  ["2026-10-21 19:51:40", "Order Income", "Income from Order #261012EKMUD607", "261012EKMUD607", "Money In", "399.28", "Transaction Completed", "101259.11"],
  ["2026-10-14 00:32:54", "Adjustment", "Wallet adjustment for order 26100712YMS0SA", "26100712YMS0SA", "Money Out", "-3160.72", "Transaction Completed", "815.12"],
  ["2026-10-13 01:02:17", "Order Income", "Income from Order #261006UTE42NAN", "261006UTE42NAN", "Money Out", "-89", "Transaction Completed", "163163.45"],
  ["2026-10-13 01:00:00", "Order Income", "Income from Order #PENDING1", "PENDING1", "Money In", "10", "Processing", ""],
];

describe("Shopee balance report", () => {
  it("is recognised by its transactions header, wherever it sits", () => {
    expect(balanceHeaderIndex(REPORT)).toBe(6);
    expect(isShopeeBalanceReport(REPORT)).toBe(true);
    expect(isShopeeBalanceReport([["Order ID", "Amount Paid"], ["X", "1"]])).toBe(false);
  });

  it("takes only rows with an order ID, net per order", () => {
    const { orders, notCompleted } = parseShopeeBalanceReport(REPORT);
    expect(orders).toEqual([
      { orderId: "261012EKMUD607", amount: 399.28, adjustments: 0, rows: 1 },
      { orderId: "26100712YMS0SA", amount: -3160.72, adjustments: -3160.72, rows: 1 },
      { orderId: "261006UTE42NAN", amount: -89, adjustments: 0, rows: 1 },
    ]);
    expect(notCompleted).toBe(1);
  });

  it("adds up an order's income and a later adjustment", () => {
    const { orders } = parseShopeeBalanceReport([
      REPORT[6],
      ["", "Order Income", "", "A1", "Money In", "500", "Transaction Completed", ""],
      ["", "Adjustment", "", "A1", "Money Out", "-120.5", "Transaction Completed", ""],
    ]);
    expect(orders).toEqual([{ orderId: "A1", amount: 379.5, adjustments: -120.5, rows: 2 }]);
  });
});
