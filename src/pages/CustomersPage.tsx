import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCustomers, createCustomer, updateCustomer, deleteCustomer, getCustomerSalesActivity } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { peso } from "@/lib/currency";
import { format, differenceInCalendarDays, startOfDay, endOfDay, subDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2, Users, Search, CalendarIcon, X, MapPin, Download, BellRing, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Customer } from "@/types/database";
import { BulkEditDialog, type BulkField } from "@/components/BulkEditDialog";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";
import { FilterCombobox } from "@/components/FilterCombobox";
import { AddressSelector, emptyAddress, type AddressValue } from "@/components/AddressSelector";
import { formatLocationChip } from "@/lib/locations";
import { CLASSIFICATIONS, classificationMeta, getFollowUpInfo, markFollowedUp, getFollowUpHistory, type ClassificationValue } from "@/lib/followUps";

type ActivityBucket = "7" | "14" | "21" | "30" | "dormant" | "never";

function activityFromDays(days: number | null): { bucket: ActivityBucket; label: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string } {
  if (days === null) return { bucket: "never", label: "No orders", variant: "outline", className: "text-muted-foreground" };
  if (days <= 7) return { bucket: "7", label: "≤ 7 days", variant: "default", className: "bg-success/15 text-success border-success/30" };
  if (days <= 14) return { bucket: "14", label: "≤ 14 days", variant: "secondary", className: "bg-primary/15 text-primary border-primary/30" };
  if (days <= 21) return { bucket: "21", label: "≤ 21 days", variant: "secondary", className: "bg-accent/20 text-accent-foreground border-accent/40" };
  if (days <= 30) return { bucket: "30", label: "≤ 30 days", variant: "secondary", className: "bg-warning/15 text-warning border-warning/30" };
  return { bucket: "dormant", label: "Dormant", variant: "destructive", className: "bg-destructive/15 text-destructive border-destructive/30" };
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<{ name: string; contact_person: string; email: string; phone: string; classification: ClassificationValue }>({ name: "", contact_person: "", email: "", phone: "", classification: "retail" });
  const [address, setAddress] = useState<AddressValue>(emptyAddress());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [activityFilter, setActivityFilter] = useState<"all" | ActivityBucket>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [classFilter, setClassFilter] = useState<"all" | ClassificationValue>("all");
  const [followUpFilter, setFollowUpFilter] = useState<"all" | "active" | "needs" | "never">("all");
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [provinceFilter, setProvinceFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();

  // Follow-up dialog state
  const [followDialog, setFollowDialog] = useState<{ customer: Customer; notes: string } | null>(null);
  const [historyDialog, setHistoryDialog] = useState<Customer | null>(null);

  const fromStr = dateFrom ? format(startOfDay(dateFrom), "yyyy-MM-dd") : null;
  const toStr = dateTo ? format(endOfDay(dateTo), "yyyy-MM-dd") : null;

  const { data: customers = [], isLoading } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });

  const { data: activityMap = {} } = useQuery({
    queryKey: ["customer_sales_activity", customers.map((c) => c.id).sort().join(",")],
    queryFn: () => getCustomerSalesActivity(customers.map((c) => c.id)),
    enabled: customers.length > 0,
  });

  const { data: customerStats = {} } = useQuery({
    queryKey: ["customer_invoice_stats", fromStr, toStr],
    queryFn: async () => {
      let q = supabase
        .from("invoices")
        .select("id, customer_id, total_amount, invoice_date")
        .in("status", ["confirmed", "paid"]);
      if (fromStr) q = q.gte("invoice_date", fromStr);
      if (toStr) q = q.lte("invoice_date", toStr);
      const { data } = await q;
      const map: Record<string, { orders: number; total: number }> = {};
      for (const inv of (data || []) as any[]) {
        if (!inv.customer_id) continue;
        const e = map[inv.customer_id] || { orders: 0, total: 0 };
        e.orders += 1;
        e.total += Number(inv.total_amount || 0);
        map[inv.customer_id] = e;
      }
      return map;
    },
  });

  const today = new Date();
  type CustomerRow = Customer & { _orders: number; _total: number; _lastAgent: string; _lastDate: string | null; _daysSince: number | null };
  const enriched: CustomerRow[] = useMemo(
    () =>
      customers.map((c) => {
        const a = activityMap[c.id];
        const lastDate = a?.lastDate || null;
        const days = lastDate ? differenceInCalendarDays(today, new Date(lastDate)) : null;
        return {
          ...c,
          _orders: customerStats[c.id]?.orders || 0,
          _total: customerStats[c.id]?.total || 0,
          _lastAgent: a?.lastAgent || "",
          _lastDate: lastDate,
          _daysSince: days,
        };
      }),
    [customers, customerStats, activityMap],
  );

  const agentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of enriched) if (c._lastAgent) set.add(c._lastAgent);
    return Array.from(set).sort().map((name) => ({ value: name, label: name }));
  }, [enriched]);

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of enriched) if (c.country) set.add(c.country);
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [enriched]);

  const provinceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of enriched) {
      if (countryFilter !== "all" && c.country !== countryFilter) continue;
      if (c.province_state) set.add(c.province_state);
    }
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [enriched, countryFilter]);

  const cityOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of enriched) {
      if (countryFilter !== "all" && c.country !== countryFilter) continue;
      if (provinceFilter !== "all" && c.province_state !== provinceFilter) continue;
      if (c.city_municipality) set.add(c.city_municipality);
    }
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [enriched, countryFilter, provinceFilter]);

  const filtered = enriched.filter((customer) => {
    const q = search.trim().toLowerCase();
    if (q) {
      const cls = classificationMeta(customer.classification).label;
      const hit = [customer.name, customer.contact_person, customer.email, customer.phone, customer.address, customer._lastAgent, customer.country, customer.province_state, customer.city_municipality, customer.barangay_village, customer.full_address, cls]
        .some((value) => (value || "").toLowerCase().includes(q));
      if (!hit) return false;
    }
    if (activityFilter !== "all") {
      const b = activityFromDays(customer._daysSince).bucket;
      if (b !== activityFilter) return false;
    }
    if (agentFilter !== "all" && customer._lastAgent !== agentFilter) return false;
    if (classFilter !== "all" && (customer.classification || "retail") !== classFilter) return false;
    if (followUpFilter !== "all") {
      const s = getFollowUpInfo(customer.last_follow_up_at).status;
      if (followUpFilter === "active" && s !== "active") return false;
      if (followUpFilter === "needs" && s !== "needs") return false;
      if (followUpFilter === "never" && s !== "never") return false;
    }
    if (countryFilter !== "all" && customer.country !== countryFilter) return false;
    if (provinceFilter !== "all" && customer.province_state !== provinceFilter) return false;
    if (cityFilter !== "all" && customer.city_municipality !== cityFilter) return false;
    return true;
  });

  const toggleAll = () => {
    if (filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((c) => c.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const bulkDeleteMut = useMutation({
    mutationFn: async () => { for (const id of selectedIds) await deleteCustomer(id); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setSelectedIds(new Set());
      toast.success(`Deleted ${selectedIds.size} customers`);
    },
  });

  const { sort, toggle, sorted: sortedCustomers } = useSort<CustomerRow>(filtered, {
    name: (r) => r.name,
    contact_person: (r) => r.contact_person,
    email: (r) => r.email,
    phone: (r) => r.phone,
    _lastAgent: (r) => r._lastAgent,
    _lastDate: (r) => r._lastDate || "",
    _orders: (r) => r._orders,
    _total: (r) => r._total,
    city_municipality: (r) => r.city_municipality || "",
    classification: (r) => r.classification || "retail",
    last_follow_up_at: (r) => r.last_follow_up_at || "",
    days_since_follow_up: (r) => {
      const i = getFollowUpInfo(r.last_follow_up_at);
      return i.days ?? Number.MAX_SAFE_INTEGER;
    },
  });

  const createMut = useMutation({
    mutationFn: (data: Partial<Customer>) => createCustomer(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["customers"] }); setOpen(false); toast.success("Customer created"); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Customer> }) => updateCustomer(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["customers"] }); setOpen(false); setEditing(null); toast.success("Updated"); },
  });

  const deleteMut = useMutation({
    mutationFn: deleteCustomer,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["customers"] }); toast.success("Deleted"); },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", contact_person: "", email: "", phone: "", classification: "retail" });
    setAddress(emptyAddress());
    setOpen(true);
  };
  const openEdit = (c: Customer) => {
    setEditing(c);
    setForm({ name: c.name, contact_person: c.contact_person, email: c.email, phone: c.phone, classification: (c.classification as ClassificationValue) || "retail" });
    setAddress({
      country: c.country || "Philippines",
      province_state: c.province_state || "",
      city_municipality: c.city_municipality || "",
      district_area: c.district_area || "",
      barangay_village: c.barangay_village || "",
      full_address: c.full_address || c.address || "",
      postal_code: c.postal_code || "",
    });
    setOpen(true);
  };

  const handleSubmit = () => {
    const composedLegacy = [address.full_address, address.barangay_village, address.district_area, address.city_municipality, address.province_state, address.country, address.postal_code]
      .filter(Boolean).join(", ");
    const payload: Partial<Customer> = {
      ...form,
      country: address.country || null,
      province_state: address.province_state || null,
      city_municipality: address.city_municipality || null,
      district_area: address.district_area || null,
      barangay_village: address.barangay_village || null,
      full_address: address.full_address || null,
      postal_code: address.postal_code || null,
      address: composedLegacy,
    };
    if (editing) updateMut.mutate({ id: editing.id, data: payload });
    else createMut.mutate(payload);
  };

  const presetRange = (days: number) => { setDateTo(new Date()); setDateFrom(subDays(new Date(), days)); };

  const exportLocations = () => {
    const headers = ["Name","Contact","Email","Phone","Country","Province/State","City/Municipality","District","Barangay","Full Address","Postal Code"];
    const rows = sortedCustomers.map((c) => [
      c.name, c.contact_person, c.email, c.phone,
      c.country || "", c.province_state || "", c.city_municipality || "",
      c.district_area || "", c.barangay_village || "",
      c.full_address || c.address || "", c.postal_code || "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customer-locations-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} customers`);
  };

  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="page-header mb-0">
          <h1 className="page-title">Customers</h1>
          <p className="page-description">
            {filtered.length} customer{filtered.length !== 1 ? "s" : ""}
            {filtered.length !== customers.length ? ` (filtered from ${customers.length})` : ""}
          </p>
        </div>
        <div className="toolbar-actions">
          {selectedIds.size > 0 && (
            <>
              <BulkEditDialog
                selectedIds={Array.from(selectedIds)}
                entityLabel="customers"
                fields={[
                  { key: "contact_person", label: "Contact Person", type: "text" },
                  { key: "email", label: "Email", type: "text" },
                  { key: "phone", label: "Phone", type: "text" },
                  { key: "country", label: "Country", type: "text" },
                  { key: "province_state", label: "Province / State", type: "text" },
                  { key: "city_municipality", label: "City", type: "text" },
                ] as BulkField[]}
                updateOne={async (id, patch) => { await updateCustomer(id, patch as Partial<Customer>); }}
                onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["customers"] }); setSelectedIds(new Set()); }}
              />
              <Button variant="destructive" size="sm" onClick={() => bulkDeleteMut.mutate()} disabled={bulkDeleteMut.isPending}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete {selectedIds.size} selected
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className="h-9" onClick={exportLocations}>
            <Download className="h-4 w-4 mr-1.5" /> Export Locations
          </Button>
          <Button onClick={openCreate} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Plus className="h-4 w-4 mr-1.5" /> Add Customer
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>

        <div className="flex items-center gap-1 rounded-lg border bg-card p-1 flex-wrap">
          {([
            { v: "all", l: "All" },
            { v: "7", l: "≤7d" },
            { v: "14", l: "≤14d" },
            { v: "21", l: "≤21d" },
            { v: "30", l: "≤30d" },
            { v: "dormant", l: "Dormant" },
          ] as { v: "all" | ActivityBucket; l: string }[]).map((p) => (
            <Button key={p.v} variant={activityFilter === p.v ? "default" : "ghost"} size="sm" className="h-7 text-xs" onClick={() => setActivityFilter(p.v)}>
              {p.l}
            </Button>
          ))}
        </div>

        <FilterCombobox value={agentFilter} onChange={setAgentFilter} options={agentOptions} allLabel="All agents" placeholder="Search agent..." className="h-8 text-xs w-[170px]" emptyText="No agents" />

        <Select value={classFilter} onValueChange={(v) => setClassFilter(v as typeof classFilter)}>
          <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="Classification" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {CLASSIFICATIONS.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={followUpFilter} onValueChange={(v) => setFollowUpFilter(v as typeof followUpFilter)}>
          <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All follow-ups</SelectItem>
            <SelectItem value="active">Active (≤14d)</SelectItem>
            <SelectItem value="needs">Needs follow up</SelectItem>
            <SelectItem value="never">Never followed up</SelectItem>
          </SelectContent>
        </Select>

        <FilterCombobox value={countryFilter} onChange={(v) => { setCountryFilter(v); setProvinceFilter("all"); setCityFilter("all"); }} options={countryOptions} allLabel="All countries" placeholder="Search country..." className="h-8 text-xs w-[160px]" emptyText="No countries" />
        <FilterCombobox value={provinceFilter} onChange={(v) => { setProvinceFilter(v); setCityFilter("all"); }} options={provinceOptions} allLabel="All provinces" placeholder="Search province..." className="h-8 text-xs w-[170px]" emptyText="No provinces" />
        <FilterCombobox value={cityFilter} onChange={setCityFilter} options={cityOptions} allLabel="All cities" placeholder="Search city..." className="h-8 text-xs w-[160px]" emptyText="No cities" />

        <div className="flex items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("h-8 text-xs w-[130px] justify-start", !dateFrom && "text-muted-foreground")}>
                <CalendarIcon className="h-3 w-3 mr-1" />
                {dateFrom ? format(dateFrom, "MMM d, yyyy") : "From"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          <span className="text-xs text-muted-foreground">—</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("h-8 text-xs w-[130px] justify-start", !dateTo && "text-muted-foreground")}>
                <CalendarIcon className="h-3 w-3 mr-1" />
                {dateTo ? format(dateTo, "MMM d, yyyy") : "To"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setDateFrom(undefined); setDateTo(undefined); }} title="Clear range">
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => presetRange(7)}>7d</Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => presetRange(30)}>30d</Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => presetRange(90)}>90d</Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">{editing ? "Edit Customer" : "New Customer"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-9" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Contact Person</Label>
                <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Email</Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Classification</Label>
                <Select value={form.classification} onValueChange={(v) => setForm({ ...form, classification: v as ClassificationValue })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CLASSIFICATIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        <div className="flex flex-col">
                          <span className="font-medium">{c.label}</span>
                          <span className="text-[10px] text-muted-foreground">{c.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <AddressSelector value={address} onChange={setAddress} />

            <Button onClick={handleSubmit} className="mt-2 rounded-lg h-9">
              {editing ? "Update" : "Create Customer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox checked={filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))} onCheckedChange={toggleAll} />
              </TableHead>
              <SortableHeader sortKey="name" label="Name" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="classification" label="Type" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="contact_person" label="Contact" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="email" label="Email" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="phone" label="Phone" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="city_municipality" label="Location" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="_lastAgent" label="Sales Agent" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="_lastDate" label="Last Order" sort={sort} onToggle={toggle} />
              <TableHead className="text-xs">Activity</TableHead>
              <SortableHeader sortKey="last_follow_up_at" label="Last Follow-up" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="_orders" label="# Orders" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="_total" label="Total ₱" sort={sort} onToggle={toggle} align="right" />
              <TableHead className="text-xs text-right w-32">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={12} className="h-32 text-center">
                  <div className="flex justify-center">
                    <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                </TableCell>
              </TableRow>
            ) : sortedCustomers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12}>
                  <div className="empty-state">
                    <Users className="empty-state-icon" />
                    <p className="text-sm">No customers match</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              sortedCustomers.map((c) => {
                const activity = activityFromDays(c._daysSince);
                const locChip = formatLocationChip(c);
                return (
                  <TableRow key={c.id} className={selectedIds.has(c.id) ? "bg-muted/40" : "hover:bg-muted/30"}>
                    <TableCell>
                      <Checkbox checked={selectedIds.has(c.id)} onCheckedChange={() => toggleOne(c.id)} />
                    </TableCell>
                    <TableCell className="font-medium text-sm">{c.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.contact_person}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.email}</TableCell>
                    <TableCell className="text-sm">{c.phone}</TableCell>
                    <TableCell className="text-sm">
                      {locChip ? (
                        <Badge variant="outline" className="text-[10px] font-medium gap-1 max-w-[180px]">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate">{locChip}</span>
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{c._lastAgent || "—"}</TableCell>
                    <TableCell className="text-sm">
                      {c._lastDate ? (
                        <span>
                          {format(new Date(c._lastDate), "MMM d, yyyy")}
                          <span className="text-xs text-muted-foreground ml-1">({c._daysSince}d)</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-[10px] font-medium", activity.className)}>
                        {activity.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-right font-medium">{c._orders || "—"}</TableCell>
                    <TableCell className="text-sm text-right font-semibold">{c._total ? peso(c._total) : "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(c)} className="h-7 w-7 rounded-md">
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(c.id)} className="h-7 w-7 rounded-md">
                          <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
