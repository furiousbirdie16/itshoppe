import { useEffect, useMemo, useState } from "react";
import { Package, Users, Truck, FileText, Receipt, LayoutDashboard, ShoppingCart, Settings, LogOut, UserCog, Ship, Store, ClipboardList, CircleDollarSign, BarChart3, AlertTriangle, Tag, ArrowLeftRight, ChevronRight, Wallet, Landmark, PiggyBank, HandCoins, UserCircle, ShieldCheck } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

type NavItem = {
  title: string;
  url?: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  soon?: boolean;
};

type NavGroup = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  items: NavItem[];
};

const topLevelItems: NavItem[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, adminOnly: true },
];

const navGroups: NavGroup[] = [
  {
    label: "Inventory",
    icon: Package,
    items: [
      { title: "Inventory", url: "/inventory", icon: Package },
      { title: "Low Stock Alerts", url: "/low-stock-alerts", icon: AlertTriangle },
      { title: "Stock Transfers", url: "/stock-transfers", icon: ArrowLeftRight },
    ],
  },
  {
    label: "Purchasing",
    icon: ShoppingCart,
    items: [
      { title: "Suppliers", url: "/suppliers", icon: Truck, adminOnly: true },
      { title: "Overseas PO", url: "/overseas-purchase-orders", icon: Ship },
      { title: "Purchase Orders", url: "/purchase-orders", icon: ShoppingCart },
    ],
  },
  {
    label: "Sales",
    icon: Receipt,
    items: [
      { title: "Customers", url: "/customers", icon: Users },
      { title: "Customer Pricing", url: "/customer-pricing", icon: Tag },
      { title: "Quotations", url: "/quotations", icon: FileText },
      { title: "Invoices", url: "/invoices", icon: Receipt },
      { title: "Online Sales", url: "/online-sales", icon: Store },
    ],
  },
  {
    label: "Finance",
    icon: CircleDollarSign,
    items: [
      { title: "Financial Dashboard", url: "/financial-dashboard", icon: BarChart3, adminOnly: true },
      { title: "Cash", url: "/cash", icon: Wallet },
      { title: "Receivables", url: "/pending-payments", icon: CircleDollarSign },
      { title: "Bank", url: "/bank", icon: Landmark, adminOnly: true },
      { title: "Marketplace Receivables", url: "/marketplace-receivables", icon: Store, adminOnly: true },
      { title: "Payables", url: "/payables", icon: Wallet, adminOnly: true },
      { title: "Loans", url: "/loans", icon: PiggyBank, adminOnly: true },
      { title: "Owner Transactions", url: "/owner-transactions", icon: HandCoins, adminOnly: true },
    ],
  },
  {
    label: "Reports",
    icon: BarChart3,
    items: [
      { title: "Business Insights", url: "/business-insights", icon: BarChart3 },
    ],
  },
  {
    label: "Administration",
    icon: ShieldCheck,
    adminOnly: true,
    items: [
      { title: "Activity Log", url: "/activity-log", icon: ClipboardList, adminOnly: true },
      { title: "Users", url: "/users", icon: UserCog, adminOnly: true },
      { title: "Settings", url: "/settings", icon: Settings, adminOnly: true },
    ],
  },
];

const STORAGE_KEY = "sidebar-groups-open";

export function AppSidebar() {
  const { state, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { user, role, signOut } = useAuth();
  const isAdmin = role === "admin";

  const groups = useMemo(
    () =>
      navGroups
        .filter((g) => !g.adminOnly || isAdmin)
        .map((g) => ({ ...g, items: g.items.filter((i) => !i.adminOnly || isAdmin) }))
        .filter((g) => g.items.length > 0),
    [isAdmin]
  );

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  // Auto-open the group containing the active route
  useEffect(() => {
    const active = groups.find((g) => g.items.some((i) => i.url && i.url !== "/" && location.pathname.startsWith(i.url)));
    if (active && !openGroups[active.label]) {
      setOpenGroups((prev) => ({ ...prev, [active.label]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, groups]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(openGroups));
    } catch {
      /* ignore */
    }
  }, [openGroups]);

  const itemLinkClass =
    "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-accent";

  const renderLink = (item: NavItem) => {
    if (item.soon || !item.url) {
      return (
        <SidebarMenuItem key={item.title}>
          <div className={`${itemLinkClass} cursor-not-allowed opacity-50`} title="Coming soon">
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <span className="flex-1 flex items-center justify-between gap-2">
                <span>{item.title}</span>
                <span className="text-[10px] uppercase tracking-wider">Soon</span>
              </span>
            )}
          </div>
        </SidebarMenuItem>
      );
    }
    return (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton asChild>
          <NavLink
            to={item.url}
            end={item.url === "/"}
            onClick={() => setOpenMobile(false)}
            className={itemLinkClass}
            activeClassName="bg-primary/8 text-primary hover:bg-primary/10 hover:text-primary"
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{item.title}</span>}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  const visibleTopLevel = topLevelItems.filter((i) => !i.adminOnly || isAdmin);

  return (
    <Sidebar collapsible="icon">
      <SidebarContent className="pt-4 flex flex-col h-full">
        <div className={`px-4 mb-6 ${collapsed ? "px-2" : ""}`}>
          <div className={`flex items-center gap-2 ${collapsed ? "justify-center" : ""}`}>
            <img src="/images/logo.png" alt="IT SHOPPE" className="h-7 w-7 rounded-lg shrink-0 object-contain" />
            {!collapsed && (
              <span className="text-sm font-semibold tracking-tight text-foreground">IT SHOPPE</span>
            )}
          </div>
        </div>

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5 px-2">
              {visibleTopLevel.map(renderLink)}

              {collapsed
                ? groups.flatMap((g) => g.items.map(renderLink))
                : groups.map((group) => (
                    <Collapsible
                      key={group.label}
                      open={!!openGroups[group.label]}
                      onOpenChange={(open) =>
                        setOpenGroups((prev) => ({ ...prev, [group.label]: open }))
                      }
                    >
                      <CollapsibleTrigger className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-accent">
                        <group.icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 text-left">{group.label}</span>
                        <ChevronRight
                          className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                            openGroups[group.label] ? "rotate-90" : ""
                          }`}
                        />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenu className="gap-0.5 pl-4 mt-0.5">
                          {group.items.map(renderLink)}
                        </SidebarMenu>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Bottom section: user info + sign out */}
        <div className="mt-auto border-t px-3 py-3">
          {!collapsed && (
            <div className="mb-2 px-1">
              <p className="text-xs font-medium text-foreground truncate">{user?.email}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{role || "user"}</p>
            </div>
          )}
          <Button
            variant="ghost"
            size={collapsed ? "icon" : "sm"}
            onClick={signOut}
            className={`${collapsed ? "h-8 w-8" : "w-full justify-start h-8 text-xs"} rounded-lg text-muted-foreground hover:text-destructive`}
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            {!collapsed && <span className="ml-2">Sign Out</span>}
          </Button>
        </div>
      </SidebarContent>
    </Sidebar>
  );
}
