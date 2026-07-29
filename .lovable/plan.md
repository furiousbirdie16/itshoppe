# Phase 2 Completion Plan

Goal: `item_branch_stock` becomes the ONLY inventory source. Every transaction records its own `branch_id`. Legacy `items.warehouse_quantity` / `store_quantity` / `quantity` / `open_roll_remaining` are frozen (kept for historical reads only, never written by app code from this point).

## Part A — Database (one migration)

Add `branch_id uuid REFERENCES branches(id)` to:
- `purchase_orders`, `overseas_purchase_orders`
- `invoices`, `quotations`
- `online_sales`
- `inventory_movements` already has it — keep

Backfill every existing row to Manila (MNL). Make column NOT NULL after backfill.

RLS: keep current policies; add branch check via `user_has_branch(auth.uid(), branch_id)` for non-admin insert/update on those tables (admins unaffected).

Drop the legacy sync triggers `sync_item_total_quantity` from `items` writes at the app layer (we simply stop writing those columns).

## Part B — `src/lib/api.ts` rewire

Replace the core stock helper with a branch-scoped version:

```ts
applyStockChange({ itemId, variationId, branchId, location, deltaBase, ... })
```

- Reads current row from `item_branch_stock` for `(item_id, branch_id)` (creates one at zero if missing).
- Applies the same open-roll / variation math against that row only.
- Writes back to `item_branch_stock` (never `items`).
- Passes `branchId` into `recordMovement`.

Every call site in `api.ts` must pass an explicit `branchId` sourced from the transaction row (PO/invoice/online-sale/adjustment), not from `BranchContext`.

Call sites to update in `api.ts` (from the grep):
- PO receive (local) — line ~651, ~692, ~750, ~799 → use `purchase_orders.branch_id`
- Invoice deduct / cancel replenish — line ~962, ~990 → use `invoices.branch_id`
- Online sales deduct / replenish — same helper
- Return flows at ~427, ~1120, ~1198 → replace direct `items.update` with `item_branch_stock` writes via helper
- Bulk stock edit at ~491 → per-branch write against the currently-active branch

## Part C — Dialogs & pages

- `AdjustStockDialog`: read + write against `item_branch_stock` for the active branch. Show branch name in the header. Block save if admin has "All branches" selected.
- `TransferStockDialog`: same, warehouse↔store stays intra-branch.
- New `InterBranchTransferDialog`: pick source + destination branch, emits `transfer_b2b_out` on source row and `transfer_b2b_in` on destination row atomically.
- `OverseasPurchaseOrdersPage` + `PurchaseOrdersPage`: on create, stamp `branch_id`. Receive & undo-receive routes read the PO's `branch_id` (never the switcher). Display "Receiving into: <Branch>" prominently on the receive dialog.
- `InvoicesPage` / `QuotationsPage` / `OnlineSalesPage`: stamp `branch_id` on create; show branch chip on the form; if admin is on "All branches", require picking one before save.
- `BulkEditUploadDialog`: apply quantities into `item_branch_stock` for the active branch only.
- `InventoryPage`: read path already correct — add "Opening stock" writes to `item_branch_stock` for the active branch. Guard admin "All branches" on any write.

## Part D — Ledger

`recordMovement` already accepts `branchId` via schema; wire the new param through `src/lib/inventoryLog.ts` and pass the transaction's branch on every call. `ItemHistoryDialog` gets a Branch column.

## Part E — Verification checklist (I will run before returning)

1. Grep confirms zero writes to `items.warehouse_quantity` / `items.store_quantity` / `items.quantity` / `items.open_roll_remaining` outside the initial-create path for a new SKU.
2. Receiving a PO stamped to GES only mutates `item_branch_stock` rows where `branch_id = GES`.
3. Switching the header branch does NOT change what a saved invoice/PO deducts from.
4. Admin on "All branches" cannot save a new invoice/PO/adjust/transfer — UI blocks with a toast asking to pick a branch.
5. `tsgo` clean.

## Scope note

This is ~8 files touched heavily (`api.ts`, both PO pages, invoices, online sales, both dialogs, bulk edit) plus one migration and one new dialog. I'll do it in a single pass but the migration lands first (needs your approval) before the code edits — the code depends on the new columns.

If you want inter-branch transfers deferred, say so and I'll leave that dialog for a Phase 2.5.
