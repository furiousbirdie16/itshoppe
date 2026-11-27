import { useQuery } from "@tanstack/react-query";
import { getInvoiceItems, getInvoiceItemFinancials, getQuotationItems } from "@/lib/api";
import { getQuotationLineCosts, type CostLine } from "@/lib/quotation-cost";
import { SaleLinesPanel, type SaleLine } from "@/components/SaleLinesPanel";

const lineName = (l: any) => l.item_variations?.name || l.item_name || l.items?.name || "—";
const lineSku = (l: any) => l.item_variations?.sku || l.items?.sku || null;
const toCostLines = (rows: any[]): CostLine[] =>
  rows.map((r) => ({ id: r.id, item_id: r.item_id ?? null, variation_id: r.variation_id ?? null, quantity: Number(r.quantity) || 0, unit_price: Number(r.unit_price) || 0 }));

/**
 * Today's cost at the branch for the given lines. Only ever asked for an
 * admin: the screen is what keeps cost from staff here.
 */
function useCurrentCosts(rows: any[], branchId: string | null, enabled: boolean) {
  const lines = toCostLines(rows);
  return useQuery({
    queryKey: ["line-costs-now", branchId, lines.map((l) => `${l.id}:${l.item_id}:${l.variation_id}`).join(",")],
    queryFn: () => getQuotationLineCosts(lines, branchId),
    enabled: enabled && lines.length > 0,
  });
}

/** An invoice's items under its row. Admins also see each line's profit. */
export function InvoiceLinesExpanded({ invoiceId, branchId, isAdmin }: { invoiceId: string; branchId: string | null; isAdmin: boolean }) {
  // Same keys as the invoice's details window, so opening one fills the other.
  const { data: items = [], isLoading } = useQuery({ queryKey: ["invoice_items", invoiceId], queryFn: () => getInvoiceItems(invoiceId) });
  const { data: fins = [], isLoading: finsLoading } = useQuery({
    queryKey: ["invoice_item_financials", invoiceId],
    queryFn: () => getInvoiceItemFinancials(invoiceId),
    enabled: isAdmin,
  });

  // The cost recorded when the invoice was paid, matched to its line; else by
  // product, for rows written before lines were linked.
  const byLine = new Map<string, any>();
  const byItem = new Map<string, any>();
  for (const f of fins as any[]) {
    if (f.invoice_item_id) byLine.set(f.invoice_item_id, f);
    byItem.set(`${f.item_id}::${f.variation_id || ""}`, f);
  }
  const recordedFor = (l: any) => byLine.get(l.id) ?? (l.item_id ? byItem.get(`${l.item_id}::${l.variation_id || ""}`) : undefined);

  // Lines with nothing recorded yet (not paid) are costed at today's price.
  const unrecorded = (items as any[]).filter((l) => !recordedFor(l));
  const { data: nowCosts, isLoading: nowLoading } = useCurrentCosts(unrecorded, branchId, isAdmin && !finsLoading);

  let estimated = 0;
  const lines: SaleLine[] = (items as any[]).map((l) => {
    const qty = Number(l.quantity) || 0;
    let lineCost: number | null = null;
    const rec = recordedFor(l);
    if (rec && rec.cost_snapshot != null) {
      lineCost = rec.line_total_cost != null ? Number(rec.line_total_cost) : Number(rec.cost_snapshot) * qty;
    } else if (nowCosts && nowCosts[l.id] != null) {
      lineCost = Number(nowCosts[l.id]) * qty;
      estimated++;
    }
    return { id: l.id, sku: lineSku(l), name: lineName(l), quantity: qty, unitPrice: Number(l.unit_price) || 0, lineCost };
  });

  return (
    <SaleLinesPanel
      lines={lines}
      loading={isLoading || (isAdmin && (finsLoading || (unrecorded.length > 0 && nowLoading)))}
      showProfit={isAdmin}
      costNote={estimated > 0 ? `Estimated at today's cost for ${estimated === lines.length ? "every line" : `${estimated} line${estimated === 1 ? "" : "s"}`}; the cost is fixed when the invoice is paid.` : null}
    />
  );
}

/** A quotation's items under its row. Admins also see each line's profit at today's cost. */
export function QuotationLinesExpanded({ quotationId, branchId, isAdmin }: { quotationId: string; branchId: string | null; isAdmin: boolean }) {
  const { data: items = [], isLoading } = useQuery({ queryKey: ["quotation_items", quotationId], queryFn: () => getQuotationItems(quotationId) });
  const { data: costs, isLoading: costsLoading } = useCurrentCosts(items as any[], branchId, isAdmin);

  const lines: SaleLine[] = (items as any[]).map((l) => {
    const qty = Number(l.quantity) || 0;
    const c = costs ? costs[l.id] : null;
    return { id: l.id, sku: lineSku(l), name: lineName(l), quantity: qty, unitPrice: Number(l.unit_price) || 0, lineCost: c == null ? null : Number(c) * qty };
  });

  return (
    <SaleLinesPanel
      lines={lines}
      loading={isLoading || (isAdmin && items.length > 0 && costsLoading)}
      showProfit={isAdmin}
      costNote="Profit at today's cost for this branch."
    />
  );
}
