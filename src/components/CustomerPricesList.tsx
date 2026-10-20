import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Pencil, Plus, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { SetCustomerPriceDialog } from "@/components/SetCustomerPriceDialog";
import { getCustomerPriceHistory, latestPricesFrom } from "@/lib/customerPricing";
import { peso } from "@/lib/currency";

/**
 * What one customer pays for each product, for the customer's own panel.
 *
 * The price an invoice will fill in for them: a pinned price if there is one,
 * otherwise the last price they were charged. The same rule as Customer
 * Pricing, so staff looking a customer up see the figure the invoice will use.
 */
export function CustomerPricesList({ customerId }: { customerId: string }) {
  const [editing, setEditing] = useState<{ item_id?: string; variation_id?: string | null; price?: number; id?: string | null } | null>(null);

  const { data: history = [], isLoading } = useQuery({
    queryKey: ["customer-price-history", customerId],
    queryFn: () => getCustomerPriceHistory(customerId),
  });
  const { data: pinned = [] } = useQuery({
    queryKey: ["customer_prices", customerId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("customer_prices").select("*").eq("customer_id", customerId);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const latest = useMemo(() => latestPricesFrom(history), [history]);

  // Pinned prices for products never bought still belong in the list.
  const rows = useMemo(() => {
    const pinnedByKey = new Map(pinned.map((p) => [`${p.item_id}|${p.variation_id ?? ""}`, p]));
    const out = latest.map((l) => ({ ...l, pinned: pinnedByKey.get(`${l.item_id}|${l.variation_id ?? ""}`) ?? null }));
    const seen = new Set(out.map((r) => `${r.item_id}|${r.variation_id ?? ""}`));
    for (const p of pinned) {
      const key = `${p.item_id}|${p.variation_id ?? ""}`;
      if (seen.has(key)) continue;
      out.push({ item_id: p.item_id, variation_id: p.variation_id ?? null, unit_price: Number(p.fixed_price), sold_at: "", reference_number: null, times_bought: 0, pinned: p });
    }
    return out;
  }, [latest, pinned]);

  const itemIds = useMemo(() => [...new Set(rows.map((r) => r.item_id))], [rows]);
  const variationIds = useMemo(() => [...new Set(rows.map((r) => r.variation_id).filter(Boolean) as string[])], [rows]);
  const { data: names } = useQuery({
    queryKey: ["customer-price-names", itemIds, variationIds],
    enabled: itemIds.length > 0,
    queryFn: async () => {
      const chunks = <T,>(arr: T[]) => Array.from({ length: Math.ceil(arr.length / 150) }, (_, i) => arr.slice(i * 150, i * 150 + 150));
      const items: any[] = [];
      const variations: any[] = [];
      for (const c of chunks(itemIds)) {
        const { data } = await (supabase as any).from("items").select("id, name, sku, selling_price").in("id", c);
        items.push(...(data || []));
      }
      for (const c of chunks(variationIds)) {
        const { data } = await (supabase as any).from("item_variations").select("id, name").in("id", c);
        variations.push(...(data || []));
      }
      return {
        items: new Map(items.map((i) => [i.id, i])),
        variations: new Map(variations.map((v) => [v.id, v])),
      };
    },
  });

  return (
    <div className="mt-4 border-t pt-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Their prices{rows.length ? ` · ${rows.length}` : ""}
        </p>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
            <Link to={`/customer-pricing?customer=${customerId}`}>Open in Customer Pricing</Link>
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditing({})}>
            <Plus className="mr-1 h-3 w-3" /> Pin a price
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No prices yet — they appear as this customer buys.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {rows.map((r) => {
            const item = names?.items.get(r.item_id);
            const variation = r.variation_id ? names?.variations.get(r.variation_id) : null;
            const price = r.pinned ? Number(r.pinned.fixed_price) : r.unit_price;
            const standard = Number(item?.selling_price ?? 0);
            return (
              <div key={`${r.item_id}|${r.variation_id ?? ""}`} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm">
                    {item?.name ?? "…"}
                    {variation?.name && <span className="text-muted-foreground"> · {variation.name}</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.sold_at
                      ? <>Last bought {format(new Date(r.sold_at), "MMM d, yyyy")}{r.times_bought > 1 && ` · ${r.times_bought}×`}</>
                      : "Never bought — pinned price"}
                    {standard > 0 && ` · std ${peso(standard)}`}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums">
                    {r.pinned && <Star className="h-3 w-3 fill-primary text-primary" aria-label="Pinned price" />}
                    {peso(price)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title={r.pinned ? "Edit pinned price" : "Pin this price"}
                    onClick={() => setEditing({ item_id: r.item_id, variation_id: r.variation_id, price, id: r.pinned?.id ?? null })}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SetCustomerPriceDialog
        open={!!editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        customerId={customerId}
        itemId={editing?.item_id}
        variationId={editing?.variation_id ?? null}
        initialPrice={editing?.price}
        editingId={editing?.id ?? null}
      />
    </div>
  );
}
