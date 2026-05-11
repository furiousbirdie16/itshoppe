import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCustomers, getItems } from "@/lib/api";
import { peso } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil, Search, Star } from "lucide-react";
import { FilterCombobox } from "@/components/FilterCombobox";
import { SetCustomerPriceDialog } from "@/components/SetCustomerPriceDialog";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { toast } from "sonner";

export default function CustomerPricingPage() {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });
  const { data: items = [] } = useQuery({ queryKey: ["items"], queryFn: getItems });

  const customersById = useMemo(() => new Map((customers as any[]).map((c: any) => [c.id, c])), [customers]);
  const itemsById = useMemo(() => new Map((items as any[]).map((i: any) => [i.id, i])), [items]);

  const { data: prices = [] } = useQuery({
    queryKey: ["customer_prices"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("customer_prices")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["customer_price_history"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("customer_price_history")
        .select("*")
        .order("sold_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data || [];
    },
  });

  const [search, setSearch] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("all");
  const [filterItem, setFilterItem] = useState("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  // Fixed prices, enriched + filtered
  const enrichedPrices = useMemo(() => {
    return (prices as any[]).map((p) => {
      const c = customersById.get(p.customer_id);
      const i = itemsById.get(p.item_id);
      return {
        ...p,
        customer_name: c?.name ?? "(unknown)",
        item_name: i?.name ?? "(unknown)",
        item_sku: i?.sku ?? "",
        cost: Number(i?.cost_price ?? 0),
        standard: Number(i?.selling_price ?? 0),
      };
    });
  }, [prices, customersById, itemsById]);

  const filteredPrices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrichedPrices.filter((r: any) => {
      if (filterCustomer !== "all" && r.customer_id !== filterCustomer) return false;
      if (filterItem !== "all" && r.item_id !== filterItem) return false;
      if (q) {
        const hay = `${r.customer_name} ${r.item_name} ${r.item_sku}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enrichedPrices, filterCustomer, filterItem, search]);

  // History enrichment + aggregation
  const enrichedHistory = useMemo(() => {
    return (history as any[]).map((h) => {
      const c = customersById.get(h.customer_id);
      const i = itemsById.get(h.item_id);
      const cost = Number(i?.cost_price ?? 0);
      const price = Number(h.unit_price ?? 0);
      const margin = cost > 0 ? ((price - cost) / cost) * 100 : null;
      return {
        ...h,
        customer_name: c?.name ?? "(unknown)",
        item_name: i?.name ?? "(unknown)",
        item_sku: i?.sku ?? "",
        cost,
        margin,
      };
    });
  }, [history, customersById, itemsById]);

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrichedHistory.filter((r: any) => {
      if (filterCustomer !== "all" && r.customer_id !== filterCustomer) return false;
      if (filterItem !== "all" && r.item_id !== filterItem) return false;
      if (q) {
        const hay = `${r.customer_name} ${r.item_name} ${r.item_sku} ${r.reference_number || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enrichedHistory, filterCustomer, filterItem, search]);

  // Frequency map per (customer, item) for the History tab
  const freqMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of enrichedHistory as any[]) {
      const k = `${r.customer_id}|${r.item_id}`;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [enrichedHistory]);

  // Available filter options based on whichever tab data
  const baseSet = filteredPrices.length > 0 || prices.length > 0 ? enrichedPrices : enrichedHistory;
  const customerOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const r of baseSet as any[]) {
      if (seen.has(r.customer_id)) continue;
      seen.add(r.customer_id);
      out.push({ value: r.customer_id, label: r.customer_name });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [baseSet]);
  const itemOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const r of baseSet as any[]) {
      if (seen.has(r.item_id)) continue;
      seen.add(r.item_id);
      out.push({ value: r.item_id, label: r.item_name });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [baseSet]);

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("customer_prices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer_prices"] });
      toast.success("Customer price removed");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Customer Pricing</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Fixed prices and complete sold-price history per customer.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }} size="sm" className="h-9 rounded-lg">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Set Customer Price
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer, product, SKU…" className="h-9 pl-8 text-sm" />
        </div>
        <FilterCombobox
          value={filterCustomer}
          onChange={setFilterCustomer}
          options={customerOptions}
          placeholder="All Customers"
          allLabel="All Customers"
          className="h-9 sm:w-52"
        />
        <FilterCombobox
          value={filterItem}
          onChange={setFilterItem}
          options={itemOptions}
          placeholder="All Products"
          allLabel="All Products"
          className="h-9 sm:w-56"
        />
      </div>

      <Tabs defaultValue="fixed">
        <TabsList>
          <TabsTrigger value="fixed">Fixed Prices ({filteredPrices.length})</TabsTrigger>
          <TabsTrigger value="history">Price History ({filteredHistory.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="fixed" className="mt-3">
          <div className="data-table-wrapper">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Customer</TableHead>
                  <TableHead className="text-xs">Product</TableHead>
                  <TableHead className="text-xs text-right">Standard</TableHead>
                  <TableHead className="text-xs text-right">Fixed</TableHead>
                  <TableHead className="text-xs text-right">Diff</TableHead>
                  <TableHead className="text-xs">Updated</TableHead>
                  <TableHead className="text-xs text-right w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPrices.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-8">No fixed prices yet.</TableCell></TableRow>
                ) : (
                  filteredPrices.map((r: any) => {
                    const diff = Number(r.fixed_price) - r.standard;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm font-medium">{r.customer_name}</TableCell>
                        <TableCell className="text-sm">
                          <div>{r.item_name}</div>
                          {r.item_sku && <div className="text-[11px] text-muted-foreground">{r.item_sku}</div>}
                        </TableCell>
                        <TableCell className="text-sm text-right tabular-nums">{peso(r.standard)}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums font-semibold inline-flex items-center justify-end gap-1 w-full">
                          <Star className="h-3 w-3 fill-primary text-primary" /> {peso(Number(r.fixed_price))}
                        </TableCell>
                        <TableCell className={`text-sm text-right tabular-nums ${diff < 0 ? "text-destructive" : diff > 0 ? "text-green-600" : ""}`}>
                          {diff === 0 ? "—" : `${diff > 0 ? "+" : ""}${peso(diff)}`}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{format(new Date(r.updated_at), "MMM d, yyyy")}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(r); setDialogOpen(true); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {isAdmin && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { if (confirm("Remove this customer price?")) deleteMut.mutate(r.id); }}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-3">
          <div className="data-table-wrapper">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Customer</TableHead>
                  <TableHead className="text-xs">Product</TableHead>
                  <TableHead className="text-xs">Source</TableHead>
                  <TableHead className="text-xs">Reference</TableHead>
                  <TableHead className="text-xs text-right">Qty</TableHead>
                  <TableHead className="text-xs text-right">Price</TableHead>
                  <TableHead className="text-xs text-right">Margin</TableHead>
                  <TableHead className="text-xs text-right">Bought</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredHistory.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-8">No price history yet.</TableCell></TableRow>
                ) : (
                  filteredHistory.slice(0, 500).map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{format(new Date(r.sold_at), "MMM d, yyyy")}</TableCell>
                      <TableCell className="text-sm">{r.customer_name}</TableCell>
                      <TableCell className="text-sm">
                        <div>{r.item_name}</div>
                        {r.item_sku && <div className="text-[11px] text-muted-foreground">{r.item_sku}</div>}
                      </TableCell>
                      <TableCell className="text-xs capitalize">{r.source}</TableCell>
                      <TableCell className="text-xs">{r.reference_number || "—"}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums">{Number(r.quantity)}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums">{peso(Number(r.unit_price))}</TableCell>
                      <TableCell className={`text-sm text-right tabular-nums ${r.margin == null ? "" : r.margin < 0 ? "text-destructive" : "text-green-600"}`}>
                        {r.margin == null ? "—" : `${r.margin.toFixed(1)}%`}
                      </TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">
                        {freqMap.get(`${r.customer_id}|${r.item_id}`) || 1}×
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {filteredHistory.length > 500 && (
              <div className="text-[11px] text-muted-foreground p-2">Showing latest 500 records — refine filters to see more.</div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <SetCustomerPriceDialog
        open={dialogOpen}
        onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(null); }}
        customerId={editing?.customer_id}
        itemId={editing?.item_id}
        variationId={editing?.variation_id ?? null}
        initialPrice={editing ? Number(editing.fixed_price) : undefined}
        editingId={editing?.id ?? null}
      />
    </div>
  );
}
