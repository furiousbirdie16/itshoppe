import { useEffect, useState } from "react";
import {
  Package,
  Users,
  Truck,
  FileText,
  Receipt,
  LayoutDashboard,
  ShoppingCart,
  Settings,
  LogOut,
  UserCog,
  Store,
  ClipboardList,
  CircleDollarSign,
  BarChart3,
  AlertTriangle,
  Tag,
  ArrowLeftRight,
  Boxes,
  Wallet,
  ShieldCheck,
  ChevronRight,
  Landmark,
  PiggyBank,
  HandCoins,
  LineChart,
} from "lucide-react";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";

type NavItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  disabled?: boolean;
};

type NavGroup = {
  key: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  items: NavItem[];
};

const dashboardItem: NavItem = {
  title: "Dashboard",
  url: "/",
  icon: LayoutDashboard,
  adminOnly: true,
};

const navGroups: NavGroup[] = [
  {
    key: "inventory",
    title: "Inventory",
    icon: Boxes,
    items: [
      { title: "Inventory", url: "/inventory", icon: Package },
      { title: "Low Stock Alerts", url: "/low-stock-alerts", icon: AlertTriangle },
      { title: "Stock Transfers", url: "/stock-transfers", icon: ArrowLeftRight },
    ],
  },
  {
    key: "purchasing",
    title: "Purchasing",
    icon: ShoppingCart,
    items: [
      { title: "Suppliers", url: "/suppliers", icon: Truck, adminOnly: true },
      { title: "Overseas PO", url: "/overseas-purchase-orders", icon: ShoppingCart },
      { title: "Purchase Orders", url: "/purchase-orders", icon: ClipboardList },
    ],
  },
  {
    key: "sales",
    title: "Sales",
    icon: Store,
    items: [
      { title: "Customers", url: "/customers", icon: Users },
      { title: "Customer Pricing", url: "/customer-pricing", icon: Tag },
      { title: "Quotations", url: "/quotations", icon: FileText },
      { title: "Invoices", url: "/invoices", icon: Receipt },
      { title: "Online Sales", url: "/online-sales", icon: Store },
    ],
  },
  {
    key: "finance",
    title: "Finance",
    icon: Wallet,
    items: [
      { title: "Financial Dashboard", url: "#", icon: LineChart, disabled: true },
      { title: "Receivables", url: "/pending-payments", icon: CircleDollarSign },
      { title: "Cash & Bank", url: "#", icon: Landmark, disabled: true },
      { title: "Payables", url: "#", icon: HandCoins, disabled: true },
      { title: "Loans", url: "#", icon: PiggyBank, disabled: true },
      { title: "Owner Transactions", url: "#", icon: Wallet, disabled: true },
    ],
  },
  {
    key: "reports",
    title: "Reports",
    icon: BarChart3,
    items: [{ title: "Business Insights", url: "/business-insights", icon: BarChart3 }],
  },
  {
    key: "administration",
    title: "Administration",
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

function loadOpenState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function AppSidebar() {
  const { state, setOpenMobile, setOpen } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { user, role, signOut } = useAuth();

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => loadOpenState());

  const isAdmin = role === "admin";

  const visibleGroups = navGroups
    .filter((group) => !group.adminOnly || isAdmin)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.adminOnly || isAdmin),
    }))
    .filter((group) => group.items.length > 0);

  // Auto-expand the group containing the current route
  useEffect(() => {
    const active = visibleGroups.find((group) =>
      group.items.some((item) => !item.disabled && item.url === location.pathname),
    );
    if (active && !openGroups[active.key]) {
      setOpenGroups((prev) => {
        const next = { ...prev, [active.key]: true };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, role]);

  const toggleGroup = (key: string, open: boolean) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [key]: open };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

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
              {isAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={dashboardItem.url}
                      end
                      onClick={() => setOpenMobile(false)}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
                      activeClassName="bg-primary/8 text-primary hover:bg-primary/10 hover:text-primary"
                    >
                      <dashboardItem.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{dashboardItem.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {visibleGroups.map((group) => {
                const hasActive = group.items.some(
                  (item) => !item.disabled && item.url === location.pathname,
                );
                const isOpen = openGroups[group.key] ?? hasActive;

                if (collapsed) {
                  return (
                    <SidebarMenuItem key={group.key}>
                      <SidebarMenuButton
                        onClick={() => { setOpen(true); toggleGroup(group.key, true); }}
                        className={`flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:text-foreground hover:bg-accent ${
                          hasActive ? "text-primary" : "text-muted-foreground"
                        }`}
                        tooltip={group.title}
                      >
                        <group.icon className="h-4 w-4 shrink-0" />
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }

                return (
                  <Collapsible
                    key={group.key}
                    open={isOpen}
                    onOpenChange={(open) => toggleGroup(group.key, open)}
                    className="group/collapsible"
                  >
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          className={`flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:text-foreground hover:bg-accent ${
                            hasActive ? "text-foreground" : "text-muted-foreground"
                          }`}
                        >
                          <group.icon className="h-4 w-4 shrink-0" />
                          <span className="flex-1 text-left">{group.title}</span>
                          <ChevronRight
                            className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                          />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub className="mr-0 pr-0">
                          {group.items.map((item) =>
                            item.disabled ? (
                              <SidebarMenuSubItem key={item.title}>
                                <div className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/50">
                                  <item.icon className="h-3.5 w-3.5 shrink-0" />
                                  <span className="flex-1 truncate">{item.title}</span>
                                  <span className="rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                                    Soon
                                  </span>
                                </div>
                              </SidebarMenuSubItem>
                            ) : (
                              <SidebarMenuSubItem key={item.title}>
                                <SidebarMenuSubButton asChild>
                                  <NavLink
                                    to={item.url}
                                    onClick={() => setOpenMobile(false)}
                                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
                                    activeClassName="bg-primary/8 text-primary hover:bg-primary/10 hover:text-primary"
                                  >
                                    <item.icon className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">{item.title}</span>
                                  </NavLink>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ),
                          )}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
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
