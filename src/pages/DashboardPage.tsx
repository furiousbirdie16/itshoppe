import { useQuery } from "@tanstack/react-query";
import { getDashboardStats } from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Package, DollarSign, AlertTriangle, TrendingUp, ArrowRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNavigate } from "react-router-dom";

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: getDashboardStats,
  });

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
        <StatCard
          title="Inventory Value"
          value={`$${(stats?.totalValue || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
          icon={DollarSign}
          variant="success"
        />
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
