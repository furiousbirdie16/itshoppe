import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, ShoppingCart, Pencil, Printer, Wallet } from "lucide-react";
import { peso } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/permissions";
import { DocumentPreview } from "@/components/DocumentPreview";
import type { DocumentData } from "@/lib/pdf";

interface Props {
  onlineSaleId: string | null;
  highlightItemId?: string | null;
  highlightVariationId?: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

const PAYMENT_STATUS_META: Record<string, { label: string; className: string }> = {
  paid:      { label: "Paid",      className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  unpaid:    { label: "Unpaid",    className: "bg-rose-100 text-rose-800 border-rose-200" },
  partial:   { label: "Partial",   className: "bg-amber-100 text-amber-800 border-amber-200" },
  pending:   { label: "Pending",   className: "bg-amber-100 text-amber-800 border-amber-200" },
};

const SALE_STATUS_META: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  confirmed: "bg-blue-100 text-blue-700 border-blue-200",
  shipped: "bg-indigo-100 text-indigo-700 border-indigo-200",
  delivered: "bg-emerald-100 text-emerald-700 border-emerald-200",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  returned: "bg-amber-100 text-amber-700 border-amber-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

async function fetchOnlineSale(id: string) {
  const { data, error } = await supabase
    .from("online_sales")
    .select("*, items(id, name, sku), item_variations(id, name, sku)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export default function OnlineSaleDetailsDialog({
  onlineSaleId,
  highlightItemId,
  highlightVariationId,
  open,
  onOpenChange,
}: Props) {
  const { isAdmin } = usePermissions();
  const [previewOpen, setPreviewOpen] = useState(false);

  const { data: sale, isLoading } = useQuery({
    queryKey: ["online-sale-details", onlineSaleId],
    queryFn: () => fetchOnlineSale(onlineSaleId!),
    enabled: !!onlineSaleId && open,
  });

  const s: any = sale;
  const qty = Number(s?.quantity || 0);
  const dealPrice = Number(s?.deal_price || 0);
  const subtotal = useMemo(() => qty * dealPrice, [qty, dealPrice]);
  const grandTotal = subtotal;
  const amountPaid = Number(s?.amount_paid || 0);
  const outstanding = Math.max(0, grandTotal - amountPaid);

  const payMeta = PAYMENT_STATUS_META[s?.payment_status] || { label: s?.payment_status || "—", className: "bg-slate-100 text-slate-700 border-slate-200" };
  const statusClass = SALE_STATUS_META[s?.status] || "bg-slate-100 text-slate-700 border-slate-200";

  const skuText = s?.item_variations?.sku || s?.items?.sku || "—";
  const nameText = s?.item_variations?.name || s?.product_name || s?.items?.name || "—";
  const isHl =
    (highlightVariationId && s?.variation_id === highlightVariationId) ||
    (!highlightVariationId && highlightItemId && s?.item_id === highlightItemId);

  const previewData: DocumentData | null = s
    ? {
        type: "invoice",
        number: s.order_number,
        date: s.order_date,
        status: s.status,
        notes: s.notes,
        recipientLabel: "Channel",
        recipientName: s.sales_channel || "Online",
        extraFields: [
          ...(s.payment_status ? [{ label: "Payment", value: s.payment_status }] : []),
        ],
        items: [{
          name: nameText,
          sku: skuText !== "—" ? skuText : undefined,
          quantity: qty,
          unitPrice: dealPrice > 0 ? dealPrice : null,
          total: dealPrice > 0 ? subtotal : null,
        }],
        totalAmount: grandTotal,
      }
    : null;

  const isPaid = s?.payment_status === "paid";
  const canEdit = isAdmin && s && !["cancelled", "returned"].includes(s.status);
  const canRecordPayment = !!s && !isPaid && s.status !== "cancelled";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              {s?.order_number ? `Online Sale ${s.order_number}` : "Online Sale"}
            </DialogTitle>
          </DialogHeader>

          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading online sale…</div>
          ) : !s ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
              <div className="text-sm">
                <div className="font-semibold text-amber-900 dark:text-amber-200">Online sale no longer exists</div>
                <p className="text-amber-800 dark:text-amber-300 mt-1">
                  This order has been deleted, but the historical ledger entry is preserved for audit.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm rounded-lg border bg-muted/30 p-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Order #</div>
                  <div className="font-mono font-semibold">{s.order_number}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Channel</div>
                  <div className="font-medium truncate capitalize">{s.sales_channel || "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Order Date</div>
                  <div>{s.order_date ? new Date(s.order_date).toLocaleDateString() : "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Payment Status</div>
                  <Badge variant="outline" className={cn("text-[10px] font-medium", payMeta.className)}>{payMeta.label}</Badge>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Order Status</div>
                  <Badge variant="outline" className={cn("text-[10px] font-medium uppercase", statusClass)}>{s.status}</Badge>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Paid At</div>
                  <div>{s.paid_at ? new Date(s.paid_at).toLocaleDateString() : "—"}</div>
                </div>
              </div>

              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">SKU</TableHead>
                      <TableHead className="text-xs">Product Name</TableHead>
                      <TableHead className="text-xs text-right">Qty</TableHead>
                      <TableHead className="text-xs text-right">Posted Price</TableHead>
                      <TableHead className="text-xs text-right">Deal Price</TableHead>
                      <TableHead className="text-xs text-right">Line Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className={cn(isHl && "bg-amber-50 dark:bg-amber-950/40 border-l-4 border-l-amber-500")}>
                      <TableCell className="font-mono text-xs text-primary">
                        {skuText}
                        {isHl && <span className="ml-2 text-[10px] font-semibold text-amber-700 dark:text-amber-300 uppercase">Ledger item</span>}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{nameText}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums">{qty}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums text-muted-foreground">{s.posted_price > 0 ? peso(Number(s.posted_price)) : "—"}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums">{dealPrice > 0 ? peso(dealPrice) : "—"}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums font-medium">{dealPrice > 0 ? peso(subtotal) : "—"}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-end">
                <div className="w-full sm:max-w-xs space-y-1.5 text-sm rounded-lg border bg-card p-3">
                  <Row label="Subtotal" value={peso(subtotal)} />
                  <div className="border-t pt-1.5 mt-1.5">
                    <Row label="Grand Total" value={peso(grandTotal)} bold />
                  </div>
                  <Row label="Amount Paid" value={peso(amountPaid)} className={amountPaid > 0 ? "text-emerald-600" : ""} />
                  <Row
                    label="Outstanding Balance"
                    value={peso(outstanding)}
                    className={outstanding > 0 ? "text-rose-600 font-semibold" : "text-muted-foreground"}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 justify-end pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewOpen(true)}
                  disabled={!previewData}
                >
                  <Printer className="h-3.5 w-3.5 mr-1.5" />Print / Download PDF
                </Button>
                {canEdit && (
                  <Link to="/online-sales">
                    <Button variant="outline" size="sm"><Pencil className="h-3.5 w-3.5 mr-1.5" />Edit</Button>
                  </Link>
                )}
                {canRecordPayment && (
                  <Link to="/online-sales">
                    <Button size="sm"><Wallet className="h-3.5 w-3.5 mr-1.5" />Record Payment</Button>
                  </Link>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <DocumentPreview open={previewOpen} onClose={() => setPreviewOpen(false)} data={previewData} />
    </>
  );
}

function Row({
  label,
  value,
  muted,
  bold,
  className,
}: { label: string; value: string; muted?: boolean; bold?: boolean; className?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={cn("text-muted-foreground", bold && "text-foreground font-semibold")}>{label}</span>
      <span
        className={cn(
          "tabular-nums",
          bold && "text-base font-bold",
          muted && "text-muted-foreground",
          className
        )}
      >
        {value}
      </span>
    </div>
  );
}
