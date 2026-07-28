# Phase 2 — Per-Branch Inventory

Move stock from `items.warehouse_quantity` / `items.store_quantity` (plus `open_roll_remaining`) into a per-branch table so each branch (MNL, GES, future) has its own warehouse + store buckets, while keeping the existing UI, ledger, and analytics working.

## 1. New table: `item_branch_stock`

One row per (item, branch). Holds the numbers currently on `items`:

```
item_branch_stock
- id
- item_id            FK items
- branch_id          FK branches
- warehouse_quantity int
- store_quantity     int
- quantity           int  (generated: warehouse + store, kept in sync by trigger for legacy reads)
- open_roll_remaining numeric  (per-branch open roll)
- units_per_stock    numeric  (mirrors item; kept per-branch so future divergence is possible; default from parent)
- updated_at
- UNIQUE(item_id, branch_id)
```

Grants + RLS: `authenticated` can read rows for branches they belong to (via `user_has_branch`); admins full access; writes gated by `user_has_branch` too.

Backfill: for every existing item, insert one row for Manila (MNL) with the current `warehouse_quantity`, `store_quantity`, `open_roll_remaining`, `units_per_stock`. Gen San starts at 0/0 with `open_roll_remaining = 0`.

Do NOT drop the columns on `items` in this phase. Leave them as a legacy mirror so any code path we miss still reads a plausible number. A follow-up cleanup phase can remove them once Phase 3 lands.

Add `branch_id` (nullable) to `inventory_movements` so the ledger records which branch a movement happened in. Backfill existing rows to MNL.

## 2. Stock helpers

New module `src/lib/branchStock.ts`:

- `getBranchStock(itemId, branchId)` → row from `item_branch_stock`.
- `getAllBranchStock(itemId)` → all rows (for admin "All branches" view).
- `applyBranchStockChange(itemId, branchId, delta, opts)` — replaces `applyStockChange` in `src/lib/api.ts` for POs, invoices, online sales, returns. Handles pack/cut math against per-branch open roll.
- `transferBranchStock({ itemId, fromBranchId, toBranchId, fromLoc, toLoc, qty })` — new function for **inter-branch transfers** (source branch's warehouse/store → destination branch's warehouse/store).

Existing `applyStockChange` becomes a thin shim that resolves the active branch from context and delegates.

## 3. UI rewire

- **InventoryPage**: stock columns now read from `item_branch_stock` filtered by the active branch from `BranchContext`. "All branches" (admin) sums across branches and shows a per-branch breakdown in the row expander.
- **AdjustStockDialog**: writes to `item_branch_stock` for the active branch. Adds branch label in the header.
- **TransferStockDialog**: two modes:
  - *Within branch* — Warehouse ↔ Store (current behaviour, but on the active branch's row).
  - *Between branches* — pick destination branch + destination location; uses `transferBranchStock`. New movement types `transfer_b2b_out` / `transfer_b2b_in` (added to `movement_type` enum) with the counter-branch recorded in the notes + `dest_location` = `"<branch_code>:<warehouse|store>"`.
- **ItemHistoryDialog**: shows a "Branch" column (from the new `branch_id` on movements) and can filter to the active branch.
- **BulkEditUploadDialog / BulkUploadDialog**: the stock columns operate on the active branch. Non-admins can't switch branches, so they only ever edit their own.
- **Low-stock alerts, dashboard KPIs, business insights**: filtered by active branch; "All branches" for admin aggregates.

## 4. Purchasing + Sales (read-only in Phase 2)

POs, invoices, and online sales keep working as they do today, but every stock mutation they trigger now goes through `applyBranchStockChange` against the **active branch**. Tagging those documents with a `branch_id` column of their own is Phase 3 — for now the branch is inferred from `BranchContext` at the moment of the mutation.

## 5. Ledger + analytics

- `inventory_movements.branch_id` populated on every write via `recordMovement`.
- `ItemHistoryDialog`, Business Insights inventory tab, and Low Stock page all filter by active branch (admin can pick "All branches").
- Asset snapshot function extended: `inventory_value` computed from `item_branch_stock` summed across all branches (unchanged total), plus new `inventory_value_by_branch jsonb` for future per-branch charting.

## Technical details

- Trigger on `item_branch_stock` keeps `quantity = warehouse_quantity + store_quantity` (mirrors existing `sync_item_total_quantity` on `items`).
- Backfill runs inside the same migration as the table creation, wrapped in a single transaction so it's atomic.
- New enum values for `movement_type`: `transfer_b2b_out`, `transfer_b2b_in`.
- `applyBranchStockChange` reuses `applyVariationDelta` from `src/lib/variations.ts` — that helper is pure, no DB coupling, so it just needs the per-branch stock state passed in.
- `BranchContext.activeBranchId` is `null` when admin picks "All branches". Mutations require a concrete branch — the UI blocks Adjust/Transfer/Receive-PO/Create-Invoice actions with a toast ("Pick a branch first") when active branch is null.
- No existing historical rows are modified beyond the MNL backfill; `items.*_quantity` stays as-is.

## What's out of scope for Phase 2

- Tagging invoices / quotations / POs / online sales with `branch_id` (Phase 3).
- RLS lockdown so non-admin users literally can't see other branches' documents (Phase 4).
- Removing legacy `items.warehouse_quantity` / `store_quantity` columns.

Say **"go"** and I'll ship the migration + code changes. If you want the inter-branch transfer UI deferred, or want the legacy columns dropped now, tell me before I start.
