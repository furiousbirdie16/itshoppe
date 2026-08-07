import { useQuery } from "@tanstack/react-query";
import { getDashboardStats } from "@/lib/api";
import { peso } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import { StatCard } from "@/components/StatCard";
import { DollarSign, TruckIcon, ShoppingCart, Receipt, Wallet, Banknote, Coins, TrendingUp, Landmark, PiggyBank, HandCoins, Scale } from "lucide-react";
import { useFinanceSummary } from "@/hooks/use-finance-summary";
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

  const finance = useFinanceSummary();

  // Net Asset Value = what we own minus what we owe.
  //
  // Supplier POs are deliberately excluded from both sides: an unpaid order has not
  // been paid for and its goods are not yet counted as Incoming Assets, so counting
  // it as a liability alone would understate net worth. Incoming Assets only picks
  // up overseas POs already paid and shipped.
  const inventoryValue = Number(stats?.totalValue || 0);
  const incomingAssets = Number(stats?.incomingAssetsValue || 0);
  const supplierPOs = Number(stats?.accountsPayableValue || 0);
  const assetsTotal = inventoryValue + finance.receivables + incomingAssets + finance.totalCashAvailable;
  const liabilitiesTotal =
    finance.billsAndChecks + Math.max(finance.dueToOwner, 0) + finance.loansOutstanding;
  const netAssetValue = assetsTotal - liabilitiesTotal;

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
            value={peso(inventoryValue)}
            icon={DollarSign}
            tone="asset"
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
            title="Total Cash Available"
            value={peso(finance.totalCashAvailable)}
            icon={Wallet}
            tone="asset"
            description={finance.foreignNote ? `incl. ${finance.foreignNote}` : "Cash + bank"}
          />
        )}
        {isAdmin && (
          <StatCard
            title="Receivables"
            value={peso(finance.receivables)}
            icon={Wallet}
            tone="asset"
            description="Unpaid invoices + manual"
          />
        )}
        {isAdmin && (
          <StatCard
            title="Incoming Assets"
            value={peso(incomingAssets)}
            icon={TruckIcon}
            tone="asset"
            description="Shipped goods in transit"
          />
        )}
        {isAdmin && (
          <StatCard
            title="Payables — Supplier POs"
            value={peso(supplierPOs)}
            icon={Banknote}
            tone="liability"
            description="Unpaid POs · not in Net Asset Value"
          />
        )}
        {isAdmin && (
          <StatCard
            title="Payables — Bills & Checks"
            value={peso(finance.billsAndChecks)}
            icon={Receipt}
            tone="liability"
            description="From the Payables page"
          />
        )}
        {isAdmin && (
          <StatCard
            title="Due to Owner"
            value={peso(finance.dueToOwner)}
            icon={HandCoins}
            tone="liability"
            description={finance.dueToOwner >= 0 ? "Not yet repaid" : "Overpaid"}
          />
        )}
        {isAdmin && (
          <StatCard
            title="Loans Outstanding"
            value={peso(finance.loansOutstanding)}
            icon={PiggyBank}
            tone="liability"
            description={`${peso(finance.monthlyLoanPayment)}/mo`}
          />
        )}
        {isAdmin && (
          <StatCard
            title="Net Asset Value"
            value={peso(netAssetValue)}
            icon={Scale}
            variant={netAssetValue >= 0 ? "success" : "warning"}
            description={`${peso(assetsTotal)} assets − ${peso(liabilitiesTotal)} liabilities`}
          />
        )}
      </div>

      {/* Analytics: charts (admin only) */}
      {isAdmin && <DashboardAnalytics />}



    </div>
  );
}
