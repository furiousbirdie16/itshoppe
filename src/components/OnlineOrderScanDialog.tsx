import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, ScanLine } from "lucide-react";
import { SerialScanner } from "@/components/SerialScanner";
import { OnlineOrderSerialsPanel } from "@/components/OnlineOrderSerialsPanel";
import { canScan } from "@/lib/scanning";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** How long a finished order stays on screen before the box clears for the next parcel. */
const NEXT_ORDER_DELAY_MS = 1200;

/**
 * The packing-table box: scan or type an order ID, scan its units, and it
 * clears itself for the next parcel. Meant to be left open while a stack of
 * Shopee orders is packed.
 */
export function OnlineOrderScanDialog({ open, onOpenChange }: Props) {
  const [draft, setDraft] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [scanningOrder, setScanningOrder] = useState(false);
  const orderRef = useRef<HTMLInputElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setDraft("");
    setOrderNumber("");
    setTimeout(() => orderRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!open) {
      if (timer.current) clearTimeout(timer.current);
      setDraft("");
      setOrderNumber("");
    }
  }, [open]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onComplete = useCallback(() => {
    toast.success("Order complete — ready for the next one");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(reset, NEXT_ORDER_DELAY_MS);
  }, [reset]);

  const load = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if (timer.current) clearTimeout(timer.current);
    setDraft(v);
    setOrderNumber(v);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <ScanLine className="h-5 w-5" /> Scan order serials
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1">
          <div className="flex gap-2">
            <Input
              ref={orderRef}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); load(draft); } }}
              placeholder="Order ID"
              className="h-10 font-mono"
            />
            <Button variant="outline" className="h-10 shrink-0" onClick={() => load(draft)}>Open</Button>
            {canScan() && (
              <Button className="h-10 shrink-0" onClick={() => setScanningOrder(true)}>
                <Camera className="h-4 w-4 mr-1" /> Scan
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            The order ID as it is in Online Sales. The courier tracking barcode will not match.
          </p>
        </div>

        {orderNumber && (
          <div className="border-t pt-3">
            <OnlineOrderSerialsPanel key={orderNumber} orderNumber={orderNumber} quickEntry onComplete={onComplete} />
            <div className="flex justify-end pt-3">
              <Button variant="ghost" size="sm" onClick={reset}>Next order</Button>
            </div>
          </div>
        )}

        <SerialScanner
          open={scanningOrder}
          onOpenChange={setScanningOrder}
          title="Scan the order ID"
          onScan={(value) => { setScanningOrder(false); load(value); }}
        />
      </DialogContent>
    </Dialog>
  );
}
