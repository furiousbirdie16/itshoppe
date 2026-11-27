import type { OverseasPurchaseOrderItem } from "@/types/database";
import { cn } from "@/lib/utils";

interface Props {
  items: OverseasPurchaseOrderItem[];
  currency: string;
  /** Costs are admin only on this page, as in the table above. */
  isAdmin: boolean;
}

const money = (currency: string, n: number) =>
  `${currency === "USD" ? "$" : "¥"}${n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A PO's items opened under its row: what was ordered, what has arrived and, for admins, the cost. */
export function OverseasPOLinesPanel({ items, currency, isAdmin }: Props) {
  if (items.length === 0) return <p className="px-3 py-3 text-xs text-muted-foreground">No items on this PO.</p>;
  const total = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_cost) || 0), 0);
  return (
    <div className="px-1 py-2">
      <div className="overflow-x-auto rounded-md border bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Item</th>
              <th className="px-2 py-1.5 text-right font-medium">Ordered</th>
              <th className="px-2 py-1.5 text-right font-medium">Received</th>
              {isAdmin && <th className="px-2 py-1.5 text-right font-medium">Unit cost</th>}
              {isAdmin && <th className="px-2 py-1.5 text-right font-medium">Total</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((i) => {
              const ordered = Number(i.quantity) || 0;
              const received = Number(i.received_quantity) || 0;
              return (
                <tr key={i.id}>
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{i.item_name || i.items?.name || "—"}</div>
                    {i.description && <div className="text-[11px] text-muted-foreground">{i.description}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{ordered}</td>
                  <td className={cn(
                    "px-2 py-1.5 text-right tabular-nums",
                    received >= ordered ? "text-success" : received > 0 ? "text-warning" : "text-muted-foreground",
                  )}>
                    {received}
                    {i.received_date && <div className="text-[10px] text-muted-foreground">{i.received_date}</div>}
                  </td>
                  {isAdmin && <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{money(currency, Number(i.unit_cost) || 0)}</td>}
                  {isAdmin && <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap font-medium">{money(currency, ordered * (Number(i.unit_cost) || 0))}</td>}
                </tr>
              );
            })}
          </tbody>
          {isAdmin && (
            <tfoot>
              <tr className="border-t bg-muted/20 text-xs">
                <td className="px-2 py-1.5 font-medium" colSpan={4}>Items total</td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums whitespace-nowrap">{money(currency, total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
