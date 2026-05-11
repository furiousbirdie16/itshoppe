# Customer-Specific Pricing System

This adds a pricing memory layer so quotations, invoices, and online sales auto-fill the right price per customer, plus fixes the "default 1" quantity UX issue across all forms.

## 1. Database (new migration)

**New table: `customer_prices`** — fixed/preferred prices per customer+product (+ optional variation)
- `customer_id`, `item_id`, `variation_id` (nullable)
- `fixed_price` (numeric)
- `notes`, `created_at`, `updated_at`, `created_by_email`
- Unique index on (customer_id, item_id, variation_id)
- RLS: authenticated users read/write; admin-only delete

**New table: `customer_price_history`** — append-only log of every sold price per customer
- `customer_id`, `item_id`, `variation_id`
- `unit_price`, `quantity`
- `source` ('invoice' | 'quotation' | 'online_sale')
- `reference_id`, `reference_number` (e.g. invoice number)
- `sold_at`, `created_by_email`
- Indexes on (customer_id, item_id, sold_at desc)
- RLS: authenticated read/insert; no update/delete (audit trail)

**Trigger / function**: when an `invoice_items` row is inserted/updated AND parent invoice has a `customer_id`, automatically insert a `customer_price_history` row. Same for `quotation_items`.

## 2. Pricing lookup helper

`src/lib/customerPricing.ts`:
- `getCustomerPrice(customerId, itemId, variationId)` returns:
  ```
  { fixed: number|null, lastSold: { price, date, reference } | null, standard: number }
  ```
- Resolution order used by callers: **fixed → lastSold → standard**.

## 3. Form integration

In `QuotationsPage`, `InvoicesPage`, `OnlineSalesPage` line-item editors:
- When customer + item (+ variation) is selected, call helper and auto-fill `unit_price`.
- Show a small inline hint under the price field:  
  `Standard ₱220 • James ₱200 (fixed) • Last sold ₱210 on Mar 15`
- Manual edit always allowed; on save, history row written automatically by the DB trigger.

## 4. Customer Pricing page

New route `/customer-pricing` + sidebar entry:
- Two tabs: **Fixed Prices** and **Price History**.
- Fixed Prices: filter by customer/product, edit/remove fixed price, "Set fixed price" dialog.
- Price History: filter by customer + product, list with date, qty, price, margin vs cost, source reference, frequency count.
- Reuses existing `FilterCombobox` (only shows values present in current results).

## 5. Smart pricing warnings

Inline next to the unit-price input:
- Red badge if `unit_price < cost_price`.
- Amber badge if `unit_price` is >15% below the customer's previous average sold price.

## 6. Quantity field UX fix

Replace `useState("1")` / `defaultValue={1}` patterns with empty string in line-item editors and adjustment dialogs across:
- `QuotationsPage`, `InvoicesPage`, `OnlineSalesPage`
- `PurchaseOrdersPage`, `OverseasPurchaseOrdersPage`
- `AdjustStockDialog`, `TransferStockDialog`, `BulkPODialog` inside Low Stock page

Validation enforces qty > 0 on submit (already present); UI only changes initial empty state and `placeholder="Qty"`.

## 7. Out of scope

- POS — there is no POS page in the codebase. Skipping; can be added when POS exists.
- Sales Orders — same, no separate sales-order entity in this codebase (invoices serve that role).
- Role-gating price edits — leaving editable for everyone for now (user said "optional"); easy to add later via `has_role`.

## Files

**New**
- `supabase/migrations/...customer_pricing.sql`
- `src/lib/customerPricing.ts`
- `src/components/CustomerPriceHint.tsx`
- `src/components/SetCustomerPriceDialog.tsx`
- `src/pages/CustomerPricingPage.tsx`

**Edited**
- `src/App.tsx`, `src/components/AppSidebar.tsx`
- `src/pages/QuotationsPage.tsx`, `src/pages/InvoicesPage.tsx`, `src/pages/OnlineSalesPage.tsx`
- `src/pages/PurchaseOrdersPage.tsx`, `src/pages/OverseasPurchaseOrdersPage.tsx`
- `src/components/AdjustStockDialog.tsx`, `src/components/TransferStockDialog.tsx`
- `src/pages/LowStockAlertsPage.tsx` (BulkPODialog qty default)
