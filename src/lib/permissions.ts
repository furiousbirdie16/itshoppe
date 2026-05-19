import { useAuth } from "@/contexts/AuthContext";
import { peso } from "@/lib/currency";

/**
 * Reusable permission helper. Centralizes role-based UI gating so we
 * don't sprinkle `role === "admin"` checks across the codebase.
 *
 * Non-admins:
 *  - Cannot see aggregate financial summaries (inventory value,
 *    incoming stock value, sales totals, business-insights money).
 *  - Cannot see cost prices for imported items.
 *  - Cannot access Activity Log, Users, Settings, or Overseas PO pages
 *    (enforced at the route level in App.tsx + sidebar).
 */
export function usePermissions() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  return {
    role,
    isAdmin,
    /** Can see any monetary aggregate (totals, inventory value, etc.) */
    canViewFinancials: isAdmin,
    /** Can see cost price for a given inventory item */
    canViewItemCost: (item?: { source?: string | null }) =>
      isAdmin || (item?.source ?? "local") === "local",
    /** Can access admin-only modules */
    canAccessAdminPages: isAdmin,
    /** Format a money value, masking it for non-admins */
    money: (n: number) => (isAdmin ? peso(n) : "—"),
    /** Format an item-cost value, masking imports for non-admins */
    itemCost: (n: number, item?: { source?: string | null }) =>
      isAdmin || (item?.source ?? "local") === "local" ? peso(n) : "—",
  };
}
