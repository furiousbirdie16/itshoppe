# Sidebar Navigation Reorganization

Restructure the sidebar into collapsible groups. No routes, page components, or permission logic change — this is a UI-only change to the sidebar.

## New structure

```text
Dashboard                      (admin only, top-level link)

Inventory
  Inventory, Low Stock Alerts, Stock Transfers

Purchasing
  Suppliers (admin only), Overseas PO, Purchase Orders

Sales
  Customers, Customer Pricing, Quotations, Invoices, Online Sales

Finance
  Financial Dashboard (soon), Receivables (soon), Cash & Bank (soon),
  Payables (soon), Loans (soon), Owner Transactions (soon)
  Pending Payments  (existing page, keeps working)

Reports
  Business Insights

Administration           (admin only)
  Activity Log, Users, Settings
```

## Behavior

- Each group header is a collapsible row with a chevron; clicking toggles it.
- Open/closed state per group is saved in localStorage so it survives navigation and reloads.
- The group containing the current route is auto-opened on load.
- Active item highlighting keeps the existing NavLink styling.
- Admin-only items keep their current visibility rules; a group hides entirely if it has no visible items.
- Finance placeholder items render greyed out and non-clickable with a "Soon" hint — no routes added.
- When the sidebar is icon-collapsed, groups render as flat icon rows (no headers), so every item stays reachable.

## Technical notes

- Only `src/components/AppSidebar.tsx` changes: replace the flat `navItems` array with a grouped array (`{ label, icon, items[] }`), render each group with the existing shadcn `SidebarGroup` + a Radix `Collapsible`.
- Persistence via a small `useState` + `localStorage` (key `sidebar-groups-open`), synced in an effect.
- Existing `Pending Payments` route `/pending-payments` is placed under Finance as the one live item.
- No changes to `App.tsx`, routes, or `src/lib/permissions.ts`.
