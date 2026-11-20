import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Shortage } from "@/lib/stockCheck";

export interface ShortageNotice {
  title: string;
  description: string;
  shortages: Shortage[];
  /** Given only where going ahead is allowed (a quotation); otherwise it blocks. */
  proceedLabel?: string;
  onProceed?: () => void;
}

const fmt = (n: number) => Number(n.toFixed(3)).toLocaleString();

/**
 * Which products are short and by how much, in a table rather than a browser
 * prompt: what is needed, what the branch has (store and warehouse), and the
 * gap.
 */
export function StockShortageDialog({ notice, onClose }: { notice: ShortageNotice | null; onClose: () => void }) {
  return (
    <Dialog open={!!notice} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg text-destructive">
            <AlertTriangle className="h-5 w-5" /> {notice?.title}
          </DialogTitle>
          <DialogDescription className="text-sm">{notice?.description}</DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-md border border-destructive/30">
          <div className="grid grid-cols-[minmax(0,1fr)_64px_80px_72px] gap-2 bg-destructive/5 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            <span>Product</span>
            <span className="text-right">Needed</span>
            <span className="text-right">Available</span>
            <span className="text-right">Lacking</span>
          </div>
          <div className="max-h-72 divide-y overflow-y-auto">
            {notice?.shortages.map((s) => (
              <div key={s.itemId} className="grid grid-cols-[minmax(0,1fr)_64px_80px_72px] items-center gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  {s.split && (
                    <div className="text-[11px] text-muted-foreground">
                      store {fmt(s.split.store)} · warehouse {fmt(s.split.warehouse)}
                    </div>
                  )}
                </div>
                <span className="text-right text-sm tabular-nums">{fmt(s.needed)}</span>
                <span className="text-right text-sm tabular-nums">{fmt(Math.max(s.available, 0))}</span>
                <span className="text-right text-sm font-semibold tabular-nums text-destructive">
                  {fmt(s.shortBy)} <span className="text-[11px] font-normal">{s.unit}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {notice?.onProceed ? (
            <>
              <Button variant="outline" onClick={onClose}>Go back</Button>
              <Button onClick={() => { const go = notice.onProceed; onClose(); go?.(); }}>{notice.proceedLabel ?? "Continue"}</Button>
            </>
          ) : (
            <Button onClick={onClose}>OK</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default StockShortageDialog;
