import { useQuery } from "@tanstack/react-query";
import { getDashboardStats } from "@/lib/api";
import { peso } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import { StatCard, FormulaRow } from "@/components/StatCard";
import { DollarSign, TruckIcon, ShoppingCart, Receipt, Wallet, Banknote, Coins, TrendingUp, Landmark, PiggyBank, HandCoins, Scale, BookmarkPlus } from "lucide-react";
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
  // Reserving an invoice deducts the stock, so it has already left
  // inventoryValue. The goods are still ours until the sale completes — carried
  // at cost, so reserving an order moves value sideways instead of destroying it.
  const reservedStock = Number(stats?.reservedStockValue || 0);
  const incomingAssets = Number(stats?.incomingAssetsValue || 0);
  const supplierPOs = Number(stats?.accountsPayableValue || 0);
  const assetsTotal =
    inventoryValue + reservedStock + finance.receivables + incomingAssets + finance.totalCashAvailable;
  const liabilitiesTotal =
    finance.billsAndChecks + Math.max(finance.dueToOwner, 0) + finance.loansOutstanding;
  const netAssetValue = assetsTotal - liabilitiesTotal;

  // What is genuinely free to spend: cash on hand less everything already
  // committed to suppliers and bills. Can go negative, which is the point —
  // that means commitments already exceed the cash to cover them.
  const cashForPurchasing = finance.totalCashAvailable - supplierPOs - finance.billsAndChecks;

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
            formula={
              <div className="space-y-1">
                <p>Everything sold today, counted once the customer has paid.</p>
                <FormulaRow label="Invoices marked paid or completed" value="by invoice date" muted />
                <FormulaRow label="Online orders placed today" value="excl. cancelled / returned" muted />
              </div>
            }
          />
        )}
        {isAdmin && (
          <StatCard
            title="Sales This Month"
            value={peso(stats?.salesThisMonth || 0)}
            icon={TrendingUp}
            variant="success"
            description="Month to date"
            formula={
              <div className="space-y-1">
                <p>The same rule as Sales Today, from the 1st of this month to today.</p>
                <FormulaRow label="Paid invoices + online orders" value="this month" muted />
              </div>
            }
          />
        )}
        {isAdmin && (
          <StatCard
            title="Gross Profit"
            value={peso(stats?.grossProfitMonth || 0)}
            icon={Coins}
            variant="success"
            description="Month to date"
            formula={
              <div className="space-y-1">
                <p>Selling price less cost, added up line by line across this month\u2019s paid invoices.</p>
                <FormulaRow label="Basis" value="same invoices as Sales This Month" muted />
              </div>
            }
          />
        )}
        {isAdmin && (
          <StatCard
            title="Inventory Value"
            value={peso(inventoryValue)}
            icon={DollarSign}
            tone="asset"
            description="Goods on hand"
            formula={
              <div className="space-y-1">
                <p>Quantity on hand \u00d7 cost price, every item and branch added together.</p>
                <FormulaRow label="Stock source" value="per-branch stock" muted />
                <FormulaRow label="Archived items" value="excluded" muted />
                {activeBranch && <FormulaRow label="Scoped to" value={activeBranch.branch_code} muted />}
              </div>
            }
          />
        )}
        {isAdmin && reservedStock > 0 && (
          <StatCard
            title="Reserved Stock"
            value={peso(reservedStock)}
            icon={BookmarkPlus}
            tone="asset"
            description="Allocated, at cost"
            formula={
              <div className="space-y-1">
                <p>Goods already taken out of stock for a reserved invoice, but not yet sold.</p>
                <p className="text-muted-foreground">Still yours, so carried at cost \u2014 reserving an order moves value across rather than destroying it.</p>
              </div>
            }
          />
        )}
        <StatCard
          title="Purchase Orders"
          value={stats?.openPurchaseOrders || 0}
          icon={Receipt}
          description="Open local + overseas"
          formula={
            <div className="space-y-1">
              <p>A count, not a value: every purchase order not yet marked received.</p>
              <FormulaRow label="Local + overseas" value="all open statuses" muted />
            </div>
          }
        />
        {isAdmin && (
          <StatCard
            title="Total Cash Available"
            value={peso(finance.totalCashAvailable)}
            icon={Wallet}
            tone="asset"
            description={finance.foreignNote ? `incl. ${finance.foreignNote}` : "Cash + bank"}
            formula={
              <div className="space-y-1">
                <FormulaRow label="Petty cash accounts" value={peso(finance.cashTotal)} />
                <FormulaRow label="Bank accounts" value={peso(finance.bankTotal)} />
                <p className="text-muted-foreground pt-1">Active accounts only. Foreign currency is carried at what those units actually cost, not today\u2019s rate. The owner account is a debt, not cash, so it is left out.</p>
              </div>
            }
          />
        )}
        {isAdmin && (
          <StatCard
            title="Receivables"
            value={peso(finance.receivables)}
            icon={Wallet}
            tone="asset"
            description="Unpaid invoices + manual"
            formula={
              <div className="space-y-1">
                <p>Money customers still owe you.</p>
                <FormulaRow label="Invoices" value="confirmed, unpaid, shipped" muted />
                <FormulaRow label="Plus manual receivables" value="not marked paid" muted />
              </div>
            }
          />
        )}
        {isAdmin && (
          <StatCard
            title="Incoming Assets"
            value={peso(incomingAssets)}
            icon={TruckIcon}
            tone="asset"
            description="Shipped goods in transit"
            formula={
              <div className="space-y-1">
                <p>Overseas goods you have paid for that have not arrived yet.</p>
                <FormulaRow label="Value" value="remaining qty \u00d7 cost \u00d7 rate" muted />
                <FormulaRow label="Counts from" value="paid, not shipped \u2192 in transit" muted />
                <p className="text-muted-foreground pt-1">Unpaid orders are excluded \u2014 you own neither the goods nor the debt yet.</p>
              </div>
            }
          />
        )}
        {isAdmin && (
          <StatCard
            title="Payables — Supplier POs"
            value={peso(supplierPOs)}
            icon={Banknote}
            tone="liability"
            description="Unpaid POs · not in Net Asset Value"
            formula={
              <div className="space-y-1">
                <p>Purchase orders you have not paid for yet.</p>
                <p className="text-muted-foreground">Left out of Net Asset Value on purpose: the debt and the goods it buys cancel each other, so counting the debt alone would drop your net worth every time you placed an order.</p>
              </div>
            }
          />
        )}
        {isAdmin && (
          <StatCard
            title="Payables — Bills & Checks"
            value={peso(finance.billsAndChecks)}
            icon={Receipt}
            tone="liability"
            description="From the Payables page"
            formula={
              <div className="space-y-1">
                <p>Amount less amount paid, across every payable not settled.</p>
                <FormulaRow label="Excludes" value="paid, cleared, cancelled" muted />
              </div>
            }
          />
        )}
        {isAdmin && (
          <StatCard
            title="Due to Owner"
            value={peso(finance.dueToOwner)}
            icon={HandCoins}
            tone="liability"
            description={finance.dueToOwner >= 0 ? "Not yet repaid" : "Overpaid"}
            formula={
              <div className="space-y-1">
                <p>What the owner spent for the company, less what has been repaid.</p>
                <FormulaRow label="Money out of the owner account" value="owner paid for the company" muted />
                <FormulaRow label="Less money in" value="company repaid the owner" muted />
                <p className="text-muted-foreground pt-1">An overpaid owner is not counted as an asset in Net Asset Value.</p>
              </div>
            }
          />
        )}
        {isAdmin && (
          <StatCard
            title="Loans Outstanding"
            value={peso(finance.loansOutstanding)}
            icon={PiggyBank}
            tone="liability"
            description={`${peso(finance.monthlyLoanPayment)}/mo`}
            formula={
              <div className="space-y-1">
                <p>The principal recorded on every loan, added together.</p>
                <FormulaRow label="Monthly payments" value={peso(finance.monthlyLoanPayment)} muted />
                <p className="text-muted-foreground pt-1">This is the amount borrowed, not a running balance \u2014 repayments do not reduce it.</p>
              </div>
            }
          />
        )}
        {isAdmin && (
          <StatCard
            title="Cash Available for Purchase"
            value={peso(cashForPurchasing)}
            icon={Wallet}
            tone={cashForPurchasing >= 0 ? "asset" : "liability"}
            description={
              cashForPurchasing >= 0
                ? "Cash less supplier POs and bills"
                : "Commitments exceed cash on hand"
            }
            formula={
              <div className="space-y-1">
                <FormulaRow label="Total cash available" value={peso(finance.totalCashAvailable)} />
                <FormulaRow label="Less supplier POs" value={`\u2212 ${peso(supplierPOs)}`} />
                <FormulaRow label="Less bills & checks" value={`\u2212 ${peso(finance.billsAndChecks)}`} />
                <div className="border-t my-1" />
                <FormulaRow label="Free to spend" value={peso(cashForPurchasing)} />
                <p className="text-muted-foreground pt-1">Goes negative when what you have committed already exceeds the cash to cover it.</p>
              </div>
            }
          />
        )}
        {isAdmin && (
          <StatCard
            title="Net Asset Value"
            value={peso(netAssetValue)}
            icon={Scale}
            variant={netAssetValue >= 0 ? "success" : "warning"}
            description={`${peso(assetsTotal)} assets − ${peso(liabilitiesTotal)} liabilities`}
            formula={
              <div className="space-y-1">
                <FormulaRow label="Inventory" value={peso(inventoryValue)} />
                {reservedStock > 0 && <FormulaRow label="Reserved stock" value={peso(reservedStock)} />}
                <FormulaRow label="Receivables" value={peso(finance.receivables)} />
                <FormulaRow label="Incoming" value={peso(incomingAssets)} />
                <FormulaRow label="Cash & bank" value={peso(finance.totalCashAvailable)} />
                <div className="border-t my-1" />
                <FormulaRow label="Bills & checks" value={`\u2212 ${peso(finance.billsAndChecks)}`} />
                <FormulaRow label="Due to owner" value={`\u2212 ${peso(Math.max(finance.dueToOwner, 0))}`} />
                <FormulaRow label="Loans" value={`\u2212 ${peso(finance.loansOutstanding)}`} />
                <div className="border-t my-1" />
                <FormulaRow label="Net Asset Value" value={peso(netAssetValue)} />
                <p className="text-muted-foreground pt-1">Unpaid supplier POs are in neither side: the debt and the goods cancel.</p>
              </div>
            }
          />
        )}
      </div>

      {/* Analytics: charts (admin only) */}
      {isAdmin && <DashboardAnalytics />}



    </div>
  );
}
