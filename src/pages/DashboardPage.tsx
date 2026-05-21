import { useState, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { getDashboardStats, updateItem } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { peso } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Package, DollarSign, AlertTriangle, TruckIcon, ArrowRight, ShoppingCart, Receipt, CalendarIcon, X } from "lucide-react";
import { DashboardAnalytics } from "@/components/DashboardAnalytics";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth } from "date-fns";
import { useNavigate } from "react-router-dom";

type SalesRange = "daily" | "monthly" | "custom";
type SalesDetail = "online" | "invoice" | "combined" | null;
type LowStockFilter = "all" | "ordered" | "not_ordered";

export default function DashboardPage() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const queryClient = useQueryClient();

  const [salesRange, setSalesRange] = useState<SalesRange>("daily");
  const [customFrom, setCustomFrom] = useState<Date | undefined>(undefined);
  const [customTo, setCustomTo] = useState<Date | undefined>(undefined);
  const [showDetail, setShowDetail] = useState<SalesDetail>(null);
  const [lowStockFilter, setLowStockFilter] = useState<LowStockFilter>("all");
  const [editingThreshold, setEditingThreshold] = useState<Record<string, string>>({});

  const updateThresholdMutation = useMutation({
    mutationFn: ({ id, threshold }: { id: string; threshold: number }) =>
      updateItem(id, { low_stock_threshold: threshold }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      toast.success("Threshold updated");
    },
    onError: (e: any) => toast.error(e.message || "Failed to update threshold"),
  });

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

  // Fetch full online sales records for the date range
  const { data: onlineSalesData = [] } = useQuery({
    queryKey: ["dashboard_online_sales_list", dateFromStr, dateToStr],
    queryFn: async () => {
      const { data } = await supabase
        .from("online_sales")
        .select("*")
        .gte("order_date", dateFromStr)
        .lte("order_date", dateToStr)
        .eq("status", "completed")
        .order("order_date", { ascending: false });
      return data || [];
    },
  });

  // Fetch full invoice records for the date range
  const { data: invoiceSalesData = [] } = useQuery({
    queryKey: ["dashboard_invoice_sales_list", dateFromStr, dateToStr],
    queryFn: async () => {
      const { data } = await supabase
        .from("invoices")
        .select("*, customers(name), quotations(sales_agent)")
        .in("status", ["confirmed", "paid"])
        .gte("invoice_date", dateFromStr)
        .lte("invoice_date", dateToStr)
        .order("invoice_date", { ascending: false });
      return data || [];
    },
  });

  const onlineSalesTotal = onlineSalesData.reduce((sum: number, s: any) => sum + Number(s.posted_price) * (s.quantity || 1), 0);
  const invoiceSalesTotal = invoiceSalesData.reduce((sum: number, inv: any) => sum + Number(inv.total_amount || 0), 0);
  const combinedTotal = onlineSalesTotal + invoiceSalesTotal;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-description">Overview of your business operations</p>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
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
        {isAdmin && (
          <StatCard
            title="Incoming Stock Value"
            value={peso(stats?.incomingStockValue || 0)}
            icon={TruckIcon}
            description="From unreceived POs"
          />
        )}
      </div>

      {/* Analytics: charts (admin only) */}
      {isAdmin && <DashboardAnalytics />}

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
                  onClick={() => { setSalesRange(r); setShowDetail(null); }}
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
            <div className={cn("cursor-pointer rounded-xl transition-all", showDetail === "online" ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-border")} onClick={() => setShowDetail(showDetail === "online" ? null : "online")}>
              <StatCard title="Online Sales" value={peso(onlineSalesTotal)} icon={ShoppingCart} variant="success" />
            </div>
            <div className={cn("cursor-pointer rounded-xl transition-all", showDetail === "invoice" ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-border")} onClick={() => setShowDetail(showDetail === "invoice" ? null : "invoice")}>
              <StatCard title="Invoice Sales" value={peso(invoiceSalesTotal)} icon={Receipt} variant="success" />
            </div>
            <div className={cn("cursor-pointer rounded-xl transition-all", showDetail === "combined" ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-border")} onClick={() => setShowDetail(showDetail === "combined" ? null : "combined")}>
              <StatCard title="Total Sales" value={peso(combinedTotal)} icon={DollarSign} variant="success" />
            </div>
          </div>

          {/* Detail tables */}
          {showDetail && (
            <div className="mt-4 space-y-4">
              {(showDetail === "online" || showDetail === "combined") && onlineSalesData.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Online Sales ({onlineSalesData.length})</h3>
                    {showDetail !== "combined" && (
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowDetail(null)}><X className="h-3.5 w-3.5" /></Button>
                    )}
                  </div>
                  <div className="data-table-wrapper">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Date</TableHead>
                          <TableHead className="text-xs">Order #</TableHead>
                          <TableHead className="text-xs">Product</TableHead>
                          <TableHead className="text-xs">Channel</TableHead>
                          <TableHead className="text-xs text-right">Qty</TableHead>
                          <TableHead className="text-xs text-right">Price</TableHead>
                          <TableHead className="text-xs text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {onlineSalesData.map((s: any) => (
                          <TableRow key={s.id} className="hover:bg-muted/30">
                            <TableCell className="text-sm text-muted-foreground">{s.order_date}</TableCell>
                            <TableCell className="font-mono text-xs font-semibold">{s.order_number}</TableCell>
                            <TableCell className="text-sm">{s.product_name}</TableCell>
                            <TableCell className="text-sm capitalize">{s.sales_channel}</TableCell>
                            <TableCell className="text-sm text-right">{s.quantity}</TableCell>
                            <TableCell className="text-sm text-right">{peso(Number(s.posted_price))}</TableCell>
                            <TableCell className="text-sm text-right font-medium">{peso(Number(s.posted_price) * (s.quantity || 1))}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {(showDetail === "invoice" || showDetail === "combined") && invoiceSalesData.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Invoice Sales ({invoiceSalesData.length})</h3>
                    {showDetail !== "combined" && (
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowDetail(null)}><X className="h-3.5 w-3.5" /></Button>
                    )}
                  </div>
                  <div className="data-table-wrapper">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Date</TableHead>
                          <TableHead className="text-xs">Invoice #</TableHead>
                          <TableHead className="text-xs">Customer</TableHead>
                          <TableHead className="text-xs">Sales Agent</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoiceSalesData.map((inv: any) => (
                          <TableRow key={inv.id} className="hover:bg-muted/30">
                            <TableCell className="text-sm text-muted-foreground">{inv.invoice_date}</TableCell>
                            <TableCell className="font-mono text-xs font-semibold">{inv.invoice_number}</TableCell>
                            <TableCell className="text-sm">{inv.customers?.name || "—"}</TableCell>
                            <TableCell className="text-sm">{inv.quotations?.sales_agent || "—"}</TableCell>
                            <TableCell><StatusBadge status={inv.status} context="invoice" /></TableCell>
                            <TableCell className="text-sm text-right font-medium">{peso(Number(inv.total_amount))}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {showDetail === "combined" && (
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowDetail(null)}>
                  <X className="h-3 w-3 mr-1" /> Close details
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Low Stock Alert */}
      {stats?.lowStockItems && stats.lowStockItems.length > 0 && (() => {
        const filteredLowStock = stats.lowStockItems.filter((item: any) => {
          const oo = item.on_order || { localQty: 0, overseasQty: 0 };
          const totalOnOrder = (oo.localQty || 0) + (oo.overseasQty || 0);
          if (lowStockFilter === "ordered") return totalOnOrder > 0;
          if (lowStockFilter === "not_ordered") return totalOnOrder === 0;
          return true;
        });
        const orderedCount = stats.lowStockItems.filter((item: any) => {
          const oo = item.on_order || { localQty: 0, overseasQty: 0 };
          return (oo.localQty || 0) + (oo.overseasQty || 0) > 0;
        }).length;
        const notOrderedCount = stats.lowStockItems.length - orderedCount;
        return (
        <div>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <h2 className="text-sm font-semibold">Low Stock Alerts</h2>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant={lowStockFilter === "all" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setLowStockFilter("all")}
              >
                All ({stats.lowStockItems.length})
              </Button>
              <Button
                variant={lowStockFilter === "ordered" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setLowStockFilter("ordered")}
              >
                Ordered ({orderedCount})
              </Button>
              <Button
                variant={lowStockFilter === "not_ordered" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setLowStockFilter("not_ordered")}
              >
                Not Ordered ({notOrderedCount})
              </Button>
              <button
                onClick={() => navigate("/inventory")}
                className="text-xs font-medium text-primary flex items-center gap-1 hover:underline ml-2"
              >
                View all <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>
          <div className="data-table-wrapper">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Item</TableHead>
                  <TableHead className="text-xs">SKU</TableHead>
                  <TableHead className="text-xs text-right">Qty</TableHead>
                  <TableHead className="text-xs text-right">Threshold</TableHead>
                  <TableHead className="text-xs">On Order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLowStock.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-6">
                      No items match this filter.
                    </TableCell>
                  </TableRow>
                ) : filteredLowStock.map((item: any) => {
                  const oo = item.on_order || { localQty: 0, overseasQty: 0, localPOs: [], overseasPOs: [] };
                  const totalOnOrder = oo.localQty + oo.overseasQty;
                  const editValue = editingThreshold[item.id];
                  const currentValue = editValue !== undefined ? editValue : String(item.low_stock_threshold);
                  const commit = () => {
                    const parsed = parseInt(currentValue, 10);
                    if (Number.isNaN(parsed) || parsed < 0) {
                      setEditingThreshold((prev) => {
                        const next = { ...prev };
                        delete next[item.id];
                        return next;
                      });
                      return;
                    }
                    if (parsed !== item.low_stock_threshold) {
                      updateThresholdMutation.mutate({ id: item.id, threshold: parsed });
                    }
                    setEditingThreshold((prev) => {
                      const next = { ...prev };
                      delete next[item.id];
                      return next;
                    });
                  };
                  return (
                    <TableRow key={item.id} className="hover:bg-muted/50">
                      <TableCell className="font-medium text-sm">{item.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">{item.sku}</TableCell>
                      <TableCell className="text-right text-sm font-semibold text-destructive">{item.quantity}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          value={currentValue}
                          onChange={(e) => setEditingThreshold((prev) => ({ ...prev, [item.id]: e.target.value }))}
                          onBlur={commit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") {
                              setEditingThreshold((prev) => {
                                const next = { ...prev };
                                delete next[item.id];
                                return next;
                              });
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          className="h-7 w-20 text-sm text-right ml-auto"
                        />
                      </TableCell>
                      <TableCell>
                        {totalOnOrder > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            {oo.localQty > 0 && (
                              <span className="inline-flex items-center gap-1 text-xs">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-success" />
                                <span className="font-medium">Local: +{oo.localQty}</span>
                                <span className="text-muted-foreground font-mono">({oo.localPOs.join(", ")})</span>
                              </span>
                            )}
                            {oo.overseasQty > 0 && (
                              <span className="inline-flex items-center gap-1 text-xs">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary" />
                                <span className="font-medium">Overseas: +{oo.overseasQty}</span>
                                <span className="text-muted-foreground font-mono">({oo.overseasPOs.join(", ")})</span>
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Not ordered</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
        );
      })()}

    </div>
  );
}
