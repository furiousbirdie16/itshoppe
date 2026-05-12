# Product Supplier Information System

Add a first-class link between products and suppliers (local + overseas), so purchasing, bulk PO from low stock, and landed-cost reporting all work without relying on PO history guesswork.

## 1. Database (new migration)

**New table: `item_suppliers`** — many-to-many link between products and suppliers, with pricing in supplier's native currency.

Columns:
- `item_id` (uuid, FK items)
- `supplier_id` (uuid, nullable) — local supplier
- `overseas_supplier_id` (uuid, nullable) — overseas supplier
- `supplier_sku` (text)
- `currency` (text, default 'PHP') — 'PHP' | 'USD' | 'RMB'
- `latest_cost` (numeric) — in supplier's currency, original value
- `moq` (integer, default 1)
- `lead_time_days` (integer)
- `last_purchased_at` (timestamptz, nullable)
- `is_primary` (boolean, default false)
- `notes` (text)
- `created_at`, `updated_at`, `created_by_email`

Constraints:
- CHECK: exactly one of `supplier_id` / `overseas_supplier_id` is set
- Unique partial index per (item_id, supplier_id) and (item_id, overseas_supplier_id)
- Partial unique index ensuring only one `is_primary=true` per item

RLS: authenticated read/write; admin-only delete.

**Triggers**:
- `tg_item_suppliers_single_primary` — when a row is set `is_primary=true`, unset primary on any other row for that item.
- Extend `handle_po_item_received` and `handle_overseas_po_item_received` to upsert into `item_suppliers` on receipt:
  - Update `latest_cost` (supplier's currency — for overseas POs, use raw `unit_cost`, not converted)
  - Update `last_purchased_at = now()`
  - If no row exists for this (item, supplier), insert one; if no `is_primary` set yet for that item, set this one primary.

## 2. API helpers (`src/lib/itemSuppliers.ts`)

- `listItemSuppliers(itemId)` — joins to suppliers + overseas_suppliers
- `upsertItemSupplier(payload)`
- `setPrimarySupplier(itemId, rowId)`
- `deleteItemSupplier(rowId)`
- `getPreferredSupplierForItem(itemId)` — returns row by priority: `is_primary` → most recent `last_purchased_at` → most recent `created_at`. Falls back to most-recent PO history if none.

## 3. Product Details — Suppliers tab

In `InventoryPage` item dialog (or detail dialog), add a `Suppliers` tab next to existing tabs:

Table columns: Supplier · Type (Local/Overseas) · Currency · Latest Cost · MOQ · Lead Time · Last Ordered · Primary

Actions per row:
- Set as default (star icon)
- Edit (opens form: supplier picker, SKU, currency, latest cost, MOQ, lead time, notes)
- Delete (admin only)

Top action: **Add supplier** — dialog with `SupplierSearch` / overseas-supplier select, then fields. Currency defaults from chosen supplier (overseas suppliers carry currency).

## 4. Bulk PO from Low Stock (improvements)

In `LowStockAlertsPage` BulkPODialog:
- For each low-stock item, resolve `getPreferredSupplierForItem(item.id)`.
- Group items by resolved supplier (local vs overseas separately — they create different POs).
- Items with no supplier go into an **"Unassigned"** group with an inline "Assign supplier" control (dropdown of all local + overseas suppliers + "Save to product"). Saving creates an `item_suppliers` row marked primary.
- Use the supplier's currency cost (`latest_cost`) as the suggested unit cost.
- "Generate POs" button creates one PO per supplier group (existing PO creation API; for overseas, use overseas PO API with supplier currency + exchange rate).

## 5. Low Stock page columns

Add columns (or compact info cell) to the table: **Default supplier · Currency · Latest cost · MOQ · Lead time**. Pulled in one batch query keyed by item id.

## 6. Auto-save on PO receive / create

Handled at the DB trigger level (Section 1). After a PO is **received** the item_suppliers row is created/updated automatically.

For PO **creation** (not receipt) we don't change `latest_cost` (avoid trusting unreceived prices), but we still bump `last_purchased_at` heuristic only on receipt. Optional UI prompt on PO create: when an item has no suppliers yet, show inline "Save [Supplier] as default for this product" checkbox; if ticked, insert primary row immediately. (Implemented in `PurchaseOrdersPage` add-line flow.)

## 7. Out of scope / deferred
- Editing supplier purchase history (we already have item cost history).
- Per-warehouse supplier preferences.
- Approval workflow for default supplier changes.

## Files

**New**
- `supabase/migrations/...item_suppliers.sql`
- `src/lib/itemSuppliers.ts`
- `src/components/ItemSuppliersTab.tsx`
- `src/components/AddItemSupplierDialog.tsx`

**Edited**
- `src/pages/InventoryPage.tsx` — add Suppliers tab in item dialog
- `src/pages/LowStockAlertsPage.tsx` — extra columns + smarter BulkPODialog with grouping & inline assign
- `src/pages/PurchaseOrdersPage.tsx` — optional "save as default" on add line
- `src/integrations/supabase/types.ts` — auto-regenerated
- `src/types/database.ts` — new `ItemSupplier` interface
