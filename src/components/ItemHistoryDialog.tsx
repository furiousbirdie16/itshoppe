import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Search, History, ExternalLink } from "lucide-react";
import type { Item } from "@/types/database";

interface Props {
  item: Item | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

type MovementCategory =
  | "stock_received"
  | "sale"
  | "return"
  | "adjustment"
  | "transfer"
  | "correction";

interface LedgerRow {
  id: string;
  created_at: string;
  category: MovementCategory;
  label: string;
  qty_in: number;
  qty_out: number;
  signed_delta: number;
  previous_balance: number;
  new_balance: number;
  reference_no: string;
  reference_link: string | null;
  notes: string;
  user: string;
}

const CATEGORY_LABELS: Record<MovementCategory, string> = {
  stock_received: "Stock Received",
  sale: "Sale",
  return: "Customer Return",
  adjustment: "Stock Adjustment",
  transfer: "Warehouse Transfer",
  correction: "Manual Correction",
};

const CATEGORY_COLORS: Record<MovementCategory, string> = {
  stock_received: "bg-emerald-100 text-emerald-700 border-emerald-200",
  sale: "bg-blue-100 text-blue-700 border-blue-200",
  return: "bg-amber-100 text-amber-700 border-amber-200",
  adjustment: "bg-purple-100 text-purple-700 border-purple-200",
  transfer: "bg-slate-100 text-slate-700 border-slate-200",
  correction: "bg-rose-100 text-rose-700 border-rose-200",
};

function classify(type: string, reference_type: string | null): { category: MovementCategory; label: string; direction: "in" | "out" | "neutral" } {
  // Returns from invoices/online sales come back as in_po with specific reference_types
  const returnTypes = ["invoice_delete", "invoice_cancel", "invoice_revert", "online_sale_delete", "online_sale_cancelled", "online_sale_returned"];
  if (type === "in_po" && reference_type && returnTypes.includes(reference_type)) {
    const label =
      reference_type === "online_sale_returned" ? "Customer Return (Online)" :
      reference_type === "invoice_cancel" ? "Invoice Cancelled" :
      reference_type === "invoice_revert" ? "Invoice Reverted" :
      reference_type === "invoice_delete" ? "Invoice Deleted" :
      reference_type === "online_sale_cancelled" ? "Online Sale Cancelled" :
      "Online Sale Deleted";
    return { category: "return", label, direction: "in" };
  }
  if (type === "in_po") return { category: "stock_received", label: "Stock Received", direction: "in" };
  if (type === "out_invoice") return { category: "sale", label: "Invoice Sale", direction: "out" };
  if (type === "out_online_sale") return { category: "sale", label: "Online Sale", direction: "out" };
  if (type === "adjust_surplus") return { category: "adjustment", label: "Adjustment (Surplus)", direction: "in" };
  if (type === "adjust_missing") return { category: "adjustment", label: "Adjustment (Missing)", direction: "out" };
  if (type === "transfer_w2s") return { category: "transfer", label: "Warehouse → Store", direction: "neutral" };
  if (type === "transfer_s2w") return { category: "transfer", label: "Store → Warehouse", direction: "neutral" };
  return { category: "correction", label: type, direction: "neutral" };
}

async function fetchLedger(itemId: string, currentQty: number): Promise<LedgerRow[]> {
  const { data: movements } = await supabase
    .from("inventory_movements")
    .select("id, created_at, type, reference_type, reference_id, quantity, notes")
    .eq("item_id", itemId)
    .order("created_at", { ascending: true });

  const rows = movements || [];

  // Resolve reference document numbers
  const invoiceIds = new Set<string>();
  const poIds = new Set<string>();
  const oposIds = new Set<string>();
  const onlineSaleIds = new Set<string>();

  for (const m of rows) {
    if (!m.reference_id) continue;
    const rt = m.reference_type || "";
    if (rt.startsWith("invoice")) invoiceIds.add(m.reference_id);
    else if (rt === "purchase_order") poIds.add(m.reference_id);
    else if (rt === "overseas_purchase_order") oposIds.add(m.reference_id);
    else if (rt.startsWith("online_sale")) onlineSaleIds.add(m.reference_id);
  }

  const [invRes, poRes, oposRes, osRes] = await Promise.all([
    invoiceIds.size ? supabase.from("invoices").select("id, invoice_number").in("id", Array.from(invoiceIds)) : Promise.resolve({ data: [] as any[] }),
    poIds.size ? supabase.from("purchase_orders").select("id, po_number").in("id", Array.from(poIds)) : Promise.resolve({ data: [] as any[] }),
    oposIds.size ? supabase.from("overseas_purchase_orders").select("id, po_number").in("id", Array.from(oposIds)) : Promise.resolve({ data: [] as any[] }),
    onlineSaleIds.size ? supabase.from("online_sales").select("id, order_number").in("id", Array.from(onlineSaleIds)) : Promise.resolve({ data: [] as any[] }),
  ]);

  const refMap = new Map<string, { number: string; link: string }>();
  (invRes.data || []).forEach((r: any) => refMap.set(r.id, { number: r.invoice_number, link: `/invoices?focus=${r.id}` }));
  (poRes.data || []).forEach((r: any) => refMap.set(r.id, { number: r.po_number, link: `/purchase-orders?focus=${r.id}` }));
  (oposRes.data || []).forEach((r: any) => refMap.set(r.id, { number: r.po_number, link: `/overseas-purchase-orders?focus=${r.id}` }));
  (osRes.data || []).forEach((r: any) => refMap.set(r.id, { number: r.order_number, link: `/online-sales?focus=${r.id}` }));

  // Compute signed deltas
  const enriched = rows.map((m) => {
    const info = classify(m.type as string, m.reference_type);
    const qty = Number(m.quantity || 0);
    const qtyIn = info.direction === "in" ? qty : 0;
    const qtyOut = info.direction === "out" ? qty : 0;
    const signed = qtyIn - qtyOut;
    const ref = m.reference_id ? refMap.get(m.reference_id) : null;
    return { m, info, qty, qtyIn, qtyOut, signed, ref };
  });

  // Walk backward from current quantity to derive previous/new balances
  let runningNew = currentQty;
  const result: LedgerRow[] = [];
  for (let i = enriched.length - 1; i >= 0; i--) {
    const e = enriched[i];
    const newBalance = runningNew;
    const previousBalance = newBalance - e.signed;
    result.push({
      id: e.m.id,
      created_at: e.m.created_at,
      category: e.info.category,
      label: e.info.label,
      qty_in: e.qtyIn,
      qty_out: e.qtyOut,
      signed_delta: e.signed,
      previous_balance: previousBalance,
      new_balance: newBalance,
      reference_no: e.ref?.number || (e.m.reference_type ? "—" : "—"),
      reference_link: e.ref?.link || null,
      notes: e.m.notes || "",
      user: "—",
    });
    runningNew = previousBalance;
  }
  return result; // newest first
}

export default function ItemHistoryDialog({ item, open, onOpenChange }: Props) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | MovementCategory>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: ledger = [], isLoading } = useQuery({
    queryKey: ["item-ledger", item?.id, item?.quantity],
    queryFn: () => fetchLedger(item!.id, Number(item!.quantity || 0)),
    enabled: !!item && open,
  });

  const filtered = useMemo(() => ledger.filter((r) => {
    if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
    const day = r.created_at.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!r.reference_no.toLowerCase().includes(q) && !r.notes.toLowerCase().includes(q) && !r.label.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [ledger, categoryFilter, from, to, search]);

  const stats = useMemo(() => {
    if (ledger.length === 0) return null;
    const totalIn = ledger.reduce((s, r) => s + r.qty_in, 0);
    const totalOut = ledger.reduce((s, r) => s + r.qty_out, 0);
    return { totalIn, totalOut, current: item?.quantity ?? 0, count: ledger.length };
  }, [ledger, item]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-lg">Inventory Ledger — {item?.name}</DialogTitle>
        </DialogHeader>

        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Movements</div><div className="text-lg font-semibold">{stats.count}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Total In</div><div className="text-lg font-semibold text-emerald-600">+{stats.totalIn}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Total Out</div><div className="text-lg font-semibold text-rose-600">−{stats.totalOut}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Current Stock</div><div className="text-lg font-semibold">{stats.current}</div></CardContent></Card>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_140px_140px] gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search reference, notes, type..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-7 h-9 text-sm" />
          </div>
          <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as any)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Transactions</SelectItem>
              <SelectItem value="stock_received">Stock Received</SelectItem>
              <SelectItem value="sale">Sales</SelectItem>
              <SelectItem value="return">Returns</SelectItem>
              <SelectItem value="adjustment">Adjustments</SelectItem>
              <SelectItem value="transfer">Transfers</SelectItem>
              <SelectItem value="correction">Corrections</SelectItem>
            </SelectContent>
          </Select>
          <div>
            <Label className="text-[10px] text-muted-foreground">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 text-sm" />
          </div>
        </div>

        <div className="border rounded-md overflow-auto flex-1">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="text-xs whitespace-nowrap">Date & Time</TableHead>
                <TableHead className="text-xs">Transaction</TableHead>
                <TableHead className="text-xs">Reference</TableHead>
                <TableHead className="text-xs text-right">Qty In</TableHead>
                <TableHead className="text-xs text-right">Qty Out</TableHead>
                <TableHead className="text-xs text-right">Previous</TableHead>
                <TableHead className="text-xs text-right">New Balance</TableHead>
                <TableHead className="text-xs">User</TableHead>
                <TableHead className="text-xs">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="h-24 text-center text-sm text-muted-foreground">Loading ledger...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="h-24 text-center"><div className="flex flex-col items-center gap-1 text-muted-foreground"><History className="h-5 w-5" /><span className="text-sm">No movements found</span></div></TableCell></TableRow>
              ) : filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] ${CATEGORY_COLORS[r.category]}`}>{r.label}</Badge>
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {r.reference_link && r.reference_no !== "—" ? (
                      <Link to={r.reference_link} className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => onOpenChange(false)}>
                        {r.reference_no}<ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{r.reference_no}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-right text-emerald-600 font-medium">{r.qty_in > 0 ? `+${r.qty_in}` : ""}</TableCell>
                  <TableCell className="text-sm text-right text-rose-600 font-medium">{r.qty_out > 0 ? `−${r.qty_out}` : ""}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums">{r.previous_balance}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums font-semibold">{r.new_balance}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.user}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[240px] truncate" title={r.notes}>{r.notes}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Running balance is calculated from the current stock ({item?.quantity ?? 0}) working backwards through every recorded movement. The newest row's New Balance always matches current inventory.
        </p>
      </DialogContent>
    </Dialog>
  );
}
