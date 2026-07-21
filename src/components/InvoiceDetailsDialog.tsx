import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, FileText, Pencil, Printer, User, Wallet } from "lucide-react";
import { peso } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/lib/permissions";
import { DocumentPreview } from "@/components/DocumentPreview";
import type { DocumentData } from "@/lib/pdf";

interface Props {
  invoiceId: string | null;
  highlightItemId?: string | null;
  highlightVariationId?: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

const PAYMENT_STATUS_META: Record<string, { label: string; className: string }> = {
  paid:      { label: "Paid",      className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  completed: { label: "Paid",      className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  unpaid:    { label: "Unpaid",    className: "bg-rose-100 text-rose-800 border-rose-200" },
  reserved:  { label: "Unpaid",    className: "bg-rose-100 text-rose-800 border-rose-200" },
  shipped:   { label: "Unpaid",    className: "bg-rose-100 text-rose-800 border-rose-200" },
  confirmed: { label: "Unpaid",    className: "bg-amber-100 text-amber-800 border-amber-200" },
  draft:     { label: "—",         className: "bg-slate-100 text-slate-700 border-slate-200" },
  cancelled: { label: "Cancelled", className: "bg-slate-100 text-slate-500 border-slate-200" },
};

const INVOICE_STATUS_META: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  confirmed: "bg-blue-100 text-blue-700 border-blue-200",
  reserved: "bg-purple-100 text-purple-700 border-purple-200",
  paid: "bg-emerald-100 text-emerald-700 border-emerald-200",
  unpaid: "bg-rose-100 text-rose-700 border-rose-200",
  shipped: "bg-indigo-100 text-indigo-700 border-indigo-200",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

async function fetchInvoiceBundle(invoiceId: string) {
  const { data: inv, error } = await supabase
    .from("invoices")
    .select("*, customers(id, name, contact_person, email, phone, address)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw error;
  if (!inv) return { invoice: null as any, items: [] as any[] };

  const { data: items } = await supabase
    .from("invoice_items")
    .select("id, item_id, variation_id, item_name, quantity, unit_price, items(id, name, sku), item_variations(id, name, sku)")
    .eq("invoice_id", invoiceId);

  return { invoice: inv, items: items || [] };
}

export default function InvoiceDetailsDialog({
  invoiceId,
  highlightItemId,
  highlightVariationId,
  open,
  onOpenChange,
}: Props) {
  const { isAdmin } = usePermissions();
  const [previewOpen, setPreviewOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["invoice-details", invoiceId],
    queryFn: () => fetchInvoiceBundle(invoiceId!),
    enabled: !!invoiceId && open,
  });

  const inv: any = data?.invoice;
  const items: any[] = data?.items || [];

  const subtotal = useMemo(
    () => items.reduce((s, li) => s + Number(li.quantity || 0) * Number(li.unit_price || 0), 0),
    [items]
  );
  const grandTotal = Number(inv?.total_amount ?? subtotal);
  const isPaid = inv?.status === "paid" || inv?.status === "completed";
  const amountPaid = isPaid ? grandTotal : 0;
  const outstanding = Math.max(0, grandTotal - amountPaid);

  const payMeta = PAYMENT_STATUS_META[inv?.status] || PAYMENT_STATUS_META.draft;
  const invMeta = INVOICE_STATUS_META[inv?.status] || INVOICE_STATUS_META.draft;

  const previewData: DocumentData | null = inv
    ? {
        type: "invoice",
        number: inv.invoice_number,
        date: inv.invoice_date,
        status: inv.status,
        notes: inv.notes,
        recipientLabel: "Customer",
        recipientName: inv.customers?.name || "—",
        recipientContact: inv.customers?.contact_person,
        recipientEmail: inv.customers?.email,
        recipientPhone: inv.customers?.phone,
        recipientAddress: inv.customers?.address,
        extraFields: [
          ...(inv.due_date ? [{ label: "Due Date", value: inv.due_date }] : []),
          ...(inv.sales_agent ? [{ label: "Sales Agent", value: inv.sales_agent }] : []),
        ],
        items: items.map((li: any) => {
          const up = Number(li.unit_price);
          const hasPrice = li.unit_price != null && up > 0;
          return {
            name: li.item_variations?.name || li.item_name || li.items?.name || "—",
            sku: li.item_variations?.sku || li.items?.sku,
            quantity: li.quantity,
            unitPrice: hasPrice ? up : null,
            total: hasPrice ? li.quantity * up : null,
          };
        }),
        totalAmount: grandTotal,
      }
    : null;

  const canEdit = isAdmin && inv && !["paid", "completed", "shipped", "cancelled"].includes(inv.status);
  const canRecordPayment = !!inv && !isPaid && inv.status !== "cancelled" && inv.status !== "draft";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {inv?.invoice_number ? `Invoice ${inv.invoice_number}` : "Invoice"}
            </DialogTitle>
          </DialogHeader>

          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading invoice…</div>
          ) : !inv ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
              <div className="text-sm">
                <div className="font-semibold text-amber-900 dark:text-amber-200">Invoice no longer exists</div>
                <p className="text-amber-800 dark:text-amber-300 mt-1">
                  This invoice has been deleted, but the historical ledger entry is preserved for audit.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* HEADER */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm rounded-lg border bg-muted/30 p-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Invoice #</div>
                  <div className="font-mono font-semibold">{inv.invoice_number}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Customer</div>
                  <div className="font-medium truncate">{inv.customers?.name || "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Date</div>
                  <div>{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Payment Status</div>
                  <Badge variant="outline" className={cn("text-[10px] font-medium", payMeta.className)}>{payMeta.label}</Badge>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Invoice Status</div>
                  <Badge variant="outline" className={cn("text-[10px] font-medium uppercase", invMeta)}>{inv.status}</Badge>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Salesperson</div>
                  <div>{inv.sales_agent || "—"}</div>
                </div>
              </div>

              {/* ITEMS */}
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">SKU</TableHead>
                      <TableHead className="text-xs">Product Name</TableHead>
                      <TableHead className="text-xs text-right">Qty</TableHead>
                      <TableHead className="text-xs text-right">Unit Price</TableHead>
                      <TableHead className="text-xs text-right">Discount</TableHead>
                      <TableHead className="text-xs text-right">Line Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-4">No line items.</TableCell></TableRow>
                    ) : items.map((li: any) => {
                      const hl =
                        (highlightVariationId && li.variation_id === highlightVariationId) ||
                        (!highlightVariationId && highlightItemId && li.item_id === highlightItemId);
                      const up = Number(li.unit_price || 0);
                      const lineTotal = Number(li.quantity || 0) * up;
                      return (
                        <TableRow
                          key={li.id}
                          className={cn(hl && "bg-amber-50 dark:bg-amber-950/40 border-l-4 border-l-amber-500")}
                        >
                          <TableCell className="font-mono text-xs text-primary">
                            {li.item_variations?.sku || li.items?.sku || "—"}
                            {hl && <span className="ml-2 text-[10px] font-semibold text-amber-700 dark:text-amber-300 uppercase">Ledger item</span>}
                          </TableCell>
                          <TableCell className="text-sm font-medium">
                            {li.item_variations?.name || li.item_name || li.items?.name || "—"}
                          </TableCell>
                          <TableCell className="text-sm text-right tabular-nums">{li.quantity}</TableCell>
                          <TableCell className="text-sm text-right tabular-nums">{up > 0 ? peso(up) : "—"}</TableCell>
                          <TableCell className="text-sm text-right tabular-nums text-muted-foreground">—</TableCell>
                          <TableCell className="text-sm text-right tabular-nums font-medium">{up > 0 ? peso(lineTotal) : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* SUMMARY */}
              <div className="flex justify-end">
                <div className="w-full sm:max-w-xs space-y-1.5 text-sm rounded-lg border bg-card p-3">
                  <Row label="Subtotal" value={peso(subtotal)} />
                  <Row label="Discount" value="—" muted />
                  <Row label="VAT" value="—" muted />
                  <Row label="Shipping" value="—" muted />
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

              {/* ACTIONS */}
              <div className="flex flex-wrap gap-2 justify-end pt-1">
                {inv.customers?.id && (
                  <Link to="/customers">
                    <Button variant="outline" size="sm"><User className="h-3.5 w-3.5 mr-1.5" />View Customer</Button>
                  </Link>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewOpen(true)}
                  disabled={!previewData}
                >
                  <Printer className="h-3.5 w-3.5 mr-1.5" />Print / Download PDF
                </Button>
                {canEdit && (
                  <Link to="/invoices">
                    <Button variant="outline" size="sm"><Pencil className="h-3.5 w-3.5 mr-1.5" />Edit</Button>
                  </Link>
                )}
                {canRecordPayment && (
                  <Link to="/invoices">
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
