import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDashboardStats } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { peso } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Package, DollarSign, AlertTriangle, TrendingUp, ArrowRight, ShoppingCart, Receipt, CalendarIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth } from "date-fns";
import { useNavigate } from "react-router-dom";

type SalesRange = "daily" | "monthly" | "custom";

export default function DashboardPage() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const [salesRange, setSalesRange] = useState<SalesRange>("daily");
  const [customFrom, setCustomFrom] = useState<Date | undefined>(undefined);
  const [customTo, setCustomTo] = useState<Date | undefined>(undefined);

  const { dateFrom, dateTo } = useMemo(() => {
    const now = new Date();
    if (salesRange === "daily") {
      return { dateFrom: startOfDay(now), dateTo: endOfDay(now) };
    } else if (salesRange === "monthly") {
      return { dateFrom: startOfMonth(now), dateTo: endOfMonth(now) };
    } else {
      return {
        dateFrom: customFrom ? startOfDay(customFrom) : startOfDay(now),
        dateTo: customTo ? endOfDay(customTo) : endOfDay(now),
      };
    }
  }, [salesRange, customFrom, customTo]);

  const dateFromStr = format(dateFrom, "yyyy-MM-dd");
  const dateToStr = format(dateTo, "yyyy-MM-dd");

  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: getDashboardStats,
  });

  const { data: onlineSalesTotal = 0 } = useQuery({
    queryKey: ["dashboard_online_sales", dateFromStr, dateToStr],
    queryFn: async () => {
      const { data } = await supabase
        .from("online_sales")
        .select("posted_price, quantity, status")
        .gte("order_date", dateFromStr)
        .lte("order_date", dateToStr)
        .eq("status", "completed");
      return (data || []).reduce((sum: number, s: any) => sum + Number(s.posted_price) * (s.quantity || 1), 0);
    },
  });

  const { data: invoiceSalesTotal = 0 } = useQuery({
    queryKey: ["dashboard_invoice_sales", dateFromStr, dateToStr],
    queryFn: async () => {
      const { data } = await supabase
        .from("invoices")
        .select("total_amount, status, invoice_date")
        .in("status", ["confirmed", "paid"])
        .gte("invoice_date", dateFromStr)
        .lte("invoice_date", dateToStr);
      return (data || []).reduce((sum: number, inv: any) => sum + Number(inv.total_amount || 0), 0);
    },
  });

  const combinedTotal = onlineSalesTotal + invoiceSalesTotal;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-description">Overview of your business operations</p>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Items" value={stats?.totalItems || 0} icon={Package} />
        {isAdmin && (
          <StatCard
            title="Inventory Value"
            value={peso(stats?.totalValue || 0)}
            icon={DollarSign}
            variant="success"
          />
        )}
        <StatCard
          title="Low Stock"
          value={stats?.lowStockItems.length || 0}
          icon={AlertTriangle}
          variant="warning"
        />
        <StatCard
          title="Recent Activity"
          value={(stats?.recentPOs.length || 0) + (stats?.recentInvoices.length || 0)}
          icon={TrendingUp}
        />
      </div>

      {/* Sales Summary */}
      {isAdmin && (
        <div>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-semibold">Sales Summary</h2>
            <div className="flex items-center gap-2 flex-wrap">
              {(["daily", "monthly", "custom"] as SalesRange[]).map((r) => (
                <Button
                  key={r}
                  variant={salesRange === r ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs capitalize"
                  onClick={() => setSalesRange(r)}
                >
                  {r}
                </Button>
              ))}
              {salesRange === "custom" && (
                <div className="flex items-center gap-1">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className={cn("h-7 text-xs w-[110px] justify-start", !customFrom && "text-muted-foreground")}>
                        <CalendarIcon className="h-3 w-3 mr-1" />
                        {customFrom ? format(customFrom, "MM/dd/yyyy") : "From"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={customFrom} onSelect={setCustomFrom} initialFocus className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                  <span className="text-xs text-muted-foreground">—</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className={cn("h-7 text-xs w-[110px] justify-start", !customTo && "text-muted-foreground")}>
                        <CalendarIcon className="h-3 w-3 mr-1" />
                        {customTo ? format(customTo, "MM/dd/yyyy") : "To"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={customTo} onSelect={setCustomTo} initialFocus className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>
          </div>
          <div className="text-xs text-muted-foreground mb-3">
            {salesRange === "daily" ? `Today: ${format(dateFrom, "MMM d, yyyy")}` :
             salesRange === "monthly" ? `${format(dateFrom, "MMMM yyyy")}` :
             `${format(dateFrom, "MMM d, yyyy")} — ${format(dateTo, "MMM d, yyyy")}`}
          </div>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <StatCard title="Online Sales" value={peso(onlineSalesTotal)} icon={ShoppingCart} variant="success" />
            <StatCard title="Invoice Sales" value={peso(invoiceSalesTotal)} icon={Receipt} variant="success" />
            <StatCard title="Total Sales" value={peso(combinedTotal)} icon={DollarSign} variant="success" />
          </div>
        </div>
      )}

      {/* Low Stock Alert */}
      {stats?.lowStockItems && stats.lowStockItems.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <h2 className="text-sm font-semibold">Low Stock Alerts</h2>
            </div>
            <button
              onClick={() => navigate("/inventory")}
              className="text-xs font-medium text-primary flex items-center gap-1 hover:underline"
            >
              View all <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="data-table-wrapper">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Item</TableHead>
                  <TableHead className="text-xs">SKU</TableHead>
                  <TableHead className="text-xs text-right">Qty</TableHead>
                  <TableHead className="text-xs text-right">Threshold</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.lowStockItems.map((item) => (
                  <TableRow key={item.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium text-sm">{item.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">{item.sku}</TableCell>
                    <TableCell className="text-right text-sm font-semibold text-destructive">{item.quantity}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{item.low_stock_threshold}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent POs */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Recent Purchase Orders</h2>
            <button
              onClick={() => navigate("/purchase-orders")}
              className="text-xs font-medium text-primary flex items-center gap-1 hover:underline"
            >
              View all <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="rounded-xl border bg-card divide-y">
            {stats?.recentPOs.length ? (
              stats.recentPOs.map((po) => (
                <div key={po.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div>
                    <p className="text-sm font-medium">{po.po_number}</p>
                    <p className="text-xs text-muted-foreground">{po.suppliers?.name || "No supplier"}</p>
                  </div>
                  <StatusBadge status={po.status} />
                </div>
              ))
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">No purchase orders yet</div>
            )}
          </div>
        </div>

        {/* Recent Invoices */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Recent Invoices</h2>
            <button
              onClick={() => navigate("/invoices")}
              className="text-xs font-medium text-primary flex items-center gap-1 hover:underline"
            >
              View all <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="rounded-xl border bg-card divide-y">
            {stats?.recentInvoices.length ? (
              stats.recentInvoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div>
                    <p className="text-sm font-medium">{inv.invoice_number}</p>
                    <p className="text-xs text-muted-foreground">{inv.customers?.name || "No customer"}</p>
                  </div>
                  <StatusBadge status={inv.status} />
                </div>
              ))
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">No invoices yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
