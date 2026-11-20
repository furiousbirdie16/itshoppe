import { useState } from "react";
import { AlertTriangle, ArrowLeftRight, ChevronDown, ChevronUp, PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBranch } from "@/contexts/BranchContext";
import { useStoreShortages, type StoreShortage } from "@/hooks/use-store-shortages";
import { TransferStockDialog } from "@/components/TransferStockDialog";
import { AdjustStockDialog } from "@/components/AdjustStockDialog";
import type { Item } from "@/types/database";

const MINIMISED_KEY = "store-shortages:minimised";

/** Enough of an item for the transfer and adjust dialogs, with this branch's figures. */
const asItem = (s: StoreShortage) =>
  ({ id: s.itemId, name: s.name, sku: s.sku, base_unit: s.baseUnit, store_quantity: s.store, warehouse_quantity: s.warehouse }) as unknown as Item;

interface Props {
  /** Rows shown before "+ N more"; omit to show every one. */
  limit?: number;
}

/**
 * Products the store has sold more of than it had, each with the two things
 * that can have happened: stock came over from the warehouse (Transfer), or
 * it was in the store all along, uncounted (Found in store). Hidden when there
 * are none.
 */
export function StoreShortagesCard({ limit }: Props) {
  const { activeBranchId, branches } = useBranch();
  const { data: rows = [] } = useStoreShortages();
  const [minimised, setMinimised] = useState(() => {
    try { return localStorage.getItem(MINIMISED_KEY) === "1"; } catch { return false; }
  });
  const [transferFor, setTransferFor] = useState<StoreShortage | null>(null);
  const [foundFor, setFoundFor] = useState<StoreShortage | null>(null);
  /** "+ N more" opens the rest here, in the card. */
  const [expanded, setExpanded] = useState(false);

  if (rows.length === 0) return null;

  const toggleMinimised = () => {
    const next = !minimised;
    setMinimised(next);
    try { localStorage.setItem(MINIMISED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  };
  const branchCode = (id: string) => branches.find((b) => b.id === id)?.branch_code ?? "";
  const shown = limit && !expanded ? rows.slice(0, limit) : rows;
  const more = rows.length - shown.length;
  const title = `${rows.length} product${rows.length === 1 ? "" : "s"} need${rows.length === 1 ? "s" : ""} a transfer`;

  return (
    <div className="rounded-lg border border-amber-300 bg-card dark:border-amber-700">
      <button
        type="button"
        onClick={toggleMinimised}
        aria-expanded={!minimised}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {minimised ? title : `${title} from the warehouse`}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {minimised ? <>Show <ChevronDown className="h-3.5 w-3.5" /></> : <ChevronUp className="h-3.5 w-3.5" />}
        </span>
      </button>

      {!minimised && (
        <div className="px-3.5 pb-3">
          <p className="mb-2 text-[11px] text-muted-foreground">
            Sold more than the store had. Record where the rest came from: carried over from the warehouse, or found in the store.
          </p>
          <div className="divide-y rounded-md border">
            <div className="hidden grid-cols-[minmax(0,1fr)_64px_80px_auto] items-center gap-3 px-3 py-1.5 text-[11px] text-muted-foreground sm:grid">
              <span>Product</span>
              <span className="text-right">Store</span>
              <span className="text-right">Warehouse</span>
              <span className="w-[236px]" />
            </div>
            {shown.map((s) => (
              <div
                key={`${s.itemId}:${s.branchId}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_64px_80px_auto]"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {s.sku}
                    {!activeBranchId && branchCode(s.branchId) && <> · {branchCode(s.branchId)}</>}
                    <span className="sm:hidden"> · store <span className="font-medium text-destructive">{s.store}</span> · warehouse {s.warehouse}</span>
                  </div>
                </div>
                <span className="hidden text-right text-sm font-semibold tabular-nums text-destructive sm:block">{s.store}</span>
                <span className="hidden text-right text-sm tabular-nums sm:block">{s.warehouse}</span>
                <div className="col-span-2 flex justify-end gap-1.5 sm:col-span-1 sm:w-[236px]">
                  {s.warehouse > 0 ? (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setTransferFor(s)}>
                      <ArrowLeftRight className="mr-1 h-3 w-3" /> Transfer
                    </Button>
                  ) : (
                    <span className="self-center text-[11px] text-muted-foreground" title="Nothing in the warehouse to transfer. Count the store.">
                      Warehouse empty
                    </span>
                  )}
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setFoundFor(s)}>
                    <PackageSearch className="mr-1 h-3 w-3" /> Found in store
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {limit && rows.length > limit && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              {expanded ? <>Show fewer <ChevronUp className="h-3.5 w-3.5" /></> : <>+ {more} more <ChevronDown className="h-3.5 w-3.5" /></>}
            </button>
          )}
        </div>
      )}

      <TransferStockDialog
        item={transferFor ? asItem(transferFor) : null}
        open={!!transferFor}
        onOpenChange={(o) => { if (!o) setTransferFor(null); }}
        branchId={transferFor?.branchId}
        initialQty={transferFor ? Math.min(-transferFor.store, transferFor.warehouse) : undefined}
      />
      <AdjustStockDialog
        item={foundFor ? asItem(foundFor) : null}
        open={!!foundFor}
        onOpenChange={(o) => { if (!o) setFoundFor(null); }}
        branchId={foundFor?.branchId}
        mode="found"
      />
    </div>
  );
}

export default StoreShortagesCard;
