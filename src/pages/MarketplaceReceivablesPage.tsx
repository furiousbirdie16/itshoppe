import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getOnlineSales } from "@/lib/api";
import { peso } from "@/lib/currency";
import { useBranch } from "@/contexts/BranchContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/StatCard";
import { FinanceMobileCard } from "@/components/FinanceMobileCard";
import { SortableHeader } from "@/components/SortableHeader";
import { useSort } from "@/hooks/use-sort";
import { DateField } from "@/components/DateField";
import ExportButton from "@/components/ExportButton";
import { CircleDollarSign, Store, ShoppingBag, Boxes, Filter, Search, X } from "lucide-react";
import {
  buildReceivables,
  sumReceivables,
  channelLabel,
  channelBadgeClass,
  DEFAULT_MARKETPLACE_FEE_PCT,
} from "@/lib/marketplaceReceivables";

export default function MarketplaceReceivablesPage() {
  const { activeBranchId } = useBranch();
  const { data: sales = [], isLoading } = useQuery({
    queryKey: ["online_sales", activeBranchId],
    queryFn: () => getOnlineSales(activeBranchId),
  });

  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filterChannel, setFilterChannel] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const rows = useMemo(() => buildReceivables(sales as any[]), [sales]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterChannel !== "all" && r.sales_channel !== filterChannel) return false;
      if (dateFrom && (r.order_date || "") < dateFrom) return false;
      if (dateTo && (r.order_date || "") > dateTo) return false;
      if (q && !r.order_number?.toLowerCase().includes(q) && !r.product_name?.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, filterChannel, dateFrom, dateTo]);

  const totals = useMemo(() => sumReceivables(filtered), [filtered]);

  const { sorted, sort, toggle } = useSort(
    filtered,
    {
      order_date: (r) => r.order_date,
      sales_channel: (r) => r.sales_channel,
      order_number: (r) => r.order_number,
      totalSales: (r) => r.totalSales,
      feePct: (r) => r.feePct,
      estimatedPayout: (r) => r.estimatedPayout,
      daysOutstanding: (r) => r.daysOutstanding,
    },
    { key: "daysOutstanding", dir: "desc" },
  );

  const hasFilters = filterChannel !== "all" || dateFrom || dateTo || search;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Marketplace Receivables</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Estimated payouts still owed by marketplace platforms for unpaid online sales.
            Default fee {DEFAULT_MARKETPLACE_FEE_PCT}% unless an order has its own fee %.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="rounded-lg h-9 px-3 text-sm">
            <Filter className="h-4 w-4 mr-1.5" /> Filters
          </Button>
          <ExportButton
            data={sorted}
            dateField={(r: any) => r.order_date}
            fileName="marketplace-receivables"
            columns={{
              "Order Date": (r: any) => r.order_date,
              "Platform": (r: any) => channelLabel(r.sales_channel),
              "Order Number": (r: any) => r.order_number,
              "Product": (r: any) => r.product_name,
              "Qty": (r: any) => r.quantity,
              "Total Sales": (r: any) => r.totalSales,
              "Estimated Fee %": (r: any) => r.feePct,
              "Estimated Fee": (r: any) => r.estimatedFee,
              "Estimated Payout": (r: any) => r.estimatedPayout,
              "Days Outstanding": (r: any) => r.daysOutstanding,
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          title="Total Pending"
          value={peso(totals.total)}
          icon={CircleDollarSign}
          description={`${totals.count} unpaid order${totals.count === 1 ? "" : "s"}`}
        />
        <StatCard title="Shopee Pending" value={peso(totals.shopee)} icon={Store} variant="warning" />
        <StatCard title="Lazada Pending" value={peso(totals.lazada)} icon={ShoppingBag} variant="warning" />
        <StatCard title="Other Marketplaces" value={peso(totals.others)} icon={Boxes} />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order number or product..."
            className="pl-9 h-9"
          />
        </div>
        <div className="text-xs text-muted-foreground">
          Total sales {peso(totals.totalSales)} · Est. fees {peso(totals.totalFees)}
        </div>
      </div>

      {showFilters && (
        <div className="border rounded-lg p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 bg-muted/20">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Platform</Label>
            <Select value={filterChannel} onValueChange={setFilterChannel}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All platforms</SelectItem>
                <SelectItem value="shopee">Shopee</SelectItem>
                <SelectItem value="lazada">Lazada</SelectItem>
                <SelectItem value="others">Others</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Order date from</Label>
            <DateField value={dateFrom} onChange={setDateFrom} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Order date to</Label>
            <DateField value={dateTo} onChange={setDateTo} />
          </div>
          <div className="flex items-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs"
              disabled={!hasFilters}
              onClick={() => { setFilterChannel("all"); setDateFrom(""); setDateTo(""); setSearch(""); }}
            >
              <X className="h-3.5 w-3.5 mr-1" /> Clear filters
            </Button>
          </div>
        </div>
      )}

      {/* Phones get stacked cards; eight columns of an eight-column table put the
          payout and the ageing off the right edge. */}
      <div className="md:hidden space-y-2">
        {isLoading ? (
          <div className="rounded-xl border bg-card py-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : sorted.length === 0 ? (
          <div className="rounded-xl border bg-card py-8 text-center text-sm text-muted-foreground">
            No pending marketplace receivables
          </div>
        ) : (
          sorted.map((r) => (
            <FinanceMobileCard
              key={r.id}
              title={r.product_name}
              subtitle={<span className="font-mono">{r.order_number}</span>}
              amount={peso(r.estimatedPayout)}
              amountSub={`of ${peso(r.totalSales)} · ${r.feePct}%${r.hasFeeOverride ? "" : " est"} fee`}
              badge={
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${channelBadgeClass(r.sales_channel)}`}>
                  {channelLabel(r.sales_channel)}
                </span>
              }
              meta={
                <>
                  <span>{r.order_date}</span>
                  <span className={r.daysOutstanding > 30 ? "text-destructive" : r.daysOutstanding > 14 ? "text-amber-600" : ""}>
                    · {r.daysOutstanding}d outstanding
                  </span>
                </>
              }
            />
          ))
        )}
      </div>

      <div className="border rounded-lg overflow-x-auto hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader sortKey="order_date" label="Order Date" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="sales_channel" label="Platform" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="order_number" label="Order Number" sort={sort} onToggle={toggle} />
              <TableHead>Product</TableHead>
              <SortableHeader sortKey="totalSales" label="Total Sales" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="feePct" label="Est. Fee %" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="estimatedPayout" label="Est. Payout" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="daysOutstanding" label="Days Outstanding" sort={sort} onToggle={toggle} align="right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
            ) : sorted.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No pending marketplace receivables</TableCell></TableRow>
            ) : (
              sorted.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm whitespace-nowrap">{r.order_date}</TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${channelBadgeClass(r.sales_channel)}`}>
                      {channelLabel(r.sales_channel)}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.order_number}</TableCell>
                  <TableCell className="text-sm">{r.product_name}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{peso(r.totalSales)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {r.feePct}%
                    {!r.hasFeeOverride && <span className="ml-1 text-[10px] text-muted-foreground uppercase">est</span>}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums font-medium">{peso(r.estimatedPayout)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    <span className={r.daysOutstanding > 30 ? "text-destructive" : r.daysOutstanding > 14 ? "text-amber-600" : ""}>
                      {r.daysOutstanding}d
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
