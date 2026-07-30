import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { getDashboardStats, updateItem } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { peso } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import { StatCard } from "@/components/StatCard";
import { Package, DollarSign, AlertTriangle, TruckIcon, ArrowRight, ShoppingCart, Receipt, Wallet, Banknote, Coins, TrendingUp } from "lucide-react";
import { DashboardAnalytics } from "@/components/DashboardAnalytics";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useBranch } from "@/contexts/BranchContext";

type LowStockFilter = "all" | "ordered" | "not_ordered";

export default function DashboardPage() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { activeBranchId, activeBranch } = useBranch();
  const queryClient = useQueryClient();

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

  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboard", activeBranchId],
    queryFn: () => getDashboardStats(activeBranchId),
  });

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
        <p className="page-description">
          {activeBranch ? `${activeBranch.branch_name} (${activeBranch.branch_code})` : "All branches — company-wide totals"}
        </p>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        {isAdmin && (
          <StatCard
            title="Sales Today"
            value={peso(stats?.salesToday || 0)}
            icon={ShoppingCart}
            variant="success"
            description="Invoices + online sales"
          />
        )}
        {isAdmin && (
          <StatCard
            title="Sales This Month"
            value={peso(stats?.salesThisMonth || 0)}
            icon={TrendingUp}
            variant="success"
            description="Month to date"
          />
        )}
        {isAdmin && (
          <StatCard
            title="Gross Profit"
            value={peso(stats?.grossProfitMonth || 0)}
            icon={Coins}
            variant="success"
            description="Month to date"
          />
        )}
        {isAdmin && (
          <StatCard
            title="Inventory Value"
            value={peso(stats?.totalValue || 0)}
            icon={DollarSign}
            description="Goods on hand"
          />
        )}
        <StatCard
          title="Purchase Orders"
          value={stats?.openPurchaseOrders || 0}
          icon={Receipt}
          description="Open local + overseas"
        />
        {isAdmin && (
          <StatCard
            title="Receivables"
            value={peso(stats?.receivablesValue || 0)}
            icon={Wallet}
            variant="warning"
            description="Unpaid invoices"
          />
        )}
        {isAdmin && (
          <StatCard
            title="Payables"
            value={peso(stats?.accountsPayableValue || 0)}
            icon={Banknote}
            variant="warning"
            description="Owed to suppliers"
          />
        )}
        <StatCard
          title="Low Stock Items"
          value={stats?.lowStockItems.length || 0}
          icon={AlertTriangle}
          variant="warning"
        />
        <StatCard title="Total Items" value={stats?.totalItems || 0} icon={Package} />
        {isAdmin && (
          <StatCard
            title="Incoming Assets"
            value={peso(stats?.incomingAssetsValue || 0)}
            icon={TruckIcon}
            description="Paid goods in transit"
          />
        )}
        {isAdmin && (
          <StatCard
            title="Total Asset Value"
            value={peso(stats?.totalAssetValue || 0)}
            icon={Coins}
            variant="success"
            description="Inventory + Incoming + Payable"
          />
        )}
      </div>

      {/* Analytics: charts (admin only) */}
      {isAdmin && <DashboardAnalytics />}


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
