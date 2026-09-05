import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCustomers, getItems } from "@/lib/api";
import { fetchAllRows } from "@/lib/paginate";
import { getCustomerLastPrices } from "@/lib/customerPricing";
import { peso } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil, Search, Star } from "lucide-react";
import { FilterCombobox } from "@/components/FilterCombobox";
import { SetCustomerPriceDialog } from "@/components/SetCustomerPriceDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";
import { format } from "date-fns";
import { toast } from "sonner";

/**
 * What a customer pays for a product.
 *
 * One row per customer and product, showing the price the next invoice will
 * actually use: the last price they were charged, unless someone has pinned a
 * price for them. Buy again at a different price and this follows.
 */
export default function CustomerPricingPage() {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });
  const { data: items = [] } = useQuery({ queryKey: ["items"], queryFn: getItems });

  const customersById = useMemo(() => new Map((customers as any[]).map((c: any) => [c.id, c])), [customers]);
  const itemsById = useMemo(() => new Map((items as any[]).map((i: any) => [i.id, i])), [items]);

  // Pinned prices. Not shown as a separate list any more, but they still win
  // over the last sold price when an invoice is priced, so they are marked.
  const { data: pinned = [] } = useQuery({
    queryKey: ["customer_prices"],
    queryFn: () =>
      fetchAllRows<any>(() =>
        (supabase as any).from("customer_prices").select("*").order("updated_at", { ascending: false }).order("id"),
      ),
  });

  const { data: lastPrices = [], isLoading } = useQuery({
    queryKey: ["customer_last_prices"],
    queryFn: getCustomerLastPrices,
  });

  const [search, setSearch] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("all");
  const [filterItem, setFilterItem] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const pinnedByKey = useMemo(() => {
    const m = new Map<string, any>();
    for (const p of pinned) m.set(`${p.customer_id}|${p.item_id}|${p.variation_id ?? ""}`, p);
    return m;
  }, [pinned]);

  /**
   * One row per customer and product. Built from every pinned price and every
   * last sale, so a price that was pinned but never sold still appears.
   */
  const rows = useMemo(() => {
    const byKey = new Map<string, any>();

    for (const l of lastPrices) {
      const key = `${l.customer_id}|${l.item_id}|${l.variation_id ?? ""}`;
      byKey.set(key, { key, ...l, pinned: null });
    }
    for (const p of pinned) {
      const key = `${p.customer_id}|${p.item_id}|${p.variation_id ?? ""}`;
      const existing = byKey.get(key);
      if (existing) existing.pinned = p;
      else {
        byKey.set(key, {
          key,
          customer_id: p.customer_id,
          item_id: p.item_id,
          variation_id: p.variation_id ?? null,
          unit_price: null,
          sold_at: null,
          reference_number: null,
          times_bought: 0,
          pinned: p,
        });
      }
    }

    return Array.from(byKey.values()).map((r) => {
      const c = customersById.get(r.customer_id);
      const i = itemsById.get(r.item_id);
      const standard = Number(i?.selling_price ?? 0);
      const pinnedPrice = r.pinned ? Number(r.pinned.fixed_price) : null;
      const lastPrice = r.unit_price == null ? null : Number(r.unit_price);
      // The figure an invoice will use, in the same order getCustomerPrice does.
      const price = pinnedPrice ?? lastPrice ?? standard;
      return {
        ...r,
        customer_name: c?.name ?? "(deleted customer)",
        item_name: i?.name ?? "(archived product)",
        item_sku: i?.sku ?? "",
        standard,
        pinnedPrice,
        lastPrice,
        price,
        diff: price - standard,
      };
    });
  }, [lastPrices, pinned, customersById, itemsById]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterCustomer !== "all" && r.customer_id !== filterCustomer) return false;
      if (filterItem !== "all" && r.item_id !== filterItem) return false;
      if (!q) return true;
      return `${r.customer_name} ${r.item_name} ${r.item_sku}`.toLowerCase().includes(q);
    });
  }, [rows, filterCustomer, filterItem, search]);

  const { sort, toggle, sorted } = useSort(filtered, {
    customer: (r: any) => r.customer_name,
    item: (r: any) => r.item_name,
    price: (r: any) => r.price,
    standard: (r: any) => r.standard,
    diff: (r: any) => r.diff,
    sold_at: (r: any) => r.sold_at || "",
  }, { key: "customer", dir: "asc" });

  // Options come from the rows on screen, so every customer with a price is
  // selectable — including one who has bought but has nothing pinned.
  const customerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.customer_id)) seen.set(r.customer_id, r.customer_name);
    return Array.from(seen, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const itemOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.item_id)) seen.set(r.item_id, r.item_name);
    return Array.from(seen, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const unpinMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("customer_prices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer_prices"] });
      toast.success("Pinned price removed — the last sold price applies again");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Customer Pricing</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            What each customer pays. This is the price an invoice fills in for them.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }} size="sm" className="h-9 rounded-lg">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Pin a Price
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer, product, SKU…"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <FilterCombobox value={filterCustomer} onChange={setFilterCustomer} options={customerOptions} placeholder="All Customers" allLabel="All Customers" className="h-9 sm:w-52" />
        <FilterCombobox value={filterItem} onChange={setFilterItem} options={itemOptions} placeholder="All Products" allLabel="All Products" className="h-9 sm:w-56" />
        <span className="text-xs text-muted-foreground ml-auto">
          {sorted.length} price{sorted.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Phones get stacked cards; the table needs a horizontal scroll that
          would hide the price, which is the only reason to open this page. */}
      <div className="md:hidden space-y-2">
        {sorted.length === 0 ? (
          <div className="rounded-xl border bg-card py-8 text-center text-sm text-muted-foreground">
            {isLoading ? "Loading…" : "No customer prices yet."}
          </div>
        ) : (
          sorted.map((r: any) => (
            <div key={r.key} className="rounded-xl border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.customer_name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.item_name}{r.item_sku ? ` · ${r.item_sku}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-base font-semibold tabular-nums inline-flex items-center gap-1">
                    {r.pinnedPrice != null && <Star className="h-3 w-3 fill-primary text-primary" />}
                    {peso(r.price)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">std {peso(r.standard)}</div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2 text-[11px] text-muted-foreground">
                <span>
                  {r.sold_at
                    ? `Last bought ${format(new Date(r.sold_at), "MMM d, yyyy")}${r.times_bought > 1 ? ` · ${r.times_bought}×` : ""}`
                    : "Never bought — pinned price"}
                </span>
                <div className="flex shrink-0 gap-0.5">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditing({ ...r, fixed_price: r.price, id: r.pinned?.id ?? null }); setDialogOpen(true); }} aria-label="Pin a price">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {isAdmin && r.pinned && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { if (confirm("Remove the pinned price? The last sold price will apply instead.")) unpinMut.mutate(r.pinned.id); }} aria-label="Remove pinned price">
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="data-table-wrapper hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader sortKey="customer" label="Customer" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="item" label="Product" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="price" label="Their Price" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="standard" label="Standard" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="diff" label="Diff" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="sold_at" label="Last Bought" sort={sort} onToggle={toggle} />
              <TableHead className="text-xs text-right w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-8">
                  {isLoading ? "Loading…" : "No customer prices yet — they appear as customers buy."}
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((r: any) => (
                <TableRow key={r.key}>
                  <TableCell className="text-sm font-medium">{r.customer_name}</TableCell>
                  <TableCell className="text-sm">
                    <div>{r.item_name}</div>
                    {r.item_sku && <div className="text-[11px] text-muted-foreground">{r.item_sku}</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm font-semibold tabular-nums inline-flex items-center gap-1">
                      {r.pinnedPrice != null && (
                        <Star className="h-3 w-3 fill-primary text-primary" aria-label="Pinned price" />
                      )}
                      {peso(r.price)}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-right tabular-nums text-muted-foreground">{peso(r.standard)}</TableCell>
                  <TableCell className={`text-sm text-right tabular-nums ${r.diff < 0 ? "text-destructive" : r.diff > 0 ? "text-green-600" : ""}`}>
                    {r.diff === 0 ? "—" : `${r.diff > 0 ? "+" : ""}${peso(r.diff)}`}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.sold_at ? (
                      <>
                        {format(new Date(r.sold_at), "MMM d, yyyy")}
                        {r.times_bought > 1 && <span className="ml-1">· {r.times_bought}×</span>}
                      </>
                    ) : (
                      "never bought"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title={r.pinned ? "Edit pinned price" : "Pin this price"}
                      onClick={() => { setEditing({ ...r, fixed_price: r.price, id: r.pinned?.id ?? null }); setDialogOpen(true); }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {isAdmin && r.pinned && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Remove pinned price"
                        onClick={() => { if (confirm("Remove the pinned price? The last sold price will apply instead.")) unpinMut.mutate(r.pinned.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
