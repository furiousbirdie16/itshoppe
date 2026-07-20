# Universal Column Customization

Add per-user column **visibility** and **drag-to-reorder** to every list/table page, with preferences remembered per page.

## What you'll get

On every table page (Inventory, Customers, Invoices, Quotations, Online Sales, Purchase Orders, Overseas POs, Suppliers, Overseas Suppliers, Users, Activity Log, Pending Payments, Low Stock, Shipment Tracking, Customer Pricing):

- A **Columns** button in the toolbar next to filters.
- Dropdown lets you:
  - Toggle each column on/off (checkbox).
  - Drag column names up/down to reorder.
  - Reset to default.
- Some columns stay pinned (checkbox / actions / row selector) and can't be hidden or moved.
- Choices are saved per-page in your browser (localStorage) and survive refresh.

## How it works (technical)

1. **Extend `useColumnVisibility`** (`src/components/ColumnVisibility.tsx`) into `useColumnPrefs`:
   - Stores `{ visible: Record<key,boolean>, order: string[] }` under one localStorage key per page (e.g. `cols:invoices`).
   - Exposes `orderedColumns`, `isVisible`, `toggle`, `move(key, dir)`, `reset`.
   - Backwards compatible: if only the old `Record<key,boolean>` is stored, migrate on read.

2. **Rewrite `ColumnVisibilityMenu`** to render columns in current order with:
   - Checkbox on the left.
   - Up/Down arrow buttons on the right (simple, reliable, no dnd lib).
   - Required columns show a lock icon and skip both controls.
   - "Reset to default" at the bottom.

3. **Refactor each list page** to:
   - Declare a `COLUMNS: ColumnDef[]` array (key, label, required?, defaultVisible?).
   - Call `useColumnPrefs("cols:<page>", COLUMNS)`.
   - Render `<TableHead>` and `<TableCell>` by mapping over `orderedColumns.filter(isVisible)`, using a `renderers` map `{ key: { head: ..., cell: (row) => ... } }`.
   - Drop the Columns button into the existing toolbar.

4. Pinned columns (selection checkbox, sticky actions column) render outside the map so they always stay in place.

5. No backend changes. No new deps.

## Scope

All 15 list pages listed above. Card-style mobile layouts (e.g. Customers mobile view) are unaffected — this applies to the desktop table view only, matching the current `ColumnVisibility` pattern already used in a few places.

## Out of scope

- Cross-device sync (would need a `user_table_prefs` table — say the word if you want it).
- Column resizing / pinning to left-right edges.
- Reordering via mouse drag (using up/down buttons instead for reliability; can upgrade to dnd-kit later if you prefer).
