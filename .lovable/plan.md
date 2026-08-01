# Marketplace Receivables (Finance)

A new read-only Finance page that tracks money owed by marketplace platforms (Shopee, Lazada, others) for unpaid Online Sales. Additive only — Online Sales, inventory, dashboards, reports and insights stay untouched.

## What the page shows

Route: `/marketplace-receivables`, sidebar: Finance group (above Receivables), visible to admins only (financial data).

Cards:
- Total Pending Marketplace Receivables
- Shopee Pending
- Lazada Pending
- Other Marketplaces Pending

Table (unpaid marketplace orders only): Order Date, Platform, Order Number, Total Sales, Estimated Fee % (editable inline), Estimated Payout, Days Outstanding.

Extras kept consistent with the rest of the ERP: search by order number/product, platform filter, date range filter, sortable columns, column visibility, Excel export, peso formatting.

## Calculation rules

- Include only Online Sales with `payment_status = 'unpaid'` and status `completed` (returned/cancelled orders aren't receivables).
- Total Sales = unit price x quantity (deal price when set, otherwise posted price) — same price rule already used in Online Sales.
- Estimated Fee = Total Sales x fee %. Fee % resolves as: per-order override, else the platform default (Shopee / Lazada / Others), else 22%.
- Estimated Payout = Total Sales - Estimated Fee.
- Total Pending = sum of Estimated Payouts, grouped per platform for the cards.
- Marking an order Paid in Online Sales drops it out automatically (the page filters on `payment_status`); flipping back to Unpaid brings it back. No extra sync logic.
- Days Outstanding = today - order date.

## Editing the fee

- Inline % input per row (admins) saves the override on that order; the row's payout and the cards recalculate immediately.
- Platform default percentages are editable in one small "Fee defaults" dialog on this page and apply to every order without an override.

## Technical notes

- One migration, additive:
  - `online_sales.marketplace_fee_pct numeric NULL` (null = use platform default). Nothing else on the table changes, so all existing queries and triggers keep working.
  - `marketplace_fee_defaults` table (`sales_channel` unique, `fee_pct` default 22, timestamps + updated_at trigger), seeded with shopee/lazada/others at 22, with GRANTs and RLS: read for authenticated, write for admins via `has_role`.
- New page `src/pages/MarketplaceReceivablesPage.tsx` reading `online_sales` directly (paginated fetch like other pages, branch-aware via `BranchContext`), plus a small `src/lib/marketplaceReceivables.ts` for fee/payout math.
- Real-time freshness: Supabase realtime subscription on `online_sales` (and refetch on window focus) so payment-status changes made in Online Sales reflect here without a manual reload.
- `App.tsx`: add the route wrapped in the existing `AdminRoute`. `AppSidebar.tsx`: replace the Finance "Payables"-style placeholder list only by inserting the new real item — existing placeholders and Receivables stay as they are.
