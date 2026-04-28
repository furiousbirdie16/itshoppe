import { Package, Users, Truck, FileText, Receipt, LayoutDashboard, ShoppingCart, Settings, LogOut, UserCog, Globe, Ship, Store, ClipboardList, CircleDollarSign, BarChart3 } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
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

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, adminOnly: false },
  { title: "Inventory", url: "/inventory", icon: Package, adminOnly: false },
  { title: "Suppliers", url: "/suppliers", icon: Truck, adminOnly: false },
  { title: "Overseas Suppliers", url: "/overseas-suppliers", icon: Globe, adminOnly: true },
  { title: "Overseas POs", url: "/overseas-purchase-orders", icon: ShoppingCart, adminOnly: true },
  { title: "Shipment Tracking", url: "/shipment-tracking", icon: Ship, adminOnly: true },
  { title: "Customers", url: "/customers", icon: Users, adminOnly: false },
  { title: "Purchase Orders", url: "/purchase-orders", icon: ShoppingCart, adminOnly: false },
  { title: "Quotations", url: "/quotations", icon: FileText, adminOnly: false },
  { title: "Invoices", url: "/invoices", icon: Receipt, adminOnly: false },
  { title: "Pending Payments", url: "/pending-payments", icon: CircleDollarSign, adminOnly: false },
  { title: "Online Sales", url: "/online-sales", icon: Store, adminOnly: false },
  { title: "Business Insights", url: "/business-insights", icon: BarChart3, adminOnly: false },
  { title: "Activity Log", url: "/activity-log", icon: ClipboardList, adminOnly: true },
  { title: "Users", url: "/users", icon: UserCog, adminOnly: true },
  { title: "Settings", url: "/settings", icon: Settings, adminOnly: true },
];

export function AppSidebar() {
  const { state, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { user, role, signOut } = useAuth();

  const visibleItems = navItems.filter((item) => !item.adminOnly || role === "admin");

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
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      onClick={() => setOpenMobile(false)}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
                      activeClassName="bg-primary/8 text-primary hover:bg-primary/10 hover:text-primary"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
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
