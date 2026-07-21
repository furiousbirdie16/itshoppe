import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SuppliersPage from "@/pages/SuppliersPage";
import OverseasSuppliersPage from "@/pages/OverseasSuppliersPage";

export default function SuppliersHubPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  if (!isAdmin) return <SuppliersPage />;

  return (
    <Tabs defaultValue="local" className="space-y-4">
      <TabsList>
        <TabsTrigger value="local">Local Suppliers</TabsTrigger>
        <TabsTrigger value="overseas">Overseas Suppliers</TabsTrigger>
      </TabsList>
      <TabsContent value="local" className="mt-0">
        <SuppliersPage />
      </TabsContent>
      <TabsContent value="overseas" className="mt-0">
        <OverseasSuppliersPage />
      </TabsContent>
    </Tabs>
  );
}
