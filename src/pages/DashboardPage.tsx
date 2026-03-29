import { useQuery } from "@tanstack/react-query";
import { getDashboardStats } from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Package, DollarSign, AlertTriangle, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function DashboardPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: getDashboardStats,
  });

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your business</p>
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
          title="Low Stock Items"
          value={stats?.lowStockItems.length || 0}
          icon={AlertTriangle}
          variant="warning"
        />
        <StatCard title="Recent Activity" value={(stats?.recentPOs.length || 0) + (stats?.recentInvoices.length || 0)} icon={TrendingUp} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Low Stock Alert */}
        {stats?.lowStockItems && stats.lowStockItems.length > 0 && (
          <Card className="glass-card lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Low Stock Alerts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Threshold</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.lowStockItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-muted-foreground">{item.sku}</TableCell>
                      <TableCell className="text-right text-destructive font-medium">{item.quantity}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{item.low_stock_threshold}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Recent POs */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">Recent Purchase Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.recentPOs.length ? (
              <div className="space-y-3">
                {stats.recentPOs.map((po) => (
                  <div key={po.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="font-medium text-sm">{po.po_number}</p>
                      <p className="text-xs text-muted-foreground">{po.suppliers?.name || "No supplier"}</p>
                    </div>
                    <StatusBadge status={po.status} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No purchase orders yet</p>
            )}
          </CardContent>
        </Card>

        {/* Recent Invoices */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">Recent Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.recentInvoices.length ? (
              <div className="space-y-3">
                {stats.recentInvoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="font-medium text-sm">{inv.invoice_number}</p>
                      <p className="text-xs text-muted-foreground">{inv.customers?.name || "No customer"}</p>
                    </div>
                    <StatusBadge status={inv.status} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No invoices yet</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
