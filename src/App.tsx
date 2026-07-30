import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { BranchProvider } from "@/contexts/BranchContext";
import { AppLayout } from "@/components/AppLayout";
import AuthPage from "@/pages/AuthPage";
import DashboardPage from "@/pages/DashboardPage";
import InventoryPage from "@/pages/InventoryPage";
import LowStockAlertsPage from "@/pages/LowStockAlertsPage";
import StockTransfersPage from "@/pages/StockTransfersPage";
import SuppliersHubPage from "@/pages/SuppliersHubPage";
import OverseasPurchaseOrdersPage from "@/pages/OverseasPurchaseOrdersPage";
import ShipmentTrackingPage from "@/pages/ShipmentTrackingPage";
import CustomersPage from "@/pages/CustomersPage";
import PurchaseOrdersPage from "@/pages/PurchaseOrdersPage";
import QuotationsPage from "@/pages/QuotationsPage";
import InvoicesPage from "@/pages/InvoicesPage";
import PendingPaymentsPage from "@/pages/PendingPaymentsPage";
import OnlineSalesPage from "@/pages/OnlineSalesPage";
import CustomerPricingPage from "@/pages/CustomerPricingPage";
import SettingsPage from "@/pages/SettingsPage";
import UsersPage from "@/pages/UsersPage";
import ActivityLogPage from "@/pages/ActivityLogPage";
import BusinessInsightsPage from "@/pages/BusinessInsightsPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();
  if (role !== "admin") return <Navigate to="/inventory" replace />;
  return <>{children}</>;
}


function ProtectedRoutes() {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <BranchProvider>
      <AppLayout>
        <Routes>
          <Route path="/" element={role === "admin" ? <DashboardPage /> : <Navigate to="/inventory" replace />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/stock-transfers" element={<StockTransfersPage />} />
          <Route path="/low-stock-alerts" element={<LowStockAlertsPage />} />
          <Route path="/suppliers" element={<AdminRoute><SuppliersHubPage /></AdminRoute>} />

          <Route path="/overseas-suppliers" element={<Navigate to="/suppliers" replace />} />
          <Route path="/overseas-purchase-orders" element={<OverseasPurchaseOrdersPage />} />
          <Route path="/shipment-tracking" element={<Navigate to="/overseas-purchase-orders" replace />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
          <Route path="/quotations" element={<QuotationsPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/pending-payments" element={<PendingPaymentsPage />} />
          <Route path="/online-sales" element={<OnlineSalesPage />} />
          <Route path="/customer-pricing" element={<CustomerPricingPage />} />
          <Route path="/activity-log" element={<AdminRoute><ActivityLogPage /></AdminRoute>} />
          <Route path="/business-insights" element={<BusinessInsightsPage />} />
          <Route path="/settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
          <Route path="/users" element={<AdminRoute><UsersPage /></AdminRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppLayout>
    </BranchProvider>
  );
}

function AuthRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <AuthPage />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<AuthRoute />} />
            <Route path="/*" element={<ProtectedRoutes />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
