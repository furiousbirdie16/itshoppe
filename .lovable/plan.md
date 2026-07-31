# Sidebar Reorganization into Collapsible Groups

Reorganize navigation only. No route changes, no page creation/deletion, no permission changes.

## New structure

- Dashboard (admin only, standalone link)
- Inventory: Inventory, Low Stock Alerts, Stock Transfers
- Purchasing: Suppliers (admin only), Overseas PO, Purchase Orders
- Sales: Customers, Customer Pricing, Quotations, Invoices, Online Sales
- Finance: Financial Dashboard (disabled), Receivables (= existing Pending Payments page), Cash & Bank (disabled), Payables (disabled), Loans (disabled), Owner Transactions (disabled)
- Reports: Business Insights
- Administration (admin only): Activity Log, Users, Settings

Disabled Finance items render greyed out with a small "Soon" tag and are not clickable.

## Behavior

- Each group is an expandable/collapsible section with a chevron.
- Group open/closed state persists across navigation and reloads (stored per user in localStorage).
- The group containing the current route auto-expands.
- Existing admin-only filtering stays as is: a group hides entirely if none of its items are visible to the current role.
- Collapsed (icon) sidebar mode keeps showing group icons; clicking a group icon expands the sidebar as today.
- Current icons are reused; new groups get sensible lucide icons (Boxes, ShoppingCart, Store, Wallet, BarChart3, ShieldCheck).

## Technical notes

- Edit `src/components/AppSidebar.tsx` only: replace the flat `navItems` array with a grouped array, render each group with shadcn `Collapsible` + `SidebarGroup`/`SidebarMenu`, `SidebarMenuSub` for children.
- Persist state with a `localStorage` key such as `sidebar-groups-open`.
- `src/App.tsx` routes untouched; `/pending-payments` stays the same route, only relabeled "Receivables" in the sidebar.
