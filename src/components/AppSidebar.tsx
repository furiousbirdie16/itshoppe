import { Package, Users, Truck, FileText, Receipt, LayoutDashboard, ShoppingCart } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
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
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Inventory", url: "/inventory", icon: Package },
  { title: "Suppliers", url: "/suppliers", icon: Truck },
  { title: "Customers", url: "/customers", icon: Users },
  { title: "Purchase Orders", url: "/purchase-orders", icon: ShoppingCart },
  { title: "Quotations", url: "/quotations", icon: FileText },
  { title: "Invoices", url: "/invoices", icon: Receipt },
];

export function AppSidebar() {
  const { state, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  return (
    <Sidebar collapsible="icon">
      <SidebarContent className="pt-4">
        <div className={`px-4 mb-6 ${collapsed ? "px-2" : ""}`}>
          <div className={`flex items-center gap-2 ${collapsed ? "justify-center" : ""}`}>
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <Package className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            {!collapsed && (
              <span className="text-sm font-semibold tracking-tight text-foreground">ERP System</span>
            )}
          </div>
        </div>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5 px-2">
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
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
      </SidebarContent>
    </Sidebar>
  );
}
