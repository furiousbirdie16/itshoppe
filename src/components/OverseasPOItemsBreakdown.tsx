import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { peso } from "@/lib/currency";
import { cn } from "@/lib/utils";

interface Line {
  id: string;
  item_id: string | null;
  item_name: string;
  description?: string | null;
  quantity: number;
  received_quantity?: number | null;
  received_date?: string | null;
  unit_cost?: number | null;
  items?: { sku?: string | null } | null;
}

interface Props {
  items: Line[];
  currency: string;
  exchangeRate: number;
  isAdmin: boolean;
}

const sym = (c: string) => (c === "USD" ? "$" : "¥");
const money2 = (n: number) => n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Received out of ordered, as text and a thin bar — the one thing asked of a PO line. */
export function ReceivedProgress({ received, ordered }: { received: number; ordered: number }) {
  const pct = ordered > 0 ? Math.min(100, (received / ordered) * 100) : 0;
  return (
    <div className="min-w-[88px]">
      <div className="text-sm tabular-nums">
        <span className="font-medium">{received}</span>
        <span className="text-muted-foreground"> / {ordered}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-muted">
        <div className={cn("h-full rounded-full", pct >= 100 ? "bg-success" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * The products on one overseas PO: a table from md up, a card per product on
 * phones, so the quantities and value never sit off the side of the screen.
 */
export function OverseasPOItemsBreakdown({ items, currency, exchangeRate, isAdmin }: Props) {
  const rows = items.map((item) => {
    const ordered = Number(item.quantity || 0);
    // Lines not linked to an inventory item (fees, samples) are never received.
    const received = item.item_id ? Number(item.received_quantity || 0) : 0;
    const remaining = item.item_id ? Math.max(0, ordered - received) : ordered;
    const lineTotal = ordered * Number(item.unit_cost || 0);
    return { item, ordered, received, remaining, lineTotal };
  });

  if (rows.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">No products on this PO.</p>;
  }

  return (
    <>
      <div className="md:hidden divide-y">
        {rows.map(({ item, ordered, received, remaining, lineTotal }) => (
          <div key={item.id} className="space-y-2 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium leading-snug">{item.item_name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {item.items?.sku || "No SKU"}{item.description ? ` · ${item.description}` : ""}
                </div>
              </div>
              {isAdmin && (
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums">{peso(lineTotal * exchangeRate)}</div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {ordered} × {sym(currency)}{money2(Number(item.unit_cost || 0))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-end justify-between gap-3">
              {item.item_id ? <ReceivedProgress received={received} ordered={ordered} /> : <span className="text-xs text-muted-foreground">Not stocked</span>}
              <div className="text-right text-xs">
                {remaining > 0 ? (
                  <span className="font-semibold tabular-nums">{remaining} to come</span>
                ) : (
                  <span className="font-medium text-success">All received</span>
                )}
                {item.received_date && <div className="text-[11px] text-muted-foreground">received {fmtDate(item.received_date)}</div>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Table className="hidden md:table">
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Product</TableHead>
            <TableHead className="text-xs">Received</TableHead>
            <TableHead className="text-xs text-right">Remaining</TableHead>
            <TableHead className="text-xs">Date received</TableHead>
            {isAdmin && <TableHead className="text-xs text-right">Unit ({currency})</TableHead>}
            {isAdmin && <TableHead className="text-xs text-right">Line total</TableHead>}
            {isAdmin && <TableHead className="text-xs text-right">PHP value</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ item, ordered, received, remaining, lineTotal }) => (
            <TableRow key={item.id}>
              <TableCell>
                <div className="text-sm font-medium">{item.item_name}</div>
                <div className="text-[11px] text-muted-foreground">
                  <span className="tabular-nums">{item.items?.sku || "No SKU"}</span>
                  {item.description ? ` · ${item.description}` : ""}
                </div>
              </TableCell>
              <TableCell>{item.item_id ? <ReceivedProgress received={received} ordered={ordered} /> : <span className="text-xs text-muted-foreground">Not stocked</span>}</TableCell>
              <TableCell className={cn("text-right text-sm tabular-nums", remaining > 0 ? "font-semibold" : "text-muted-foreground")}>{remaining}</TableCell>
              <TableCell className="text-sm whitespace-nowrap">{item.received_date ? fmtDate(item.received_date) : <span className="text-muted-foreground">—</span>}</TableCell>
              {isAdmin && <TableCell className="text-right text-sm tabular-nums">{money2(Number(item.unit_cost || 0))}</TableCell>}
              {isAdmin && <TableCell className="text-right text-sm tabular-nums">{sym(currency)}{money2(lineTotal)}</TableCell>}
              {isAdmin && <TableCell className="text-right text-sm font-medium tabular-nums">{peso(lineTotal * exchangeRate)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
