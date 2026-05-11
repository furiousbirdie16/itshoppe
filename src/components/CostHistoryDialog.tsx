import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { peso } from "@/lib/currency";
import { ArrowDown, ArrowRight, ArrowUp, History, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { Item } from "@/types/database";

interface Props {
  item: Item | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

interface CostRow {
  id: string;
  previous_cost: number;
  new_cost: number;
  difference: number;
  percentage_change: number;
  source: string;
  po_number: string | null;
  supplier_name: string | null;
  currency: string | null;
  exchange_rate: number | null;
  changed_by_email: string | null;
  reason: string;
  created_at: string;
}

const sourceLabel = (s: string) =>
  s === "po_received" ? "Local PO" : s === "overseas_po_received" ? "Import PO" : s === "manual" ? "Manual" : s;

export default function CostHistoryDialog({ item, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [tab, setTab] = useState<"history" | "override">("history");

  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState<"all" | "up" | "down" | "same">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [poFilter, setPoFilter] = useState("");

  const [overrideValue, setOverrideValue] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: rows = [], isLoading } = useQuery<CostRow[]>({
    queryKey: ["item_cost_history", item?.id],
    enabled: !!item && open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("item_cost_history")
        .select("*")
        .eq("item_id", item!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as CostRow[]) || [];
    },
  });

  const suppliers = useMemo(() => Array.from(new Set(rows.map(r => r.supplier_name).filter(Boolean) as string[])), [rows]);
  const users = useMemo(() => Array.from(new Set(rows.map(r => r.changed_by_email).filter(Boolean) as string[])), [rows]);

  const filtered = useMemo(() => rows.filter(r => {
    if (supplierFilter !== "all" && (r.supplier_name || "") !== supplierFilter) return false;
    if (userFilter !== "all" && (r.changed_by_email || "") !== userFilter) return false;
    if (poFilter && !(r.po_number || "").toLowerCase().includes(poFilter.toLowerCase())) return false;
    if (from && r.created_at.slice(0, 10) < from) return false;
    if (to && r.created_at.slice(0, 10) > to) return false;
    if (directionFilter !== "all") {
      if (directionFilter === "up" && r.difference <= 0) return false;
      if (directionFilter === "down" && r.difference >= 0) return false;
      if (directionFilter === "same" && r.difference !== 0) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const hay = [r.po_number, r.supplier_name, r.changed_by_email, r.reason].map(x => String(x || "").toLowerCase()).join(" ");
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [rows, supplierFilter, userFilter, poFilter, from, to, directionFilter, search]);

  const stats = useMemo(() => {
    if (rows.length === 0) return null;
    const costs = rows.map(r => r.new_cost);
    const avg = costs.reduce((s, n) => s + n, 0) / costs.length;
    const high = Math.max(...costs);
    const low = Math.min(...costs);
    const last = rows[0];
    return { avg, high, low, last };
  }, [rows]);

  const submitOverride = async () => {
    if (!item) return;
    const val = parseFloat(overrideValue);
    if (!Number.isFinite(val) || val < 0) { toast.error("Enter a valid cost"); return; }
    setSubmitting(true);
    const { error } = await (supabase as any).rpc("set_item_cost_manual", {
      _item_id: item.id,
      _new_cost: val,
      _reason: overrideReason || "Manual cost override",
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Cost updated");
    setOverrideValue("");
    setOverrideReason("");
    setTab("history");
    qc.invalidateQueries({ queryKey: ["item_cost_history", item.id] });
    qc.invalidateQueries({ queryKey: ["items"] });
  };

  const arrow = (diff: number) => {
    if (diff > 0) return <ArrowUp className="inline h-3.5 w-3.5 text-destructive" />;
    if (diff < 0) return <ArrowDown className="inline h-3.5 w-3.5 text-emerald-600" />;
    return <ArrowRight className="inline h-3.5 w-3.5 text-muted-foreground" />;
  };
  const colorFor = (diff: number) =>
    diff > 0 ? "text-destructive" : diff < 0 ? "text-emerald-600" : "text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <History className="h-5 w-5" /> Cost History — {item?.name}
          </DialogTitle>
        </DialogHeader>

        {item && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Active Cost</div><div className="text-lg font-semibold">{peso(Number(item.cost_price || 0))}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Last Updated</div><div className="text-sm font-semibold">{stats?.last?.created_at ? stats.last.created_at.slice(0, 10) : "—"}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Last Supplier</div><div className="text-sm font-semibold truncate" title={stats?.last?.supplier_name || ""}>{stats?.last?.supplier_name || "—"}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Avg / High / Low</div><div className="text-sm font-semibold">{stats ? `${peso(stats.avg)} / ${peso(stats.high)} / ${peso(stats.low)}` : "—"}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-muted-foreground">Total Changes</div><div className="text-lg font-semibold">{rows.length}</div></CardContent></Card>
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="override" disabled={!isAdmin} title={!isAdmin ? "Admin only" : ""}>
              <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Manual Override
            </TabsTrigger>
          </TabsList>

          <TabsContent value="history" className="space-y-3 mt-3">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_140px_140px_140px_140px] gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Search PO, supplier, user, reason..." value={search} onChange={e => setSearch(e.target.value)} className="pl-7 h-9 text-sm" />
              </div>
              <Input placeholder="PO #" value={poFilter} onChange={e => setPoFilter(e.target.value)} className="h-9 text-sm" />
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Supplier" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Suppliers</SelectItem>
                  {suppliers.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={userFilter} onValueChange={setUserFilter}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="User" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  {users.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={directionFilter} onValueChange={(v) => setDirectionFilter(v as any)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All changes</SelectItem>
                  <SelectItem value="up">Increases</SelectItem>
                  <SelectItem value="down">Decreases</SelectItem>
                  <SelectItem value="same">Unchanged</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex gap-1">
                <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 text-sm" />
                <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 text-sm" />
              </div>
            </div>

            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Source</TableHead>
                    <TableHead className="text-xs">PO</TableHead>
                    <TableHead className="text-xs">Supplier</TableHead>
                    <TableHead className="text-xs text-right">Previous</TableHead>
                    <TableHead className="text-xs text-right">New</TableHead>
                    <TableHead className="text-xs text-right">Δ</TableHead>
                    <TableHead className="text-xs text-right">%</TableHead>
                    <TableHead className="text-xs">User</TableHead>
                    <TableHead className="text-xs">Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={10} className="h-24 text-center text-sm text-muted-foreground">Loading...</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="h-24 text-center text-sm text-muted-foreground">No cost changes recorded yet</TableCell></TableRow>
                  ) : filtered.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm">{r.created_at.slice(0, 16).replace("T", " ")}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px] uppercase">{sourceLabel(r.source)}</Badge></TableCell>
                      <TableCell className="text-sm font-mono">{r.po_number || "—"}</TableCell>
                      <TableCell className="text-sm">{r.supplier_name || "—"}</TableCell>
                      <TableCell className="text-sm text-right">{peso(r.previous_cost)}</TableCell>
                      <TableCell className="text-sm text-right font-medium">{peso(r.new_cost)}</TableCell>
                      <TableCell className={`text-sm text-right ${colorFor(r.difference)}`}>{arrow(r.difference)} {peso(Math.abs(r.difference))}</TableCell>
                      <TableCell className={`text-sm text-right ${colorFor(r.difference)}`}>{r.percentage_change.toFixed(2)}%</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[140px]" title={r.changed_by_email || ""}>{r.changed_by_email || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[180px]" title={r.reason}>{r.reason || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="override" className="space-y-3 mt-3">
            {!isAdmin ? (
              <div className="text-sm text-muted-foreground p-4 border rounded-md">Admin role required to override cost.</div>
            ) : (
              <div className="space-y-3 max-w-md">
                <div className="space-y-1">
                  <Label className="text-xs">Current cost</Label>
                  <Input value={item ? peso(Number(item.cost_price || 0)) : ""} disabled className="h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">New cost (PHP)</Label>
                  <Input type="number" step="0.01" value={overrideValue} onChange={e => setOverrideValue(e.target.value)} className="h-9 text-sm" placeholder="0.00" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Reason</Label>
                  <Textarea value={overrideReason} onChange={e => setOverrideReason(e.target.value)} className="text-sm" placeholder="Explain why this override is needed..." rows={3} />
                </div>
                <Button onClick={submitOverride} disabled={submitting} className="w-full">
                  {submitting ? "Saving..." : "Save Override"}
                </Button>
                <p className="text-xs text-muted-foreground">This change is logged permanently with your email and timestamp.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
