import { useMemo, useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, parseISO, differenceInDays } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/StatCard";
import { peso } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import ItemHistoryDialog from "@/components/ItemHistoryDialog";
import CostHistoryDialog from "@/components/CostHistoryDialog";
import {
  AlertTriangle,
  Package,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  Search,
  ChevronRight,
  ChevronDown,
  History,
  DollarSign,
  BarChart3,
  CheckCircle2,
  Circle,
  Flame,
  Snowflake,
  Clock,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Item } from "@/types/database";

type Severity = "critical" | "low" | "healthy";
type StatusFilter = "all" | "critical" | "ordered" | "not_ordered" | "fast" | "slow";
type SortKey = "lowest" | "highest_sales" | "fastest" | "most_profit" | "soonest_out";

const LEAD_TIME_DAYS = 14; // assumed lead time for reorder timing
const TARGET_DAYS_OF_STOCK = 30; // suggested reorder target coverage

function getSeverity(qty: number, threshold: number): Severity {
  if (qty <= 0) return "critical";
  if (threshold > 0 && qty <= Math.max(1, Math.floor(threshold / 2))) return "critical";
  if (qty <= threshold) return "low";
  return "healthy";
}

function severityColor(s: Severity) {
  if (s === "critical") return "bg-destructive/10 text-destructive border-destructive/30";
  if (s === "low") return "bg-warning/10 text-warning border-warning/30";
  return "bg-success/10 text-success border-success/30";
}

function severityLabel(s: Severity) {
  if (s === "critical") return "Critical";
  if (s === "low") return "Low";
  return "Healthy";
}

interface SaleRow {
  item_id: string;
  qty: number;
  amount: number;
  date: string;
}

export default function LowStockAlertsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const money = (n: number) => (isAdmin ? peso(n) : "—");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "local" | "import">("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("soonest_out");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [historyItem, setHistoryItem] = useState<Item | null>(null);
  const [costHistoryItem, setCostHistoryItem] = useState<Item | null>(null);

  // 1. Items
  const { data: items = [], isLoading } = useQuery<Item[]>({
    queryKey: ["lowstock-items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("items").select("*").order("name");
      if (error) throw error;
      return data as Item[];
    },
  });

  // 2. Last 90 days sales (invoice_items + online_sales)
  const since90 = useMemo(() => subDays(new Date(), 90).toISOString(), []);
  const { data: salesRows = [] } = useQuery<SaleRow[]>({
    queryKey: ["lowstock-sales", since90],
    queryFn: async () => {
      const [invRes, onlRes] = await Promise.all([
        supabase
          .from("invoice_items")
          .select("item_id, quantity, unit_price, invoices!inner(invoice_date, status)")
          .gte("invoices.invoice_date", since90.slice(0, 10))
          .neq("invoices.status", "draft"),
        supabase
          .from("online_sales")
          .select("item_id, quantity, deal_price, order_date, status")
          .gte("order_date", since90.slice(0, 10))
          .eq("status", "completed"),
      ]);
      const out: SaleRow[] = [];
      for (const r of (invRes.data as any[]) || []) {
        if (!r.item_id) continue;
        out.push({
          item_id: r.item_id,
          qty: Number(r.quantity || 0),
          amount: Number(r.quantity || 0) * Number(r.unit_price || 0),
          date: r.invoices?.invoice_date,
        });
      }
      for (const r of (onlRes.data as any[]) || []) {
        if (!r.item_id) continue;
        out.push({
          item_id: r.item_id,
          qty: Number(r.quantity || 0),
          amount: Number(r.quantity || 0) * Number(r.deal_price || 0),
          date: r.order_date,
        });
      }
      return out;
    },
  });

  // 3. Open POs (not yet fully received) → "ordered" status + supplier mapping
  const { data: openPoLines = [] } = useQuery({
    queryKey: ["lowstock-open-pos"],
    queryFn: async () => {
      const [localRes, overRes] = await Promise.all([
        supabase
          .from("purchase_order_items")
          .select("item_id, quantity, received_quantity, purchase_orders!inner(po_number, status, suppliers(name))")
          .neq("purchase_orders.status", "received"),
        supabase
          .from("overseas_purchase_order_items")
          .select("item_id, quantity, received_quantity, overseas_purchase_orders!inner(po_number, status, overseas_suppliers(name))")
          .neq("overseas_purchase_orders.status", "received"),
      ]);
      const rows: { item_id: string; pending: number; po_number: string; supplier: string }[] = [];
      for (const r of (localRes.data as any[]) || []) {
        if (!r.item_id) continue;
        const pending = Number(r.quantity || 0) - Number(r.received_quantity || 0);
        if (pending <= 0) continue;
        rows.push({
          item_id: r.item_id,
          pending,
          po_number: r.purchase_orders?.po_number || "",
          supplier: r.purchase_orders?.suppliers?.name || "—",
        });
      }
      for (const r of (overRes.data as any[]) || []) {
        if (!r.item_id) continue;
        const pending = Number(r.quantity || 0) - Number(r.received_quantity || 0);
        if (pending <= 0) continue;
        rows.push({
          item_id: r.item_id,
          pending,
          po_number: r.overseas_purchase_orders?.po_number || "",
          supplier: r.overseas_purchase_orders?.overseas_suppliers?.name || "—",
        });
      }
      return rows;
    },
  });

  // 4. Latest cost change per item from item_cost_history (PO-derived)
  const { data: lastCostMap = {} } = useQuery<Record<string, { date: string; cost: number; supplier: string | null; po: string | null }>>({
    queryKey: ["lowstock-last-cost"],
    queryFn: async () => {
      const { data } = await supabase
        .from("item_cost_history")
        .select("item_id, new_cost, supplier_name, po_number, created_at, source")
        .order("created_at", { ascending: false })
        .limit(1000);
      const map: Record<string, any> = {};
      for (const r of (data as any[]) || []) {
        if (!r.item_id || map[r.item_id]) continue;
        map[r.item_id] = {
          date: r.created_at,
          cost: Number(r.new_cost || 0),
          supplier: r.supplier_name,
          po: r.po_number,
        };
      }
      return map;
    },
  });

  // Build per-item enriched rows
  const enriched = useMemo(() => {
    const salesByItem = new Map<string, SaleRow[]>();
    for (const s of salesRows) {
      if (!salesByItem.has(s.item_id)) salesByItem.set(s.item_id, []);
      salesByItem.get(s.item_id)!.push(s);
    }
    const orderedByItem = new Map<string, { pending: number; pos: string[]; supplier: string }>();
    for (const r of openPoLines) {
      const cur = orderedByItem.get(r.item_id) || { pending: 0, pos: [], supplier: r.supplier };
      cur.pending += r.pending;
      if (r.po_number && !cur.pos.includes(r.po_number)) cur.pos.push(r.po_number);
      orderedByItem.set(r.item_id, cur);
    }

    const today = new Date();
    return items.map((it) => {
      const threshold = it.low_stock_threshold ?? 10;
      const sev = getSeverity(it.quantity, threshold);
      const sales = salesByItem.get(it.id) || [];
      let q7 = 0, q30 = 0, q90 = 0, a7 = 0, a30 = 0, a90 = 0;
      for (const s of sales) {
        if (!s.date) continue;
        const d = parseISO(s.date);
        const diff = differenceInDays(today, d);
        if (diff <= 7) { q7 += s.qty; a7 += s.amount; }
        if (diff <= 30) { q30 += s.qty; a30 += s.amount; }
        if (diff <= 90) { q90 += s.qty; a90 += s.amount; }
      }
      const avgDaily = q90 / 90;
      const daysToOut = avgDaily > 0 ? it.quantity / avgDaily : Infinity;
      const moving: "fast" | "slow" | "normal" = avgDaily >= 1 ? "fast" : avgDaily >= 0.2 ? "normal" : "slow";

      // Suggested reorder qty: cover next TARGET_DAYS_OF_STOCK + lead time, minus current stock & pending POs
      const orderInfo = orderedByItem.get(it.id);
      const pendingOrdered = orderInfo?.pending || 0;
      const suggestedQty = Math.max(
        Math.ceil(avgDaily * (TARGET_DAYS_OF_STOCK + LEAD_TIME_DAYS)) - it.quantity - pendingOrdered,
        threshold > 0 ? threshold - it.quantity - pendingOrdered : 0,
        0,
      );

      const lastCost = lastCostMap[it.id];
      const reorderCost = suggestedQty * (lastCost?.cost ?? it.cost_price ?? 0);

      let recommendation: "urgent" | "soon" | "monitor" | "ok";
      let recommendationText: string;
      if (sev === "critical" && (orderInfo?.pending ?? 0) === 0) {
        recommendation = "urgent";
        recommendationText = "Urgent reorder needed";
      } else if (avgDaily > 0 && daysToOut <= LEAD_TIME_DAYS) {
        recommendation = "soon";
        recommendationText = `Reorder soon — ~${Math.floor(daysToOut)} day(s) of stock`;
      } else if (avgDaily === 0) {
        recommendation = "monitor";
        recommendationText = "No recent sales — monitor only";
      } else {
        recommendation = "ok";
        recommendationText = `Enough stock for ~${Math.floor(daysToOut)} day(s)`;
      }

      return {
        item: it,
        threshold,
        severity: sev,
        ordered: !!orderInfo,
        pendingOrdered,
        openPos: orderInfo?.pos || [],
        orderSupplier: orderInfo?.supplier,
        q7, q30, q90, a7, a30, a90,
        avgDaily,
        daysToOut,
        moving,
        suggestedQty,
        reorderCost,
        lastCost,
        recommendation,
        recommendationText,
        profit: (it.selling_price - it.cost_price) * q90,
      };
    });
  }, [items, salesRows, openPoLines, lastCostMap]);

  // Only unhealthy items shown on the page
  const lowStock = useMemo(() => enriched.filter((e) => e.severity !== "healthy"), [enriched]);

  const availableSuppliers = useMemo(() => {
    const set = new Set<string>();
    for (const r of lowStock) {
      const s = r.lastCost?.supplier || r.orderSupplier;
      if (s) set.add(s);
    }
    return Array.from(set).sort();
  }, [lowStock]);

  const filtered = useMemo(() => {
    let rows = lowStock;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.item.name.toLowerCase().includes(q) || r.item.sku.toLowerCase().includes(q));
    }
    if (sourceFilter !== "all") rows = rows.filter((r) => r.item.source === sourceFilter);
    if (statusFilter === "critical") rows = rows.filter((r) => r.severity === "critical");
    else if (statusFilter === "ordered") rows = rows.filter((r) => r.ordered);
    else if (statusFilter === "not_ordered") rows = rows.filter((r) => !r.ordered);
    else if (statusFilter === "fast") rows = rows.filter((r) => r.moving === "fast");
    else if (statusFilter === "slow") rows = rows.filter((r) => r.moving === "slow");

    if (supplierFilter !== "all") {
      rows = rows.filter((r) => (r.lastCost?.supplier || r.orderSupplier) === supplierFilter);
    }

    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (sortKey === "lowest") return a.item.quantity - b.item.quantity;
      if (sortKey === "highest_sales") return b.a90 - a.a90;
      if (sortKey === "fastest") return b.avgDaily - a.avgDaily;
      if (sortKey === "most_profit") return b.profit - a.profit;
      // soonest_out
      const da = isFinite(a.daysToOut) ? a.daysToOut : 1e9;
      const db = isFinite(b.daysToOut) ? b.daysToOut : 1e9;
      return da - db;
    });
    return sorted;
  }, [lowStock, search, statusFilter, supplierFilter, sortKey]);

  const summary = useMemo(() => {
    const total = lowStock.length;
    const critical = lowStock.filter((r) => r.severity === "critical").length;
    const ordered = lowStock.filter((r) => r.ordered).length;
    const pending = total - ordered;
    const reorderCost = lowStock.reduce((s, r) => s + r.reorderCost, 0);
    return { total, critical, ordered, pending, reorderCost };
  }, [lowStock]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Low Stock Alerts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Smart purchasing dashboard combining inventory, sales velocity, and supplier insights.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard title="Low Stock Items" value={summary.total} icon={AlertTriangle} variant="warning" />
        <StatCard title="Critical" value={summary.critical} icon={Flame} variant="warning" />
        <StatCard title="Already Ordered" value={summary.ordered} icon={CheckCircle2} variant="success" />
        <StatCard title="Pending Reorder" value={summary.pending} icon={Circle} />
        <StatCard
          title="Est. Reorder Cost"
          value={isAdmin ? peso(summary.reorderCost) : "—"}
          icon={DollarSign}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {([
              { k: "all", label: "All Low Stock" },
              { k: "critical", label: "Critical Items" },
              { k: "not_ordered", label: "Not Ordered" },
              { k: "ordered", label: "Already Ordered" },
              { k: "fast", label: "Fast Moving" },
              { k: "slow", label: "Slow Moving" },
            ] as { k: StatusFilter; label: string }[]).map((f) => (
              <Button
                key={f.k}
                size="sm"
                variant={statusFilter === f.k ? "default" : "outline"}
                onClick={() => setStatusFilter(f.k)}
              >
                {f.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name or SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue placeholder="Supplier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All suppliers ({availableSuppliers.length})</SelectItem>
                {availableSuppliers.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="w-[200px] h-9">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="soonest_out">Soonest to run out</SelectItem>
                <SelectItem value="lowest">Lowest stock first</SelectItem>
                <SelectItem value="highest_sales">Highest sales (90d)</SelectItem>
                <SelectItem value="fastest">Fastest moving</SelectItem>
                <SelectItem value="most_profit">Most profitable</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Min</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Last Received</TableHead>
                <TableHead className="text-right">Last Cost</TableHead>
                <TableHead className="text-right">Days Left</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Recommendation</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-12 text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-success" />
                    No items match — stock looks healthy.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((r) => {
                const isOpen = expanded.has(r.item.id);
                const supplier = r.lastCost?.supplier || r.orderSupplier || "—";
                const lastDate = r.lastCost?.date ? format(parseISO(r.lastCost.date), "MMM d, yyyy") : "—";
                return (
                  <Fragment key={r.item.id}>
                    <TableRow className="cursor-pointer" onClick={() => toggleExpand(r.item.id)}>
                      <TableCell>
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span className={cn("h-2 w-2 rounded-full",
                            r.severity === "critical" ? "bg-destructive" :
                            r.severity === "low" ? "bg-warning" : "bg-success")} />
                          {r.item.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.item.sku}</TableCell>
                      <TableCell className="text-right font-semibold">{r.item.quantity}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{r.threshold}</TableCell>
                      <TableCell className="text-xs">{supplier}</TableCell>
                      <TableCell className="text-xs">{lastDate}</TableCell>
                      <TableCell className="text-right text-xs">{r.lastCost ? money(r.lastCost.cost) : money(r.item.cost_price)}</TableCell>
                      <TableCell className="text-right text-xs">
                        {isFinite(r.daysToOut) ? `${Math.floor(r.daysToOut)}d` : "—"}
                      </TableCell>
                      <TableCell>
                        {r.ordered ? (
                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Ordered
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-muted">
                            <Circle className="h-3 w-3 mr-1" /> Not Ordered
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(
                          "text-xs",
                          r.recommendation === "urgent" && "bg-destructive/10 text-destructive border-destructive/30",
                          r.recommendation === "soon" && "bg-warning/10 text-warning border-warning/30",
                          r.recommendation === "monitor" && "bg-muted",
                          r.recommendation === "ok" && "bg-success/10 text-success border-success/30",
                        )}>
                          {r.recommendationText}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Link to="/purchase-orders">
                          <Button size="sm" variant="outline" className="h-7 text-xs">
                            <ShoppingCart className="h-3 w-3 mr-1" /> Create PO
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow>
                        <TableCell colSpan={12} className="bg-muted/30 p-4">
                          <ExpandedDetails
                            row={r}
                            money={money}
                            isAdmin={isAdmin}
                            onHistory={() => setHistoryItem(r.item)}
                            onCostHistory={() => setCostHistoryItem(r.item)}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ItemHistoryDialog item={historyItem} open={!!historyItem} onOpenChange={(o) => !o && setHistoryItem(null)} />
      <CostHistoryDialog item={costHistoryItem} open={!!costHistoryItem} onOpenChange={(o) => !o && setCostHistoryItem(null)} />
    </div>
  );
}

function ExpandedDetails({
  row,
  money,
  isAdmin,
  onHistory,
  onCostHistory,
}: {
  row: any;
  money: (n: number) => string;
  isAdmin: boolean;
  onHistory: () => void;
  onCostHistory: () => void;
}) {
  const sev: Severity = row.severity;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <MetricCard label="Sold (7d)" value={row.q7} sub={money(row.a7)} />
        <MetricCard label="Sold (30d)" value={row.q30} sub={money(row.a30)} />
        <MetricCard label="Sold (90d)" value={row.q90} sub={money(row.a90)} />
        <MetricCard label="Avg / day" value={row.avgDaily.toFixed(2)} sub={
          row.moving === "fast" ? "Fast moving" : row.moving === "slow" ? "Slow moving" : "Normal"
        } icon={row.moving === "fast" ? Flame : row.moving === "slow" ? Snowflake : TrendingUp} />
        <MetricCard label="Suggested Reorder" value={row.suggestedQty} sub={`Cost ${money(row.reorderCost)}`} />
        <MetricCard label="Reorder Timing" value={
          row.recommendation === "urgent" ? "Now" :
          row.recommendation === "soon" ? `Within ${LEAD_TIME_DAYS}d` :
          row.recommendation === "ok" ? `In ~${Math.max(0, Math.floor(row.daysToOut - LEAD_TIME_DAYS))}d` :
          "—"
        } sub={`Lead time ${LEAD_TIME_DAYS}d`} icon={Clock} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-background p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">Open Purchase Orders</div>
          {row.openPos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open POs for this item.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {row.openPos.map((po: string) => (
                <li key={po} className="flex items-center gap-2">
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium">{po}</span>
                  <span className="text-muted-foreground">— {row.orderSupplier}</span>
                </li>
              ))}
              <li className="text-xs text-muted-foreground">{row.pendingOrdered} unit(s) pending arrival</li>
            </ul>
          )}
        </div>
        <div className="rounded-lg border bg-background p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">Last Supplier Cost</div>
          {row.lastCost ? (
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Supplier</span><span>{row.lastCost.supplier || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">PO</span><span>{row.lastCost.po || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Cost</span><span className="font-medium">{money(row.lastCost.cost)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span>{format(parseISO(row.lastCost.date), "MMM d, yyyy")}</span></div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No purchase history yet.</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link to="/purchase-orders">
          <Button size="sm"><ShoppingCart className="h-3.5 w-3.5 mr-1.5" /> Create Purchase Order</Button>
        </Link>
        <Link to={`/business-insights?item=${encodeURIComponent(row.item.sku)}`}>
          <Button size="sm" variant="outline"><BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Sales History</Button>
        </Link>
        <Button size="sm" variant="outline" onClick={onHistory}>
          <History className="h-3.5 w-3.5 mr-1.5" /> Inventory History
        </Button>
        <Button size="sm" variant="outline" onClick={onCostHistory}>
          <DollarSign className="h-3.5 w-3.5 mr-1.5" /> Cost History
        </Button>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, icon: Icon }: { label: string; value: any; sub?: string; icon?: any }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <div className="text-lg font-semibold tracking-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</div>}
    </div>
  );
}
