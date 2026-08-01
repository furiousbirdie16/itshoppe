# Marketplace Receivables (Finance)

A new read-only Finance page that tracks money owed by marketplace platforms (Shopee, Lazada, others) for unpaid Online Sales. Additive only — Online Sales, inventory, dashboards, reports and insights stay untouched.

## What the page shows

Route: `/marketplace-receivables`, sidebar: Finance group (above Receivables), visible to admins only (financial data).

Cards:
- Total Pending Marketplace Receivables
- Shopee Pending
- Lazada Pending
- Other Marketplaces Pending

Table (unpaid marketplace orders only): Order Date, Platform, Order Number, Total Sales, Estimated Fee %, Estimated Payout, Days Outstanding. Fully read-only — no editing, no status changes, no writes from this page.

Extras kept consistent with the rest of the ERP: search by order number/product, platform filter, date range filter, sortable columns, column visibility, Excel export, peso formatting.

## Calculation rules

- Uses the existing Online Sales payment field — no new payment status field. Orders count as pending when the existing logic treats them as unpaid/outstanding.
- Which orders qualify is decided by the same rules Online Sales already applies; no new order status requirement is introduced.
- Total Sales = the existing Total Sales value already shown for the order in Online Sales, reused as-is. No new price formula.
- Estimated Fee = Total Sales x fee %. Fee % = the order's own override when set, otherwise a fixed 22% default.
- Estimated Payout = Total Sales - Estimated Fee.
- Total Pending = sum of Estimated Payouts, grouped per platform for the cards.
- Marking an order paid in Online Sales drops it out on next load; flipping it back brings it back. No sync logic.
- Days Outstanding = today - order date.

## Editing the fee

- The Marketplace Receivables page never edits anything.
- The optional per-order fee % is entered in the existing Edit Online Sale dialog via a single new optional input (blank = 22% default). No other change to that workflow.
- A normal page refresh/reload after saving shows the updated numbers. No realtime subscriptions.

## Technical notes

- One additive migration: `online_sales.marketplace_fee_pct numeric NULL` (null = 22% default). No other schema, trigger, relationship, or table changes; no fee-defaults table for now.
- New page `src/pages/MarketplaceReceivablesPage.tsx` reading `online_sales` (paginated fetch like other pages, branch-aware via `BranchContext`), plus a small `src/lib/marketplaceReceivables.ts` for the fee/payout math.
- `App.tsx`: add the route wrapped in the existing `AdminRoute`. `AppSidebar.tsx`: insert the new item into the Finance group; existing placeholders and Receivables stay unchanged.
- Only change inside Online Sales is the new optional fee % input in the edit dialog's form payload — import workflow, inventory deduction, branch logic, cost/profit tracking, dashboards, reports, business insights and all existing calculations are untouched.
