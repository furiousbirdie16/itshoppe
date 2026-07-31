# Inter-Branch Stock Transfer

A new module for moving stock between branches with a full approval workflow. Inventory leaves the source immediately, sits in an "in-transit" bucket (not sellable at either branch), and only becomes available at the destination once received.

## Database

New table `stock_transfers`:
- transfer_number (auto: `TRF-YYYYMM-####`)
- source_branch_id, destination_branch_id
- status: `draft | pending_approval | approved | in_transit | received | cancelled`
- notes
- requested_by / _email, approved_by / _email, dispatched_by / _email, received_by / _email
- requested_at, approved_at, dispatched_at, received_at, cancelled_at

New table `stock_transfer_items`:
- transfer_id, item_id, variation_id (nullable)
- quantity (base units), source_location (`warehouse` | `store`), destination_location
- received_quantity (for partial receives)

New table `stock_transfer_audit`:
- transfer_id, action, from_status, to_status, actor_id/email, notes, created_at

New movement types (extends existing enum): already have `transfer_b2b_out` / `transfer_b2b_in`; add `transfer_b2b_in_transit` for the holding leg so ledger shows the parked stock.

RLS: admins full access; non-admins limited to transfers where they have access to either source or destination branch via `user_has_branch`.

## Workflow & Inventory Effects

```text
Draft ──submit──▶ Pending Approval ──approve──▶ Approved ──dispatch──▶ In Transit ──receive──▶ Received
  │                     │                          │                       │
  └────── cancel ───────┴────── cancel ────────────┘                  (no cancel after receipt)
```

- **Dispatch (Approved → In Transit):** deduct from source branch's `item_branch_stock` via `apply_branch_stock_change` (movement `transfer_b2b_out`). Stock is now "in transit" — recorded on the transfer itself, NOT added to destination yet, so it's unavailable everywhere.
- **Receive (In Transit → Received):** add to destination's `item_branch_stock` (movement `transfer_b2b_in`), supports full or partial receive per line.
- **Cancel before dispatch:** no inventory impact.
- **Cancel after dispatch (admin only):** returns stock to source and logs a reversal.

## Server RPCs (SECURITY DEFINER)

- `dispatch_stock_transfer(_transfer_id)` — validates source stock, deducts, flips to `in_transit`, writes movements + audit row.
- `receive_stock_transfer(_transfer_id, _lines jsonb)` — adds per-line `received_quantity` to destination, flips to `received` when all lines complete, writes movements + audit row.
- `cancel_stock_transfer(_transfer_id, _reason)` — reverses source deduction if already dispatched.

Each RPC captures `auth.uid()` + email into the appropriate `*_by` field and appends to `stock_transfer_audit`.

## UI — `src/pages/StockTransfersPage.tsx`

- New sidebar entry "Stock Transfers" under Inventory (admin + assigned-branch users).
- List view: transfer number, source → destination, status badge, item count, requested/received dates, actor chips, actions.
- Filters: status, source, destination, date range, search.
- Detail dialog: line items with item picker (reuse `ItemSearch` + variation), source location, quantity; per-status action buttons (Submit / Approve / Dispatch / Receive / Cancel).
- Receive dialog: per-line received quantity input, supports partial.
- Audit trail tab inside the detail dialog showing every state change.

## Inventory Page Additions

- New display-only column "In Transit" (sum of dispatched-but-not-received quantities for the branch, from either side).
- Item History ledger already reads `inventory_movements` — new movement types surface automatically with branch labels.

## Permissions

- Create/Submit: any user with access to source branch.
- Approve: admin, or manager of source branch.
- Dispatch: admin, or user with source branch access.
- Receive: admin, or user with destination branch access.
- Cancel after dispatch: admin only.

## Technical Notes

- Reuses `apply_branch_stock_change` RPC so ledger balances stay consistent with existing branch stock model.
- `stock_transfer_items.quantity` is stored in base units; UI converts when a variation is chosen (same logic as `stockCheck.ts`).
- Transfer number generated via `document_sequences` (new row `STOCK_TRANSFER`).
- All state transitions go through RPCs so RLS + audit logging can't be bypassed by direct table writes.
- New `useStockTransfers` hook wraps list/detail queries with `activeBranchId` filtering (shows transfers where source OR destination matches the active branch).

## Files

New: `src/pages/StockTransfersPage.tsx`, `src/components/StockTransferDialog.tsx`, `src/components/ReceiveTransferDialog.tsx`, `src/lib/stockTransfers.ts`.
Edit: `src/App.tsx` (route), `src/components/AppSidebar.tsx` (nav), `src/pages/InventoryPage.tsx` (In Transit column), one Supabase migration for tables + RPCs + policies + sequence + grants.
