import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getInvoices, createInvoice, deleteInvoice, getCustomers, getItems, createInvoiceItems, getInvoiceItems, confirmInvoice, revertInvoice, updateInvoice, markInvoicePaid, generateInvoiceNumber, deleteInvoiceItems, getSalesAgents, createSalesAgent, getLastSalesAgentForCustomer, reserveInvoice, shipInvoice, cancelInvoice, convertReservedToSale } from "@/lib/api";
import { peso } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/StatusBadge";
import { Plus, Trash2, Eye, CheckCircle, DollarSign, Receipt, FileDown, Undo2, Pencil, Filter, Search, Check, ChevronsUpDown, BookmarkPlus, Truck, XCircle, ArrowRightCircle } from "lucide-react";
import ExportButton from "@/components/ExportButton";
import { ItemSearch } from "@/components/ItemSearch";
import { CustomerSearchWithCreate } from "@/components/CustomerSearchWithCreate";
import { toast } from "sonner";
import { DocumentPreview } from "@/components/DocumentPreview";
import type { DocumentData } from "@/lib/pdf";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { BulkEditDialog, type BulkField } from "@/components/BulkEditDialog";
import { DateField } from "@/components/DateField";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";
import { format, addDays, parseISO } from "date-fns";
import { checkStoreStock, formatShortageMessage } from "@/lib/stockCheck";
import { CustomerPriceHint } from "@/components/CustomerPriceHint";
import { isInvoiceLocked, INVOICE_LOCK_MESSAGE } from "@/lib/permissions";
import { Lock } from "lucide-react";

interface LineItem { item_id: string; item_name: string; quantity: number | ""; unit_price: number | ""; variation_id: string | null; }

export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const filterDateToRef = useRef<HTMLInputElement | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewInv, setViewInv] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<DocumentData | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [form, setForm] = useState({ customer_id: "", notes: "", due_date: "", sales_agent: "", payment_terms: "" });
  const [agentAutoFilled, setAgentAutoFilled] = useState(false);
  const handleCustomerChange = async (v: string) => {
    setForm((f) => ({ ...f, customer_id: v }));
    setAgentAutoFilled(false);
    if (!v || editId) return;
    try {
      const agent = await getLastSalesAgentForCustomer(v);
      if (agent) {
        setForm((f) => (f.sales_agent ? f : { ...f, sales_agent: agent }));
        setAgentAutoFilled(true);
      }
    } catch {/* ignore */}
  };
  const [lines, setLines] = useState<LineItem[]>([{ item_id: "", item_name: "", quantity: "", unit_price: "", variation_id: null }]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filters
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("all");
  const [filterAgent, setFilterAgent] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: getInvoices });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });
  const { data: items = [] } = useQuery({ queryKey: ["items"], queryFn: getItems });
  const { data: invItems = [] } = useQuery({ queryKey: ["invoice_items", viewInv], queryFn: () => getInvoiceItems(viewInv!), enabled: !!viewInv });
  const { data: salesAgents = [] } = useQuery({ queryKey: ["sales_agents"], queryFn: getSalesAgents });
  const [newAgentName, setNewAgentName] = useState("");
  const [addingAgent, setAddingAgent] = useState(false);

  const addAgentMut = useMutation({
    mutationFn: (name: string) => createSalesAgent(name),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["sales_agents"] });
      setForm(f => ({ ...f, sales_agent: data.name }));
      setNewAgentName("");
      setAddingAgent(false);
      toast.success("Sales agent added");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Base set with date + search applied; per-filter "available options" further
  // restrict by the OTHER active filters so each dropdown only lists values
  // that would actually return results.
  const dateSearchFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return invoices.filter((inv: any) => {
      if (filterDateFrom && (inv.invoice_date || "") < filterDateFrom) return false;
      if (filterDateTo && (inv.invoice_date || "") > filterDateTo) return false;
      if (q) {
        const hay = [inv.invoice_number, inv.customers?.name, inv.sales_agent, inv.notes]
          .map((x: any) => String(x || "").toLowerCase()).join(" ");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, filterDateFrom, filterDateTo, searchQuery]);

  const filteredWithoutCustomer = useMemo(() => dateSearchFiltered.filter((inv: any) => {
    if (filterAgent !== "all" && (inv.sales_agent || "") !== filterAgent) return false;
    if (filterStatus !== "all" && inv.status !== filterStatus) return false;
    return true;
  }), [dateSearchFiltered, filterAgent, filterStatus]);

  const availableCustomers = useMemo(() => {
    const ids = new Set<string>();
    for (const inv of filteredWithoutCustomer) if (inv.customer_id) ids.add(inv.customer_id);
    return customers.filter(c => ids.has(c.id));
  }, [filteredWithoutCustomer, customers]);

  const availableAgents = useMemo(() => {
    const names = new Set<string>();
    for (const inv of dateSearchFiltered) {
      if (filterCustomer !== "all" && inv.customer_id !== filterCustomer) continue;
      if (filterStatus !== "all" && inv.status !== filterStatus) continue;
      if (inv.sales_agent) names.add(inv.sales_agent);
    }
    return salesAgents.filter((a: any) => names.has(a.name));
  }, [dateSearchFiltered, salesAgents, filterCustomer, filterStatus]);

  const availableStatuses = useMemo(() => {
    const set = new Set<string>();
    for (const inv of dateSearchFiltered) {
      if (filterCustomer !== "all" && inv.customer_id !== filterCustomer) continue;
      if (filterAgent !== "all" && (inv.sales_agent || "") !== filterAgent) continue;
      if (inv.status) set.add(inv.status);
    }
    return set;
  }, [dateSearchFiltered, filterCustomer, filterAgent]);

  const filtered = useMemo(() => {
    if (filterCustomer === "all") return filteredWithoutCustomer;
    return filteredWithoutCustomer.filter((inv: any) => inv.customer_id === filterCustomer);
  }, [filteredWithoutCustomer, filterCustomer]);

  const [customerFilterOpen, setCustomerFilterOpen] = useState(false);

  // Quick filter buckets for the new Reserved workflow.
  // - reserved: order placed, stock allocated, not paid, not shipped
  // - not_shipped: legacy draft (no stock deduction yet)
  // - awaiting_payment: shipped/confirmed but not yet paid (red)
  // - awaiting_shipment: paid but not yet shipped/picked up (blue)
  // - completed: paid AND shipped
  // - cancelled: cancelled — excluded from sales reporting
  const [quickFilter, setQuickFilter] = useState<
    "all" | "reserved" | "not_shipped" | "awaiting_payment" | "awaiting_shipment" | "completed" | "cancelled"
  >("all");
  const statusBuckets: Record<string, typeof quickFilter> = {
    draft: "not_shipped",
    reserved: "reserved",
    confirmed: "awaiting_payment", // legacy: shipped, not paid
    shipped: "awaiting_payment",
    unpaid: "awaiting_payment",
    paid: "awaiting_shipment", // paid, pending shipment/pickup
    completed: "completed",
    cancelled: "cancelled",
  };
  const quickFiltered = useMemo(
    () => quickFilter === "all" ? filtered : filtered.filter((inv: any) => statusBuckets[inv.status] === quickFilter),
    [filtered, quickFilter]
  );
  const bucketCounts = useMemo(() => {
    const c = { reserved: 0, not_shipped: 0, awaiting_payment: 0, awaiting_shipment: 0, completed: 0, cancelled: 0 } as Record<string, number>;
    for (const inv of filtered as any[]) {
      const b = statusBuckets[inv.status];
      if (b && b !== "all") c[b]++;
    }
    return c;
  }, [filtered]);

  const { sort, toggle, sorted: sortedInvoices } = useSort<any>(quickFiltered, {
    invoice_number: (r) => r.invoice_number,
    customer: (r) => r.customers?.name || "",
    sales_agent: (r) => r.sales_agent || "",
    invoice_date: (r) => r.invoice_date,
    status: (r) => r.status,
    total_amount: (r) => Number(r.total_amount),
  });

  // Statuses that count as a real sale (exclude reserved, draft, cancelled)
  const SALE_STATUSES = new Set(["confirmed", "paid", "unpaid", "shipped", "completed"]);

  // Total sales (admin only) — sum of real sales (excludes reserved & cancelled) in current filter
  const totalSales = useMemo(() => {
    return filtered
      .filter((inv: any) => SALE_STATUSES.has(inv.status))
      .reduce((s: number, inv: any) => s + Number(inv.total_amount || 0), 0);
  }, [filtered]);


  const toggleAll = () => {
    if (selectedIds.size === quickFiltered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(quickFiltered.map((i: any) => i.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  // Any selected invoice locked? Disables bulk edit / delete to enforce locking rules.
  const anySelectedLocked = useMemo(() => {
    return Array.from(selectedIds).some((id) => {
      const inv: any = invoices.find((i: any) => i.id === id);
      return inv && isInvoiceLocked(inv.status);
    });
  }, [selectedIds, invoices]);

  const bulkDeleteMut = useMutation({
    mutationFn: async () => { for (const id of selectedIds) await deleteInvoice(id); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); setSelectedIds(new Set()); toast.success(`Deleted ${selectedIds.size} invoices`); },
  });

  const openPreview = async (inv: any) => {
    const lineItems = await getInvoiceItems(inv.id);
    setPreviewData({
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
      items: lineItems.map((li: any) => {
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
      totalAmount: Number(inv.total_amount),
    });
    setPreviewOpen(true);
  };

  const openEdit = async (inv: any) => {
    if (isInvoiceLocked(inv.status)) {
      toast.error(INVOICE_LOCK_MESSAGE);
      return;
    }
    const lineItems = await getInvoiceItems(inv.id);
    setForm({
      customer_id: inv.customer_id || "",
      notes: inv.notes || "",
      due_date: inv.due_date || "",
      sales_agent: inv.sales_agent || "",
      payment_terms: "",
    });
    setLines(
      lineItems.length > 0
        ? lineItems.map((li: any) => ({
            item_id: li.item_id || "",
            item_name: li.item_name || li.items?.name || "",
            quantity: li.quantity,
            unit_price: Number(li.unit_price) > 0 ? Number(li.unit_price) : "" as const,
            variation_id: li.variation_id || null,
          }))
        : [{ item_id: "", item_name: "", quantity: "", unit_price: "", variation_id: null }]
    );
    setEditId(inv.id);
    setCreateOpen(true);
  };

  const validateLines = () => {
    const saved = lines.filter(l => l.item_id || l.item_name);
    if (saved.length === 0) throw new Error("Add at least one item");
    for (const l of saved) {
      const name = l.item_name || "Item";
      if (!l.quantity || Number(l.quantity) <= 0) throw new Error(`"${name}" must have a quantity greater than 0`);
    }
    return saved;
  };

  const hasMissingPrice = lines.some(l => (l.item_id || l.item_name) && (l.unit_price === "" || Number(l.unit_price) <= 0));

  const createMut = useMutation({
    mutationFn: async () => {
      const saved = validateLines();
      const total = saved.reduce((s, l) => s + Number(l.quantity) * (Number(l.unit_price) || 0), 0);
      const inv = await createInvoice({ invoice_number: await generateInvoiceNumber(), customer_id: form.customer_id || null, notes: form.notes, due_date: form.due_date || null, total_amount: total, sales_agent: form.sales_agent });
      await createInvoiceItems(saved.map(l => ({ invoice_id: inv.id, item_id: l.item_id || null, item_name: l.item_name || null, quantity: Number(l.quantity), unit_price: Number(l.unit_price) || 0, variation_id: l.variation_id || null })));
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); setCreateOpen(false); toast.success("Invoice created"); resetForm(); },
    onError: (e: any) => toast.error(e.message),
  });

  const editMut = useMutation({
    mutationFn: async () => {
      if (!editId) return;
      const saved = validateLines();
      const total = saved.reduce((s, l) => s + Number(l.quantity) * (Number(l.unit_price) || 0), 0);
      await updateInvoice(editId, { customer_id: form.customer_id || null, notes: form.notes, due_date: form.due_date || null, total_amount: total, sales_agent: form.sales_agent });
      await deleteInvoiceItems(editId);
      await createInvoiceItems(saved.map(l => ({ invoice_id: editId, item_id: l.item_id || null, item_name: l.item_name || null, quantity: Number(l.quantity), unit_price: Number(l.unit_price) || 0, variation_id: l.variation_id || null })));
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); setCreateOpen(false); setEditId(null); toast.success("Invoice updated"); resetForm(); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteInvoice,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); toast.success("Deleted"); },
  });

  const confirmMut = useMutation({
    mutationFn: confirmInvoice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Invoice confirmed — stock deducted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const markPaidMut = useMutation({
    mutationFn: ({ id, payment_method, payment_reference, payment_reference_url }: { id: string; payment_method: string; payment_reference?: string; payment_reference_url?: string }) =>
      markInvoicePaid(id, { payment_method, payment_reference: payment_reference || null, payment_reference_url: payment_reference_url || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Marked as paid — stock deducted if not already");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const [payDialog, setPayDialog] = useState<{ id: string; afterShip?: boolean } | null>(null);
  const [payMethod, setPayMethod] = useState("Cash");
  const [payReference, setPayReference] = useState("");
  const [payRefFile, setPayRefFile] = useState<File | null>(null);
  const [payUploading, setPayUploading] = useState(false);

  const openPayDialog = (id: string) => {
    setPayMethod("Cash");
    setPayReference("");
    setPayRefFile(null);
    setPayDialog({ id });
  };

  const handlePayPaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (item) {
      const file = item.getAsFile();
      if (file) setPayRefFile(file);
    }
  };

  const submitPayment = async () => {
    if (!payDialog) return;
    if (payMethod !== "Cash" && !payReference.trim() && !payRefFile) {
      toast.error("Please provide a reference number or image");
      return;
    }
    let url = "";
    if (payRefFile) {
      try {
        setPayUploading(true);
        const ext = payRefFile.name.split(".").pop() || "png";
        const path = `${payDialog.id}/${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from("payment-references").upload(path, payRefFile, { upsert: true });
        if (error) throw error;
        url = supabase.storage.from("payment-references").getPublicUrl(path).data.publicUrl;
      } catch (e: any) {
        toast.error("Image upload failed: " + e.message);
        setPayUploading(false);
        return;
      }
      setPayUploading(false);
    }
    markPaidMut.mutate({ id: payDialog.id, payment_method: payMethod, payment_reference: payReference, payment_reference_url: url });
    setPayDialog(null);
  };

  const revertMut = useMutation({
    mutationFn: revertInvoice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Invoice reverted to draft — stock restored");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const reserveMut = useMutation({
    mutationFn: reserveInvoice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Order reserved — stock allocated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const shipMut = useMutation({
    mutationFn: shipInvoice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Marked as shipped");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: cancelInvoice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Order cancelled — reserved stock returned");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const convertMut = useMutation({
    mutationFn: convertReservedToSale,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Converted to open sales order — stock allocation preserved");
    },
    onError: (e: any) => toast.error(e.message),
  });


  const resetForm = () => { setForm({ customer_id: "", notes: "", due_date: "", sales_agent: "", payment_terms: "" }); setLines([{ item_id: "", item_name: "", quantity: "", unit_price: "", variation_id: null }]); setEditId(null); setAgentAutoFilled(false); };
  const handleClose = () => { setCreateOpen(false); setEditId(null); resetForm(); };
  const addLine = () => setLines([...lines, { item_id: "", item_name: "", quantity: "", unit_price: "", variation_id: null }]);
  const updateLine = (idx: number, field: string, value: any) => {
    const newLines = [...lines];
    (newLines[idx] as any)[field] = value;
    if (field === "item_id") {
      const item = items.find(i => i.id === value);
      if (item) {
        newLines[idx].item_name = item.name;
      }
    }
    setLines(newLines);
  };
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));
  const clearFilters = () => { setFilterDateFrom(""); setFilterDateTo(""); setFilterCustomer("all"); setFilterAgent("all"); setFilterStatus("all"); };

  // Warn (but allow) if shipping/paying an invoice would oversell store stock.
  const confirmStockOrAsk = async (invoiceId: string, action: "ship" | "pay"): Promise<boolean> => {
    try {
      const lineItems = await getInvoiceItems(invoiceId);
      const shortages = await checkStoreStock(
        lineItems.map((li: any) => ({
          item_id: li.item_id,
          variation_id: li.variation_id || null,
          quantity: li.quantity,
        })),
      );
      if (shortages.length === 0) return true;
      const verb = action === "ship" ? "ship" : "mark this invoice as paid";
      return window.confirm(
        `Store inventory is not enough to ${verb}:\n\n${formatShortageMessage(shortages)}\n\nProceeding will let store stock go negative. Continue?`,
      );
    } catch {
      return true; // don't block on check failure
    }
  };


  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="page-header mb-0">
          <h1 className="page-title">Invoices</h1>
          <p className="page-description">{filtered.length} invoice{filtered.length !== 1 ? "s" : ""}{filtered.length !== invoices.length ? ` (filtered from ${invoices.length})` : ""}</p>
        </div>
        <div className="toolbar-actions">
          {selectedIds.size > 0 && (
            <>
              {anySelectedLocked ? (
                <span className="inline-flex items-center gap-1 text-xs text-amber-600 px-2">
                  <Lock className="h-3.5 w-3.5" /> Selection contains locked invoices — bulk actions disabled
                </span>
              ) : (
                <>
                  <BulkEditDialog
                    selectedIds={Array.from(selectedIds)}
                    entityLabel="invoices"
                    fields={[
                      { key: "status", label: "Status", type: "select", options: [
                        { value: "draft", label: "Not Shipped" },
                        { value: "reserved", label: "Reserved" },
                        { value: "confirmed", label: "Shipped (legacy)" },
                        { value: "shipped", label: "Shipped" },
                        { value: "paid", label: "Paid (pending shipment)" },
                        { value: "completed", label: "Completed" },
                        { value: "cancelled", label: "Cancelled" },
                        { value: "unpaid", label: "Unpaid" },
                      ]},

                      { key: "sales_agent", label: "Sales Agent", type: "select", options: salesAgents.map((a: any) => ({ value: a.name, label: a.name })) },
                      { key: "due_date", label: "Due Date", type: "date" },
                      { key: "notes", label: "Notes", type: "textarea" },
                    ] as BulkField[]}
                    updateOne={async (id, patch) => { await updateInvoice(id, patch as any); }}
                    onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); setSelectedIds(new Set()); }}
                  />
                  {isAdmin && (
                    <Button variant="destructive" size="sm" onClick={() => bulkDeleteMut.mutate()} disabled={bulkDeleteMut.isPending}>
                      <Trash2 className="h-4 w-4 mr-1" /> Delete {selectedIds.size} selected
                    </Button>
                  )}
                </>
              )}
            </>
          )}
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search invoice #, customer, agent..."
              className="h-9 pl-8 text-sm w-[260px]"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="rounded-lg h-9 px-3 text-sm">
            <Filter className="h-4 w-4 mr-1.5" /> Filters
          </Button>
          <ExportButton
            data={filtered}
            columns={{
              "Invoice #": (r: any) => r.invoice_number,
              "Date": (r: any) => r.invoice_date,
              "Customer": (r: any) => r.customers?.name || "",
              "Sales Agent": (r: any) => r.sales_agent || "",
              "Status": (r: any) => r.status,
              "Due Date": (r: any) => r.due_date || "",
              "Invoice Total": (r: any) => r.total_amount,
              "Notes": (r: any) => r.notes || "",
            }}
            childItems={{
              table: "invoice_items",
              foreignKey: "invoice_id",
              select: "*, items(name, sku), item_variations(name, sku)",
              columns: {
                "Item Name": (li: any) => li.item_variations?.name || li.item_name || li.items?.name || "",
                "SKU": (li: any) => li.item_variations?.sku || li.items?.sku || "",
                "Variation": (li: any) => li.item_variations?.name || "",
                "Quantity": (li: any) => Number(li.quantity || 0),
                "Unit Price": (li: any) => Number(li.unit_price || 0),
                "Line Total": (li: any) => Number(li.quantity || 0) * Number(li.unit_price || 0),
              },
            }}
            dateField={(r: any) => r.invoice_date || ""}
            fileName="Invoices"
          />
          <Button onClick={() => { resetForm(); setCreateOpen(true); }} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Plus className="h-4 w-4 mr-1.5" /> New Invoice
          </Button>
        </div>
      </div>

      <div className="inline-flex rounded-lg border bg-card p-0.5">
        {([
          { key: "all", label: `All (${filtered.length})` },
          { key: "not_shipped", label: `Not Shipped (${bucketCounts.not_shipped})` },
          { key: "unpaid", label: `Unpaid (${bucketCounts.unpaid})` },
          { key: "shipped", label: `Shipped (${bucketCounts.shipped})` },
        ] as const).map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => setQuickFilter(b.key as any)}
            className={`px-3 h-8 text-xs font-medium rounded-md transition-colors ${
              quickFilter === b.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {showFilters && (
        <div className="filter-bar">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Date From</Label>
            <Input
              type="date"
              value={filterDateFrom}
              onChange={(e) => {
                setFilterDateFrom(e.target.value);
                if (!e.target.value) return;
                requestAnimationFrame(() => {
                  filterDateToRef.current?.focus();
                  filterDateToRef.current?.showPicker?.();
                });
              }}
              className="h-9 sm:h-8 sm:w-36 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Date To</Label>
            <Input ref={filterDateToRef} type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="h-9 sm:h-8 sm:w-36 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Customer</Label>
            <Popover open={customerFilterOpen} onOpenChange={setCustomerFilterOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="h-9 sm:h-8 sm:w-44 text-sm justify-between font-normal">
                  <span className="truncate">
                    {filterCustomer === "all"
                      ? `All Customers (${availableCustomers.length})`
                      : (customers.find(c => c.id === filterCustomer)?.name || "Select")}
                  </span>
                  <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search customer..." className="h-9" />
                  <CommandList>
                    <CommandEmpty>No customers found</CommandEmpty>
                    <CommandGroup>
                      <CommandItem value="all" onSelect={() => { setFilterCustomer("all"); setCustomerFilterOpen(false); }}>
                        <Check className={cn("mr-2 h-4 w-4", filterCustomer === "all" ? "opacity-100" : "opacity-0")} />
                        All Customers ({availableCustomers.length})
                      </CommandItem>
                      {availableCustomers.map(c => (
                        <CommandItem key={c.id} value={c.name} onSelect={() => { setFilterCustomer(c.id); setCustomerFilterOpen(false); }}>
                          <Check className={cn("mr-2 h-4 w-4", filterCustomer === c.id ? "opacity-100" : "opacity-0")} />
                          {c.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Sales Agent</Label>
            <Select value={filterAgent} onValueChange={setFilterAgent}>
              <SelectTrigger className="h-9 sm:h-8 sm:w-44 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents ({availableAgents.length})</SelectItem>
                {availableAgents.map((a: any) => <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Status</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-9 sm:h-8 sm:w-40 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {([
                  { v: "draft", l: "Not Shipped" },
                  { v: "confirmed", l: "Shipped" },
                  { v: "paid", l: "Paid" },
                  { v: "unpaid", l: "Unpaid" },
                ] as const).filter(s => availableStatuses.has(s.v)).map(s => (
                  <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs">Clear</Button>
        </div>
      )}

      {isAdmin && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 sm:p-4 rounded-lg border bg-primary/5">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Sales</p>
            <p className="text-xs text-muted-foreground mt-0.5">Sum of shipped &amp; paid invoices in current filter</p>
          </div>
          <p className="text-xl sm:text-2xl font-bold tabular-nums truncate">{peso(totalSales)}</p>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-lg">{editId ? "Edit Invoice" : "New Invoice"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Customer</Label>
                <CustomerSearchWithCreate customers={customers} value={form.customer_id} onChange={handleCustomerChange} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Sales Agent</Label>
                {!addingAgent ? (
                  <div className="flex gap-1.5">
                    <Select value={form.sales_agent} onValueChange={v => { setForm({ ...form, sales_agent: v }); setAgentAutoFilled(false); }}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Select agent" /></SelectTrigger>
                      <SelectContent>
                        {salesAgents.map((a: any) => <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setAddingAgent(true)} title="Add new agent"><Plus className="h-3.5 w-3.5" /></Button>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <Input value={newAgentName} onChange={e => setNewAgentName(e.target.value)} className="h-9" placeholder="New agent name" autoFocus />
                    <Button type="button" size="sm" className="h-9 px-3 text-xs" disabled={!newAgentName.trim() || addAgentMut.isPending} onClick={() => addAgentMut.mutate(newAgentName.trim())}>Save</Button>
                    <Button type="button" variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={() => { setAddingAgent(false); setNewAgentName(""); }}>Cancel</Button>
                  </div>
                )}
                {agentAutoFilled && form.sales_agent && (
                  <p className="text-[10px] text-muted-foreground">Auto-filled from customer's latest transaction</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Payment Terms (days)</Label>
                <Input type="number" min={0} value={form.payment_terms} onChange={e => {
                  const v = e.target.value;
                  const days = parseInt(v);
                  let due = form.due_date;
                  if (!isNaN(days) && days >= 0) {
                    const baseStr = editId ? (invoices.find((i: any) => i.id === editId)?.invoice_date) : null;
                    const base = baseStr ? parseISO(baseStr) : new Date();
                    due = format(addDays(base, days), "yyyy-MM-dd");
                  }
                  setForm({ ...form, payment_terms: v, due_date: due });
                }} className="h-9" placeholder="e.g. 30" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Due Date</Label>
                <DateField value={form.due_date} onChange={v => setForm({ ...form, due_date: v })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="resize-none" rows={2} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-xs font-medium">Line Items</Label>
                <Button variant="outline" size="sm" onClick={addLine} className="h-7 rounded-md text-xs"><Plus className="h-3 w-3 mr-1" /> Add</Button>
              </div>
              <div className="space-y-2">
                {lines.map((line, idx) => {
                  const selectedItem = items.find(i => i.id === line.item_id);
                  return (
                    <div key={idx} className="border rounded-md p-2 sm:border-0 sm:p-0">
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_70px_90px_32px] gap-2">
                        <ItemSearch
                          items={items}
                          value={line.item_id}
                          variationId={line.variation_id}
                          customName={line.item_name}
                          onChange={(itemId, item, customName, variation) => {
                            const newLines = [...lines];
                            if (variation && item) {
                              newLines[idx].item_id = item.id;
                              newLines[idx].item_name = variation.name;
                              newLines[idx].variation_id = variation.id;
                            } else if (itemId) {
                              newLines[idx].item_id = itemId;
                              newLines[idx].item_name = item?.name || "";
                              newLines[idx].variation_id = null;
                            } else {
                              newLines[idx].item_id = "";
                              newLines[idx].item_name = customName || "";
                              newLines[idx].variation_id = null;
                            }
                            setLines(newLines);
                          }}
                          placeholder="Search item or variation..."
                          allowCustom
                        />
                        <div className="grid grid-cols-[1fr_1fr_32px] gap-2 sm:contents">
                          <Input type="number" value={line.quantity} onChange={e => { const v = e.target.value; updateLine(idx, "quantity", v === "" ? "" : (parseInt(v) || "")); }} className="h-9 text-sm" placeholder="Enter quantity" />
                          <Input type="number" value={line.unit_price} onChange={e => { const v = e.target.value; updateLine(idx, "unit_price", v === "" ? "" : (parseFloat(v) || "")); }} className="h-9 text-sm" placeholder="Enter price" />
                          <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} className="h-9 w-8"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
                        </div>
                      </div>
                      {selectedItem && <p className="text-[11px] text-muted-foreground mt-0.5 ml-1">In stock: {selectedItem.quantity}{(selectedItem.units_per_stock ?? 1) > 1 && (selectedItem.open_roll_remaining ?? 0) > 0 ? ` + ${selectedItem.open_roll_remaining}${selectedItem.base_unit || 'm'} open` : ''}</p>}
                      {(line.item_id || line.item_name) && (line.unit_price === "" || Number(line.unit_price) <= 0) && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 ml-1">⚠ No price set for this item</p>
                      )}
                      {selectedItem && form.customer_id && (
                        <CustomerPriceHint
                          customerId={form.customer_id}
                          itemId={line.item_id}
                          variationId={line.variation_id}
                          standardPrice={Number(selectedItem.selling_price)}
                          costPrice={Number(selectedItem.cost_price)}
                          currentPrice={Number(line.unit_price) || 0}
                          onSuggested={(suggested) => updateLine(idx, "unit_price", suggested)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end mt-3 pt-3 border-t">
                <span className="text-sm font-semibold">Total: {peso(lines.reduce((s, l) => s + Number(l.quantity || 0) * (Number(l.unit_price) || 0), 0))}</span>
              </div>
            </div>
            {hasMissingPrice && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                Warning: One or more items do not have a price. You can still save this invoice.
              </div>
            )}
            <Button
              onClick={() => editId ? editMut.mutate() : createMut.mutate()}
              disabled={createMut.isPending || editMut.isPending}
              className="rounded-lg h-9"
            >
              {editId ? "Update Invoice" : "Create Invoice"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewInv} onOpenChange={() => setViewInv(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-lg">Invoice Details</DialogTitle></DialogHeader>
          {(() => {
            const inv: any = invoices.find((i: any) => i.id === viewInv);
            if (!inv) return null;
            return (
              <div className="space-y-2 text-sm">
                {isInvoiceLocked(inv.status) && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2.5 text-xs text-amber-900 dark:text-amber-200">
                    <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>{INVOICE_LOCK_MESSAGE}</span>
                  </div>
                )}
                {inv.payment_method && (
                  <div className="text-muted-foreground">Payment Method: <span className="font-medium text-foreground">{inv.payment_method}</span></div>
                )}
                {inv.payment_reference && (
                  <div className="text-muted-foreground">Reference #: <span className="font-medium text-foreground">{inv.payment_reference}</span></div>
                )}
                {inv.payment_reference_url && (
                  <div className="pt-2">
                    <a href={inv.payment_reference_url} target="_blank" rel="noreferrer">
                      <img src={inv.payment_reference_url} alt="Payment reference" className="max-h-48 rounded border" />
                    </a>
                  </div>
                )}
              </div>
            );
          })()}
          <div className="data-table-wrapper mt-2">
            <Table>
              <TableHeader><TableRow><TableHead className="text-xs">SKU</TableHead><TableHead className="text-xs">Item</TableHead><TableHead className="text-xs">Qty</TableHead><TableHead className="text-xs text-right">Price</TableHead><TableHead className="text-xs text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {invItems.map(ii => (
                  <TableRow key={ii.id}>
                     <TableCell className="font-mono text-xs text-primary font-medium">{(ii as any).item_variations?.sku || ii.items?.sku || "—"}</TableCell>
                     <TableCell className="text-sm font-medium">{(ii as any).item_variations?.name || (ii as any).item_name || ii.items?.name || "—"}</TableCell>
                    <TableCell className="text-sm">{ii.quantity}</TableCell>
                    <TableCell className="text-sm text-right">{peso(Number(ii.unit_price))}</TableCell>
                    <TableCell className="text-sm text-right font-medium">{peso(ii.quantity * Number(ii.unit_price))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Checkbox checked={quickFiltered.length > 0 && selectedIds.size === quickFiltered.length} onCheckedChange={toggleAll} /></TableHead>
              <SortableHeader sortKey="invoice_number" label="Invoice #" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="customer" label="Customer" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="sales_agent" label="Sales Agent" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="invoice_date" label="Date" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="status" label="Status" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="total_amount" label="Total" sort={sort} onToggle={toggle} align="right" />
              <TableHead className="text-xs text-right w-28">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedInvoices.length === 0 ? (
              <TableRow><TableCell colSpan={8}><div className="empty-state"><Receipt className="empty-state-icon" /><p className="text-sm">No invoices</p></div></TableCell></TableRow>
            ) : sortedInvoices.map((inv: any) => {
              const locked = isInvoiceLocked(inv.status);
              return (
              <TableRow key={inv.id} className={selectedIds.has(inv.id) ? "bg-muted/40" : "hover:bg-muted/30"}>
                <TableCell><Checkbox checked={selectedIds.has(inv.id)} onCheckedChange={() => toggleOne(inv.id)} /></TableCell>
                <TableCell className="font-mono text-xs font-semibold">
                  <span className="inline-flex items-center gap-1">
                    {inv.invoice_number}
                    {locked && <Lock className="h-3 w-3 text-amber-500" aria-label="Locked" />}
                  </span>
                </TableCell>
                <TableCell className="text-sm">{inv.customers?.name || "—"}</TableCell>
                <TableCell className="text-sm">{inv.sales_agent || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{inv.invoice_date}</TableCell>
                <TableCell><StatusBadge status={inv.status} context="invoice" /></TableCell>
                <TableCell className="text-right text-sm font-medium">{peso(Number(inv.total_amount))}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => openPreview(inv)} title="Preview & Download PDF" className="h-7 w-7 rounded-md"><FileDown className="h-3.5 w-3.5 text-primary" /></Button>
                    {!locked && (
                      <Button variant="ghost" size="icon" onClick={() => openEdit(inv)} title="Edit" className="h-7 w-7 rounded-md"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => setViewInv(inv.id)} className="h-7 w-7 rounded-md"><Eye className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    {inv.status === "draft" && (
                      <>
                        <Button variant="ghost" size="icon" onClick={async () => { if (await confirmStockOrAsk(inv.id, "ship")) confirmMut.mutate(inv.id); }} title="Confirm & Deduct Stock (Mark Shipped)" className="h-7 w-7 rounded-md"><CheckCircle className="h-3.5 w-3.5 text-success" /></Button>
                        <Button variant="ghost" size="icon" onClick={async () => { if (await confirmStockOrAsk(inv.id, "pay")) openPayDialog(inv.id); }} title="Mark as Paid (without shipping)" className="h-7 w-7 rounded-md"><DollarSign className="h-3.5 w-3.5 text-primary" /></Button>
                      </>
                    )}
                    {inv.status === "confirmed" && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => openPayDialog(inv.id)} title="Mark as Paid" className="h-7 w-7 rounded-md"><DollarSign className="h-3.5 w-3.5 text-primary" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => revertMut.mutate(inv.id)} title="Revert to Draft (unlock)" className="h-7 w-7 rounded-md"><Undo2 className="h-3.5 w-3.5 text-amber-500" /></Button>
                      </>
                    )}
                    {(inv.status === "paid" || inv.status === "unpaid") && (
                      <Button variant="ghost" size="icon" onClick={() => revertMut.mutate(inv.id)} title="Revert to Draft (unlock)" className="h-7 w-7 rounded-md"><Undo2 className="h-3.5 w-3.5 text-amber-500" /></Button>
                    )}
                    {isAdmin && !locked && (
                      <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(inv.id)} title="Delete (admin only) — restores stock if previously deducted" className="h-7 w-7 rounded-md"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <DocumentPreview open={previewOpen} onClose={() => setPreviewOpen(false)} data={previewData} />

      <Dialog open={!!payDialog} onOpenChange={(o) => !o && setPayDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Mark Invoice as Paid</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Payment Method</Label>
            <Select value={payMethod} onValueChange={setPayMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Cash">Cash</SelectItem>
                <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                <SelectItem value="GCash">GCash</SelectItem>
                <SelectItem value="Check">Check</SelectItem>
                <SelectItem value="Credit Card">Credit Card</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
            {payMethod !== "Cash" && (
              <>
                <Label>Reference Number</Label>
                <Input value={payReference} onChange={(e) => setPayReference(e.target.value)} placeholder="e.g. transaction ID" />
                <Label>Reference Image (paste or upload)</Label>
                <div onPaste={handlePayPaste} className="border border-dashed rounded-md p-3 text-xs text-muted-foreground" tabIndex={0}>
                  <Input type="file" accept="image/*" onChange={(e) => setPayRefFile(e.target.files?.[0] || null)} />
                  <div className="mt-2">Or click here and paste (Ctrl/Cmd+V) an image.</div>
                  {payRefFile && (
                    <div className="mt-2">
                      <img src={URL.createObjectURL(payRefFile)} alt="preview" className="max-h-32 rounded border" />
                      <Button variant="ghost" size="sm" onClick={() => setPayRefFile(null)} className="mt-1 h-6 text-xs">Remove</Button>
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setPayDialog(null)}>Cancel</Button>
              <Button onClick={submitPayment} disabled={payUploading || markPaidMut.isPending}>{payUploading ? "Uploading..." : "Confirm Payment"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
