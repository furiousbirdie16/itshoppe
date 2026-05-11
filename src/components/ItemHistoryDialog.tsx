import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { peso } from "@/lib/currency";
import { Search, Package } from "lucide-react";
import type { Item } from "@/types/database";

interface Props {
  item: Item | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

interface Receipt {
  id: string;
  source: "local" | "import";
  po_number: string;
  po_id: string;
  supplier_name: string;
  received_date: string | null;
  quantity: number;
  unit_cost: number;
  total: number;
  currency: string;
  notes: string;
}

async function fetchHistory(itemId: string): Promise<Receipt[]> {
  const [localRes, overseasRes] = await Promise.all([
    supabase
      .from("purchase_order_items")
      .select("id, quantity, received_quantity, received_date, unit_cost, po_id, purchase_orders(po_number, notes, suppliers(name))")
      .eq("item_id", itemId)
      .gt("received_quantity", 0),
    supabase
      .from("overseas_purchase_order_items")
      .select("id, quantity, received_quantity, received_date, unit_cost, po_id, overseas_purchase_orders(po_number, notes, currency, exchange_rate, overseas_suppliers(name))")
      .eq("item_id", itemId)
      .gt("received_quantity", 0),
  ]);

  const local: Receipt[] = (localRes.data || []).map((r: any) => ({
    id: r.id,
    source: "local",
    po_number: r.purchase_orders?.po_number || "—",
    po_id: r.po_id,
    supplier_name: r.purchase_orders?.suppliers?.name || "Unknown",
    received_date: r.received_date,
    quantity: Number(r.received_quantity || 0),
    unit_cost: Number(r.unit_cost || 0),
    total: Number(r.received_quantity || 0) * Number(r.unit_cost || 0),
    currency: "PHP",
    notes: r.purchase_orders?.notes || "",
  }));

  const overseas: Receipt[] = (overseasRes.data || []).map((r: any) => ({
    id: r.id,
    source: "import",
    po_number: r.overseas_purchase_orders?.po_number || "—",
    po_id: r.po_id,
    supplier_name: r.overseas_purchase_orders?.overseas_suppliers?.name || "Unknown",
    received_date: r.received_date,
    quantity: Number(r.received_quantity || 0),
    unit_cost: Number(r.unit_cost || 0) * Number(r.overseas_purchase_orders?.exchange_rate || 1),
    total: Number(r.received_quantity || 0) * Number(r.unit_cost || 0) * Number(r.overseas_purchase_orders?.exchange_rate || 1),
    currency: r.overseas_purchase_orders?.currency || "USD",
    notes: r.overseas_purchase_orders?.notes || "",
  }));

  return [...local, ...overseas].sort((a, b) => {
    const da = a.received_date || "";
    const db = b.received_date || "";
    return db.localeCompare(da);
  });
}

export default function ItemHistoryDialog({ item, open, onOpenChange }: Props) {
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "local" | "import">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ["item-history", item?.id],
    queryFn: () => fetchHistory(item!.id),
    enabled: !!item && open,
  });

  const suppliers = useMemo(() => Array.from(new Set(receipts.map(r => r.supplier_name))), [receipts]);

  const filtered = useMemo(() => receipts.filter(r => {
    if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
    if (supplierFilter !== "all" && r.supplier_name !== supplierFilter) return false;
    if (from && (!r.received_date || r.received_date < from)) return false;
    if (to && (!r.received_date || r.received_date > to)) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!r.po_number.toLowerCase().includes(q) && !r.supplier_name.toLowerCase().includes(q) && !r.notes.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [receipts, sourceFilter, supplierFilter, from, to, search]);

  const stats = useMemo(() => {
    if (receipts.length === 0) return null;
    const totalQty = receipts.reduce((s, r) => s + r.quantity, 0);
    const totalCost = receipts.reduce((s, r) => s + r.total, 0);
    const avgCost = totalQty > 0 ? totalCost / totalQty : 0;
    const sorted = [...receipts].sort((a, b) => (b.received_date || "").localeCompare(a.received_date || ""));
    const last = sorted[0];
    const bySupplier = new Map<string, number>();
    receipts.forEach(r => bySupplier.set(r.supplier_name, (bySupplier.get(r.supplier_name) || 0) + r.quantity));
    return { totalQty, totalCost, avgCost, lastDate: last?.received_date, latestSupplier: last?.supplier_name, bySupplier };
  }, [receipts]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-lg">Stock History — {item?.name}</DialogTitle>
        </DialogHeader>

        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Total Received</div><div className="text-lg font-semibold">{stats.totalQty}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Avg Cost</div><div className="text-lg font-semibold">{peso(stats.avgCost)}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Last Arrival</div><div className="text-sm font-semibold">{stats.lastDate || "—"}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Latest Supplier</div><div className="text-sm font-semibold truncate" title={stats.latestSupplier}>{stats.latestSupplier || "—"}</div></CardContent></Card>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_140px_140px_140px] gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search PO, supplier, notes..." value={search} onChange={e => setSearch(e.target.value)} className="pl-7 h-9 text-sm" />
          </div>
          <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as any)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="local">Local</SelectItem>
              <SelectItem value="import">Import</SelectItem>
            </SelectContent>
          </Select>
          <Select value={supplierFilter} onValueChange={setSupplierFilter}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Supplier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Suppliers</SelectItem>
              {suppliers.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <div>
            <Label className="text-[10px] text-muted-foreground">From</Label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">To</Label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 text-sm" />
          </div>
        </div>

        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">PO</TableHead>
                <TableHead className="text-xs">Supplier</TableHead>
                <TableHead className="text-xs">Source</TableHead>
                <TableHead className="text-xs text-right">Qty</TableHead>
                <TableHead className="text-xs text-right">Unit Cost</TableHead>
                <TableHead className="text-xs text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">Loading...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="h-24 text-center"><div className="flex flex-col items-center gap-1 text-muted-foreground"><Package className="h-5 w-5" /><span className="text-sm">No receiving history</span></div></TableCell></TableRow>
              ) : filtered.map(r => (
                <TableRow key={`${r.source}-${r.id}`}>
                  <TableCell className="text-sm">{r.received_date || "—"}</TableCell>
                  <TableCell className="text-sm font-mono">{r.po_number}</TableCell>
                  <TableCell className="text-sm">{r.supplier_name}</TableCell>
                  <TableCell><Badge variant={r.source === "import" ? "secondary" : "outline"} className="text-[10px] uppercase">{r.source}</Badge></TableCell>
                  <TableCell className="text-sm text-right">{r.quantity}</TableCell>
                  <TableCell className="text-sm text-right">{peso(r.unit_cost)}</TableCell>
                  <TableCell className="text-sm text-right font-medium">{peso(r.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {stats && stats.bySupplier.size > 0 && (
          <div className="border rounded-md p-3">
            <div className="text-xs font-medium mb-2 text-muted-foreground uppercase">Cumulative by Supplier</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {Array.from(stats.bySupplier.entries()).map(([name, qty]) => (
                <div key={name} className="flex justify-between text-sm">
                  <span className="truncate">{name}</span>
                  <span className="font-medium">{qty}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
