import { useQuery } from "@tanstack/react-query";
import { getDashboardStats } from "@/lib/api";
import { peso } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import { StatCard } from "@/components/StatCard";
import { DollarSign, TruckIcon, ShoppingCart, Receipt, Wallet, Banknote, Coins, TrendingUp } from "lucide-react";
import { DashboardAnalytics } from "@/components/DashboardAnalytics";
import { useBranch } from "@/contexts/BranchContext";

export default function DashboardPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { activeBranchId, activeBranch } = useBranch();

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



    </div>
  );
}
