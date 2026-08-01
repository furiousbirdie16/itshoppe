# Marketplace Receivables (Finance)

A new read-only Finance page that tracks money owed by marketplace platforms (Shopee, Lazada, others) for unpaid Online Sales. Additive only — Online Sales, inventory, dashboards, reports and insights stay untouched.

## What the page shows

Route: `/marketplace-receivables`, sidebar: Finance group (above Receivables), visible to admins only (financial data).

Cards:
- Total Pending Marketplace Receivables
- Shopee Pending
- Lazada Pending
- Other Marketplaces Pending

Table (unpaid marketplace orders only): Order Date, Platform, Order Number, Total Sales, Estimated Fee %, Estimated Payout, Days Outstanding. Read-only.

Extras kept consistent with the rest of the ERP: search by order number/product, platform filter, date range filter, sortable columns, column visibility, Excel export, peso formatting.

## Calculation rules

- Uses the existing Online Sales payment field — no new payment status field. Orders count as pending when the existing logic treats them as unpaid/outstanding.
- Which orders qualify is decided by the same rules Online Sales already applies (its own status/payment handling); no new status requirement is introduced.
- Total Sales = unit price x quantity (deal price when set, otherwise posted price) — same price rule already used in Online Sales.
- Estimated Fee = Total Sales x fee %. Fee % = the order's own override when set, otherwise a fixed 22% default.
- Estimated Payout = Total Sales - Estimated Fee.
- Total Pending = sum of Estimated Payouts, grouped per platform for the cards.
- Marking an order paid in Online Sales drops it out on next load; flipping it back brings it back. No sync logic.
- Days Outstanding = today - order date.

## Editing the fee

- The page itself is view/report only — no inline editing.
- The per-order fee % is edited in the existing Edit Online Sale dialog, where a single optional "Marketplace fee %" input is added (blank = 22% default).
- A normal page refresh/reload after saving shows the updated numbers. No realtime subscriptions.

## Technical notes

- One additive migration: `online_sales.marketplace_fee_pct numeric NULL` (null = 22% default). No other schema, trigger, relationship, or table changes; no defaults table for now.
- New page `src/pages/MarketplaceReceivablesPage.tsx` reading `online_sales` (paginated fetch like other pages, branch-aware via `BranchContext`), plus a small `src/lib/marketplaceReceivables.ts` for the fee/payout math.
- `App.tsx`: add the route wrapped in the existing `AdminRoute`. `AppSidebar.tsx`: insert the new item into the Finance group; existing placeholders and Receivables stay unchanged.
- Only change inside Online Sales is the new optional fee % field in the edit dialog's form payload — import workflow, inventory deduction, branch logic, cost/profit tracking, dashboards, reports and insights are untouched.
