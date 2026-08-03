import { useState, useMemo, useRef, useEffect, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getInvoices, createInvoice, deleteInvoice, getCustomers, getItems, createInvoiceItems, getInvoiceItems, confirmInvoice, revertInvoice, updateInvoice, markInvoicePaid, generateInvoiceNumber, deleteInvoiceItems, getSalesAgents, createSalesAgent, getLastSalesAgentForCustomer, reserveInvoice, shipInvoice, cancelInvoice, convertReservedToSale, getInvoiceItemFinancials, getInvoiceFinancial } from "@/lib/api";
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
import { useBranch } from "@/contexts/BranchContext";

interface LineItem { item_id: string; item_name: string; quantity: number | ""; unit_price: number | ""; variation_id: string | null; }

export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { activeBranchId, activeBranch, branches } = useBranch();
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

  const { data: invoices = [] } = useQuery({ queryKey: ["invoices", activeBranchId], queryFn: () => getInvoices(activeBranchId) });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });
  const { data: items = [] } = useQuery({ queryKey: ["items"], queryFn: getItems });
  const { data: invItems = [] } = useQuery({ queryKey: ["invoice_items", viewInv], queryFn: () => getInvoiceItems(viewInv!), enabled: !!viewInv });
  const { data: invItemFinancials = [] } = useQuery({
    queryKey: ["invoice_item_financials", viewInv],
    queryFn: () => getInvoiceItemFinancials(viewInv!),
    enabled: !!viewInv && isAdmin,
  });
  const { data: invFinancial = null } = useQuery({
    queryKey: ["invoice_financial", viewInv],
    queryFn: () => getInvoiceFinancial(viewInv!),
    enabled: !!viewInv && isAdmin,
  });
  const finByItem = useMemo(() => {
    const m = new Map<string, typeof invItemFinancials[number]>();
    for (const f of invItemFinancials) m.set(`${f.item_id}::${f.variation_id || ""}`, f);
    return m;
  }, [invItemFinancials]);
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

  type BulkAction = "reserve" | "pay" | "ship" | "complete" | "cancel";
  const bulkStatusMut = useMutation({
    mutationFn: async (action: BulkAction) => {
      const ids = Array.from(selectedIds);
      let ok = 0, skip = 0, fail = 0;
      const errors: string[] = [];
      for (const id of ids) {
        const inv: any = invoices.find((i: any) => i.id === id);
        if (!inv) { fail++; continue; }
        const s: string = inv.status;
        try {
          if (action === "reserve") {
            if (s === "cancelled" || s === "completed" || s === "reserved") { skip++; continue; }
            await reserveInvoice(id); ok++;
          } else if (action === "pay") {
            if (s === "cancelled" || s === "completed" || s === "paid") { skip++; continue; }
            await markInvoicePaid(id, { payment_method: "Cash", payment_reference: null, payment_reference_url: null });
            ok++;
          } else if (action === "ship") {
            if (s === "cancelled" || s === "completed" || s === "shipped" || s === "confirmed") { skip++; continue; }
            await shipInvoice(id); ok++;
          } else if (action === "complete") {
            // Allowed only when Paid AND Shipped. Single-status model:
            // 'completed' -> skip; 'paid' -> ship (auto-completes); 'shipped'/'confirmed' -> needs payment.
            if (s === "completed") { skip++; continue; }
            if (s === "paid") { await shipInvoice(id); ok++; }
            else { fail++; errors.push(`${inv.invoice_number}: needs both Paid and Shipped`); }
          } else if (action === "cancel") {
            if (s === "cancelled") { skip++; continue; }
            await cancelInvoice(id); ok++;
          }
        } catch (e: any) {
          fail++;
          errors.push(`${inv.invoice_number}: ${e?.message || "failed"}`);
          console.error("Bulk action failed", action, id, e);
        }
      }
      return { ok, skip, fail, action, errors };
    },
    onSuccess: ({ ok, skip, fail, action, errors }) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setSelectedIds(new Set());
      const label: Record<BulkAction, string> = {
        reserve: "Reserve", pay: "Mark Paid", ship: "Mark Shipped", complete: "Mark Completed", cancel: "Cancel",
      };
      const parts: string[] = [];
      if (ok) parts.push(`${ok} updated`);
      if (skip) parts.push(`${skip} skipped`);
      if (fail) parts.push(`${fail} failed`);
      const msg = `${label[action]}: ${parts.join(", ") || "no changes"}`;
      const desc = errors.slice(0, 3).join("\n") || undefined;
      if (fail > 0 && ok === 0) toast.error(msg, { description: desc });
      else if (fail > 0) toast.warning(msg, { description: desc });
      else toast.success(msg);
    },
  });

  const selectionStatusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const id of selectedIds) {
      const inv: any = invoices.find((i: any) => i.id === id);
      if (!inv) continue;
      c[inv.status] = (c[inv.status] || 0) + 1;
    }
    return c;
  }, [selectedIds, invoices]);

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
      // Locked invoices are read-only for line items, but admins can still edit
      // costs from the view dialog. Route them there instead of blocking.
      if (isAdmin) {
        setViewInv(inv.id);
        toast.info("Invoice is locked. Line items are read-only — you can still edit costs here.");
      } else {
        toast.error(INVOICE_LOCK_MESSAGE);
      }
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
      if (!activeBranchId) throw new Error("Select a branch before creating an invoice.");
      const inv = await createInvoice({ invoice_number: await generateInvoiceNumber(), customer_id: form.customer_id || null, notes: form.notes, due_date: form.due_date || null, total_amount: total, sales_agent: form.sales_agent, branch_id: activeBranchId } as any);
      await createInvoiceItems(saved.map(l => ({ invoice_id: inv.id, item_id: l.item_id || null, item_name: l.item_name || null, quantity: Number(l.quantity), unit_price: Number(l.unit_price) || 0, variation_id: l.variation_id || null })));
      return inv;
    },
    onSuccess: (inv: any) => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); setCreateOpen(false); toast.success("Invoice created"); resetForm(); if (inv) openPreview(inv); },
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
  const confirmStockOrAsk = async (invoiceId: string, action: "ship" | "pay", branchId?: string | null): Promise<boolean> => {
    try {
      const lineItems = await getInvoiceItems(invoiceId);
      const shortages = await checkStoreStock(
        lineItems.map((li: any) => ({
          item_id: li.item_id,
          variation_id: li.variation_id || null,
          quantity: li.quantity,
        })),
        branchId ?? activeBranchId ?? null,
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
              {isAdmin && (
                <SelectedInvoiceCostBulkEdit
                  selectedIds={Array.from(selectedIds)}
                  invoices={invoices as any[]}
                  onSuccess={() => queryClient.invalidateQueries({ queryKey: ["invoices"] })}
                />
              )}
              {anySelectedLocked ? (
                <span className="inline-flex items-center gap-1 text-xs text-amber-600 px-2">
                  <Lock className="h-3.5 w-3.5" /> Selection contains locked invoices — status/delete bulk actions disabled
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

      <div className="flex flex-wrap gap-1 rounded-lg border bg-card p-0.5">
        {([
          { key: "all", label: `All (${filtered.length})` },
          { key: "reserved", label: `Reserved (${bucketCounts.reserved})` },
          { key: "not_shipped", label: `Not Shipped (${bucketCounts.not_shipped})` },
          { key: "awaiting_payment", label: `Awaiting Payment (${bucketCounts.awaiting_payment})` },
          { key: "awaiting_shipment", label: `Paid · Pending Ship (${bucketCounts.awaiting_shipment})` },
          { key: "completed", label: `Completed (${bucketCounts.completed})` },
          { key: "cancelled", label: `Cancelled (${bucketCounts.cancelled})` },
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
                  { v: "reserved", l: "Reserved" },
                  { v: "confirmed", l: "Shipped (legacy)" },
                  { v: "shipped", l: "Shipped, not paid" },
                  { v: "paid", l: "Paid, pending ship" },
                  { v: "completed", l: "Completed" },
                  { v: "cancelled", l: "Cancelled" },
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
            <p className="text-xs text-muted-foreground mt-0.5">Excludes reserved &amp; cancelled. Counts shipped, paid, completed.</p>
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
              <TableHeader><TableRow>
                <TableHead className="text-xs">SKU</TableHead>
                <TableHead className="text-xs">Item</TableHead>
                <TableHead className="text-xs">Qty</TableHead>
                <TableHead className="text-xs text-right">Price</TableHead>
                {isAdmin && <TableHead className="text-xs text-right">Cost</TableHead>}
                {isAdmin && <TableHead className="text-xs text-right">Profit</TableHead>}
                <TableHead className="text-xs text-right">Total</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {invItems.map(ii => {
                  const fin = isAdmin ? finByItem.get(`${(ii as any).item_id}::${(ii as any).variation_id || ""}`) : undefined;
                  return (
                    <TableRow key={ii.id}>
                       <TableCell className="font-mono text-xs text-primary font-medium">{(ii as any).item_variations?.sku || ii.items?.sku || "—"}</TableCell>
                       <TableCell className="text-sm font-medium">{(ii as any).item_variations?.name || (ii as any).item_name || ii.items?.name || "—"}</TableCell>
                      <TableCell className="text-sm">{ii.quantity}</TableCell>
                      <TableCell className="text-sm text-right">{peso(Number(ii.unit_price))}</TableCell>
                      {isAdmin && (
                        <TableCell className="text-sm text-right text-muted-foreground">
                          <InvoiceCostCell fin={fin} invoiceId={viewInv!} />
                        </TableCell>
                      )}

                      {isAdmin && (
                        <TableCell className={`text-sm text-right font-medium ${fin && fin.line_profit != null && Number(fin.line_profit) < 0 ? "text-destructive" : "text-success"}`}>
                          {fin && fin.line_profit != null ? peso(Number(fin.line_profit)) : <span className="text-muted-foreground text-xs">N/A</span>}
                        </TableCell>
                      )}
                      <TableCell className="text-sm text-right font-medium">{peso(ii.quantity * Number(ii.unit_price))}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {isAdmin && invFinancial && (
            <div className="mt-3 rounded-lg border bg-primary/5 p-3 space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Financial Summary (Admin only)</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-muted-foreground">Total Sales</div>
                <div className="text-right font-medium tabular-nums">{peso(Number(invFinancial.total_sales))}</div>
                <div className="text-muted-foreground">Total Cost</div>
                <div className="text-right font-medium tabular-nums">{peso(Number(invFinancial.total_cost))}</div>
                <div className="text-muted-foreground">Gross Profit</div>
                <div className={`text-right font-semibold tabular-nums ${Number(invFinancial.total_profit) < 0 ? "text-destructive" : "text-success"}`}>
                  {peso(Number(invFinancial.total_profit))}
                </div>
                <div className="text-muted-foreground">Profit Margin</div>
                <div className={`text-right font-semibold tabular-nums ${Number(invFinancial.profit_margin) < 0 ? "text-destructive" : "text-success"}`}>
                  {Number(invFinancial.profit_margin).toFixed(2)}%
                </div>
              </div>
            </div>
          )}
          {isAdmin && !invFinancial && viewInv && (() => {
            const inv: any = invoices.find((i: any) => i.id === viewInv);
            if (!inv) return null;
            if (inv.status === "paid" || inv.status === "completed") return null;
            return (
              <div className="mt-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Financial summary will appear once this invoice is marked Paid.
              </div>
            );
          })()}
          {isAdmin && viewInv && (
            <InvoiceCostTools
              invoiceId={viewInv}
              fins={invItems.map((ii: any) => finByItem.get(`${ii.item_id}::${ii.variation_id || ""}`)).filter(Boolean)}
              invoiceNumber={(invoices.find((i: any) => i.id === viewInv) as any)?.invoice_number}
            />
          )}

        </DialogContent>
      </Dialog>

      <div className="data-table-wrapper">
        {selectedIds.size > 0 && (
          <div className="sticky top-2 z-20 mx-2 my-2 flex flex-wrap items-center gap-2 rounded-lg border bg-card/95 backdrop-blur px-3 py-2 shadow-md">
            <div className="flex items-center gap-2 mr-2">
              <span className="text-sm font-semibold">{selectedIds.size} selected</span>
              <div className="flex flex-wrap gap-1">
                {Object.entries(selectionStatusCounts).map(([s, n]) => (
                  <span key={s} className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px]">
                    <StatusBadge status={s} context="invoice" />
                    <span className="font-mono text-muted-foreground">×{n}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-1 ml-auto">
              {isAdmin && (
                <SelectedInvoiceCostBulkEdit
                  selectedIds={Array.from(selectedIds)}
                  invoices={invoices as any[]}
                  onSuccess={() => queryClient.invalidateQueries({ queryKey: ["invoices"] })}
                  trigger={
                    <Button size="sm" variant="outline" className="h-8" disabled={selectedIds.size === 0}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Bulk Edit Costs
                    </Button>
                  }
                />
              )}
              <Button size="sm" variant="outline" className="h-8" disabled={bulkStatusMut.isPending} onClick={() => bulkStatusMut.mutate("reserve")}>
                <BookmarkPlus className="h-3.5 w-3.5 mr-1 text-amber-600" /> Reserve
              </Button>
              <Button size="sm" variant="outline" className="h-8" disabled={bulkStatusMut.isPending} onClick={() => bulkStatusMut.mutate("pay")}>
                <DollarSign className="h-3.5 w-3.5 mr-1 text-primary" /> Paid
              </Button>
              <Button size="sm" variant="outline" className="h-8" disabled={bulkStatusMut.isPending} onClick={() => bulkStatusMut.mutate("ship")}>
                <Truck className="h-3.5 w-3.5 mr-1 text-success" /> Shipped
              </Button>
              <Button size="sm" variant="outline" className="h-8" disabled={bulkStatusMut.isPending} onClick={() => bulkStatusMut.mutate("complete")}>
                <CheckCircle className="h-3.5 w-3.5 mr-1 text-success" /> Completed
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={bulkStatusMut.isPending}
                onClick={() => {
                  if (window.confirm(`Cancel ${selectedIds.size} selected order(s)? Reserved stock will be returned to inventory.`)) {
                    bulkStatusMut.mutate("cancel");
                  }
                }}
              >
                <XCircle className="h-3.5 w-3.5 mr-1 text-destructive" /> Cancel
              </Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={() => setSelectedIds(new Set())}>Clear</Button>
            </div>
          </div>
        )}

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
                    {(!locked || isAdmin) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(inv)}
                        title={locked ? "Locked — admins can still edit costs" : "Edit"}
                        className="h-7 w-7 rounded-md"
                      >
                        <Pencil className={`h-3.5 w-3.5 ${locked ? "text-amber-500" : "text-muted-foreground"}`} />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => setViewInv(inv.id)} className="h-7 w-7 rounded-md"><Eye className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    {inv.status === "draft" && (
                      <>
                        <Button variant="ghost" size="icon" onClick={async () => { if (await confirmStockOrAsk(inv.id, "ship", inv.branch_id)) reserveMut.mutate(inv.id); }} title="Reserve order (allocate stock, not yet paid/shipped)" className="h-7 w-7 rounded-md"><BookmarkPlus className="h-3.5 w-3.5 text-amber-600" /></Button>
                        <Button variant="ghost" size="icon" onClick={async () => { if (await confirmStockOrAsk(inv.id, "ship", inv.branch_id)) shipMut.mutate(inv.id); }} title="Mark Shipped & Deduct Stock" className="h-7 w-7 rounded-md"><Truck className="h-3.5 w-3.5 text-success" /></Button>
                        <Button variant="ghost" size="icon" onClick={async () => { if (await confirmStockOrAsk(inv.id, "pay", inv.branch_id)) openPayDialog(inv.id); }} title="Mark as Paid (without shipping)" className="h-7 w-7 rounded-md"><DollarSign className="h-3.5 w-3.5 text-primary" /></Button>
                      </>
                    )}
                    {inv.status === "reserved" && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => convertMut.mutate(inv.id)} title="Convert to open sales order" className="h-7 w-7 rounded-md"><ArrowRightCircle className="h-3.5 w-3.5 text-primary" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => shipMut.mutate(inv.id)} title="Mark as Shipped / Picked Up" className="h-7 w-7 rounded-md"><Truck className="h-3.5 w-3.5 text-success" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => openPayDialog(inv.id)} title="Mark as Paid" className="h-7 w-7 rounded-md"><DollarSign className="h-3.5 w-3.5 text-primary" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => { if (window.confirm("Recall this reserved order? It will return to Draft and allocated stock will be restored to inventory.")) revertMut.mutate(inv.id); }} title="Recall reservation (return to draft, restore stock)" className="h-7 w-7 rounded-md"><Undo2 className="h-3.5 w-3.5 text-amber-500" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => { if (window.confirm("Cancel this reserved order? Allocated stock will be returned to inventory and the order will be marked Cancelled.")) cancelMut.mutate(inv.id); }} title="Cancel reservation & restore stock" className="h-7 w-7 rounded-md"><XCircle className="h-3.5 w-3.5 text-destructive" /></Button>
                      </>
                    )}
                    {inv.status === "confirmed" && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => openPayDialog(inv.id)} title="Mark as Paid" className="h-7 w-7 rounded-md"><DollarSign className="h-3.5 w-3.5 text-primary" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => revertMut.mutate(inv.id)} title="Revert to Draft (unlock)" className="h-7 w-7 rounded-md"><Undo2 className="h-3.5 w-3.5 text-amber-500" /></Button>
                      </>
                    )}
                    {inv.status === "shipped" && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => openPayDialog(inv.id)} title="Mark as Paid (auto-completes order)" className="h-7 w-7 rounded-md"><DollarSign className="h-3.5 w-3.5 text-primary" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => revertMut.mutate(inv.id)} title="Revert to Draft (unlock)" className="h-7 w-7 rounded-md"><Undo2 className="h-3.5 w-3.5 text-amber-500" /></Button>
                      </>
                    )}
                    {inv.status === "paid" && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => shipMut.mutate(inv.id)} title="Mark as Shipped / Picked Up (auto-completes order)" className="h-7 w-7 rounded-md"><Truck className="h-3.5 w-3.5 text-success" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => revertMut.mutate(inv.id)} title="Revert to Draft (unlock)" className="h-7 w-7 rounded-md"><Undo2 className="h-3.5 w-3.5 text-amber-500" /></Button>
                      </>
                    )}
                    {(inv.status === "unpaid" || inv.status === "completed" || inv.status === "cancelled") && (
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

function invalidateCostQueries(qc: ReturnType<typeof useQueryClient>, invoiceId: string) {
  qc.invalidateQueries({ queryKey: ["invoice_item_financials", invoiceId] });
  qc.invalidateQueries({ queryKey: ["invoice_financial", invoiceId] });
  // Business Insights caches
  qc.invalidateQueries({ queryKey: ["bi_financials"] });
  qc.invalidateQueries({ queryKey: ["bi_invoice"] });
  qc.invalidateQueries({ queryKey: ["bi_online"] });
  qc.invalidateQueries({ queryKey: ["invoice_cost_history"] });
}

function SelectedInvoiceCostBulkEdit({
  selectedIds,
  invoices,
  onSuccess,
  trigger,
}: {
  selectedIds: string[];
  invoices: any[];
  onSuccess?: () => void;
  trigger?: ReactNode;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [uniformCost, setUniformCost] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: fins = [], isFetching } = useQuery({
    queryKey: ["selected_invoice_costs", selectedIds],
    queryFn: async () => {
      if (selectedIds.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from("invoice_item_financials")
        .select("*")
        .in("invoice_id", selectedIds)
        .order("invoice_id", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: open && selectedIds.length > 0,
  });

  const { data: lineNames = [] } = useQuery({
    queryKey: ["selected_invoice_cost_names", selectedIds],
    queryFn: async () => {
      if (selectedIds.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from("invoice_items")
        .select("invoice_id,item_id,variation_id,item_name,items(name,sku),item_variations(name,sku)")
        .in("invoice_id", selectedIds);
      if (error) return [];
      return (data || []) as any[];
    },
    enabled: open && selectedIds.length > 0,
  });

  const invoiceById = useMemo(() => {
    const m = new Map<string, any>();
    for (const inv of invoices) m.set(inv.id, inv);
    return m;
  }, [invoices]);

  const lineNameByKey = useMemo(() => {
    const m = new Map<string, any>();
    for (const li of lineNames) m.set(`${li.invoice_id}::${li.item_id || ""}::${li.variation_id || ""}`, li);
    return m;
  }, [lineNames]);

  useEffect(() => {
    if (!open) return;
    const init: Record<string, string> = {};
    for (const f of fins) init[f.id] = f.cost_snapshot != null ? String(f.cost_snapshot) : "";
    setRows(init);
  }, [open, fins]);

  const openBulk = () => {
    setReason("");
    setUniformCost("");
    setConfirming(false);
    setOpen(true);
  };

  const applyUniform = () => {
    const n = parseFloat(uniformCost);
    if (!Number.isFinite(n) || n < 0) { toast.error("Enter a valid uniform cost"); return; }
    const next: Record<string, string> = {};
    for (const f of fins) next[f.id] = String(n);
    setRows(next);
  };

  const submitBulk = async () => {
    setSaving(true);
    let ok = 0, fail = 0;
    const touchedInvoiceIds = new Set<string>();
    for (const f of fins) {
      const raw = rows[f.id];
      if (raw === "" || raw == null) continue;
      const n = parseFloat(raw);
      if (!Number.isFinite(n) || n < 0) { fail++; continue; }
      const prev = f.cost_snapshot != null ? Number(f.cost_snapshot) : null;
      if (prev != null && Math.abs(prev - n) < 0.0001) continue;
      const { error } = await (supabase as any).rpc("set_invoice_item_cost", {
        _financial_id: f.id,
        _new_cost: n,
        _reason: reason || null,
      });
      if (error) {
        fail++;
        console.error("Selected invoice cost update failed", error);
      } else {
        ok++;
        touchedInvoiceIds.add(f.invoice_id);
      }
    }
    setSaving(false);
    if (ok > 0) toast.success(`Updated ${ok} line cost${ok === 1 ? "" : "s"}${fail ? ` (${fail} failed)` : ""}`);
    else if (fail > 0) toast.error(`All ${fail} updates failed`);
    else toast.info("No changes to apply");
    if (ok > 0) {
      setOpen(false);
      for (const invoiceId of touchedInvoiceIds) invalidateCostQueries(qc, invoiceId);
      qc.invalidateQueries({ queryKey: ["selected_invoice_costs"] });
      onSuccess?.();
    }
  };

  return (
    <>
      <span onClick={openBulk}>
        {trigger ?? (
          <Button variant="outline" size="sm" disabled={selectedIds.length === 0}>
            <Pencil className="h-4 w-4 mr-1" /> Bulk Edit Costs
          </Button>
        )}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-base">Bulk Edit Costs — {selectedIds.length} selected invoices</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2.5 text-xs text-amber-900 dark:text-amber-200">
              Cost edits are allowed for locked invoices. Invoice totals, selling prices, payment status, and inventory quantities will not change.
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs">Set same cost for all selected lines</Label>
                <Input type="number" step="0.01" value={uniformCost} onChange={e => setUniformCost(e.target.value)} className="h-9" placeholder="Optional" />
              </div>
              <Button size="sm" variant="outline" className="h-9" onClick={applyUniform} disabled={fins.length === 0}>Apply</Button>
            </div>
            <div className="rounded-md border divide-y">
              {isFetching ? (
                <div className="p-4 text-center text-xs text-muted-foreground">Loading line costs...</div>
              ) : fins.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">No cost records found for the selected invoices.</div>
              ) : fins.map((f: any) => {
                const inv = invoiceById.get(f.invoice_id);
                const li = lineNameByKey.get(`${f.invoice_id}::${f.item_id || ""}::${f.variation_id || ""}`);
                const itemName = li?.item_variations?.name || li?.item_name || li?.items?.name || "Item";
                const sku = li?.item_variations?.sku || li?.items?.sku;
                return (
                  <div key={f.id} className="p-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{inv?.invoice_number || "Invoice"} · {itemName}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {sku ? `${sku} · ` : ""}Qty {Number(f.quantity || 0)} · Prev {f.cost_snapshot != null ? peso(Number(f.cost_snapshot)) : "—"}
                      </div>
                    </div>
                    <Input
                      type="number"
                      step="0.01"
                      value={rows[f.id] ?? ""}
                      onChange={e => setRows(r => ({ ...r, [f.id]: e.target.value }))}
                      className="h-8 w-28 text-right text-xs"
                      placeholder="Cost"
                    />
                  </div>
                );
              })}
            </div>
            <div>
              <Label className="text-xs">Reason (optional)</Label>
              <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} className="resize-none" placeholder="e.g. supplier invoice correction" />
            </div>
            {!confirming ? (
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={() => setConfirming(true)} disabled={fins.length === 0}>Continue</Button>
              </div>
            ) : (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2.5 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                <p>Confirm cost-only update for selected line items. This recalculates Gross Profit and Business Insights only.</p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={saving}>Back</Button>
                  <Button size="sm" onClick={submitBulk} disabled={saving}>{saving ? "Saving..." : "Confirm Costs"}</Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InvoiceCostCell({ fin, invoiceId }: { fin: any; invoiceId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState<string>(fin?.cost_snapshot != null ? String(fin.cost_snapshot) : "");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!fin) {
    return <span className="text-amber-600 dark:text-amber-400 text-xs">No line record</span>;
  }

  const openEdit = () => {
    setVal(fin.cost_snapshot != null ? String(fin.cost_snapshot) : "");
    setReason("");
    setConfirming(false);
    setOpen(true);
  };

  const submit = async () => {
    const n = parseFloat(val);
    if (!Number.isFinite(n) || n < 0) { toast.error("Enter a valid cost"); return; }
    setSaving(true);
    const { error } = await (supabase as any).rpc("set_invoice_item_cost", {
      _financial_id: fin.id,
      _new_cost: n,
      _reason: reason || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Cost updated");
    setOpen(false);
    invalidateCostQueries(qc, invoiceId);
  };

  return (
    <>
      <button
        type="button"
        onClick={openEdit}
        className="inline-flex items-center gap-1 hover:text-foreground group"
        title="Click to edit cost (admin)"
      >
        {fin.cost_snapshot != null
          ? peso(Number(fin.cost_snapshot))
          : <span className="text-amber-600 dark:text-amber-400 text-xs">Cost not set</span>}
        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-base">Edit Line Cost</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <Label className="text-xs">New Cost (per unit)</Label>
              <Input type="number" step="0.01" value={val} onChange={e => setVal(e.target.value)} className="h-9" autoFocus />
              {fin.cost_snapshot != null && (
                <p className="text-[11px] text-muted-foreground mt-1">Previous: {peso(Number(fin.cost_snapshot))}</p>
              )}
            </div>
            <div>
              <Label className="text-xs">Reason (optional)</Label>
              <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. supplier invoice correction" className="resize-none" />
            </div>
            {!confirming ? (
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={() => setConfirming(true)}>Continue</Button>
              </div>
            ) : (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2.5 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                <p>Updating costs will recalculate Gross Profit and Business Insights. Invoice totals and payments will remain unchanged.</p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={saving}>Back</Button>
                  <Button size="sm" onClick={submit} disabled={saving}>{saving ? "Saving..." : "Confirm"}</Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function InvoiceCostTools({ invoiceId, fins, invoiceNumber }: { invoiceId: string; fins: any[]; invoiceNumber?: string }) {
  const qc = useQueryClient();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uniformCost, setUniformCost] = useState("");

  const openBulk = () => {
    const init: Record<string, string> = {};
    for (const f of fins) init[f.id] = f.cost_snapshot != null ? String(f.cost_snapshot) : "";
    setRows(init);
    setReason("");
    setUniformCost("");
    setConfirming(false);
    setBulkOpen(true);
  };

  const applyUniform = () => {
    const n = parseFloat(uniformCost);
    if (!Number.isFinite(n) || n < 0) { toast.error("Enter a valid uniform cost"); return; }
    const next: Record<string, string> = {};
    for (const f of fins) next[f.id] = String(n);
    setRows(next);
  };

  const submitBulk = async () => {
    setSaving(true);
    let ok = 0, fail = 0;
    for (const f of fins) {
      const raw = rows[f.id];
      if (raw === "" || raw == null) continue;
      const n = parseFloat(raw);
      if (!Number.isFinite(n) || n < 0) { fail++; continue; }
      const prev = f.cost_snapshot != null ? Number(f.cost_snapshot) : null;
      if (prev != null && Math.abs(prev - n) < 0.0001) continue;
      const { error } = await (supabase as any).rpc("set_invoice_item_cost", {
        _financial_id: f.id,
        _new_cost: n,
        _reason: reason || null,
      });
      if (error) { fail++; console.error(error); } else { ok++; }
    }
    setSaving(false);
    if (ok > 0) toast.success(`Updated ${ok} line${ok === 1 ? "" : "s"}${fail ? ` (${fail} failed)` : ""}`);
    else if (fail > 0) toast.error(`All ${fail} updates failed`);
    else toast.info("No changes to apply");
    if (ok > 0) {
      setBulkOpen(false);
      invalidateCostQueries(qc, invoiceId);
    }
  };

  const { data: history = [] } = useQuery({
    queryKey: ["invoice_cost_history", invoiceId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("invoice_item_cost_history")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: historyOpen,
  });

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      <Button size="sm" variant="outline" className="h-8" onClick={openBulk} disabled={fins.length === 0}>
        <Pencil className="h-3.5 w-3.5 mr-1" /> Bulk Edit Costs
      </Button>
      <Button size="sm" variant="ghost" className="h-8" onClick={() => setHistoryOpen(true)}>
        Cost History
      </Button>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-base">Bulk Edit Line Costs {invoiceNumber ? `— ${invoiceNumber}` : ""}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs">Set same cost for all lines</Label>
                <Input type="number" step="0.01" value={uniformCost} onChange={e => setUniformCost(e.target.value)} className="h-9" placeholder="Optional" />
              </div>
              <Button size="sm" variant="outline" className="h-9" onClick={applyUniform}>Apply</Button>
            </div>
            <div className="rounded-md border divide-y">
              {fins.map((f: any) => (
                <div key={f.id} className="p-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{f.item_variations?.name || f.items?.name || "Item"}</div>
                    <div className="text-[10px] text-muted-foreground">
                      Qty {Number(f.quantity || 0)} · Prev {f.cost_snapshot != null ? peso(Number(f.cost_snapshot)) : "—"}
                    </div>
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    value={rows[f.id] ?? ""}
                    onChange={e => setRows(r => ({ ...r, [f.id]: e.target.value }))}
                    className="h-8 w-28 text-right text-xs"
                    placeholder="Cost"
                  />
                </div>
              ))}
            </div>
            <div>
              <Label className="text-xs">Reason (optional)</Label>
              <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} className="resize-none" />
            </div>
            {!confirming ? (
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setBulkOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={() => setConfirming(true)}>Continue</Button>
              </div>
            ) : (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2.5 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                <p>Updating costs will recalculate Gross Profit and Business Insights. Invoice totals and payments will remain unchanged.</p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={saving}>Back</Button>
                  <Button size="sm" onClick={submitBulk} disabled={saving}>{saving ? "Saving..." : "Confirm All"}</Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-base">Cost Change History {invoiceNumber ? `— ${invoiceNumber}` : ""}</DialogTitle></DialogHeader>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No cost changes recorded.</p>
          ) : (
            <div className="data-table-wrapper">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-xs">When</TableHead>
                  <TableHead className="text-xs">Item</TableHead>
                  <TableHead className="text-xs text-right">Previous</TableHead>
                  <TableHead className="text-xs text-right">New</TableHead>
                  <TableHead className="text-xs">User</TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {history.map((h: any) => (
                    <TableRow key={h.id}>
                      <TableCell className="text-xs whitespace-nowrap">{format(new Date(h.created_at), "MMM d, yyyy HH:mm")}</TableCell>
                      <TableCell className="text-xs">{h.item_name || "—"}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">{h.previous_cost != null ? peso(Number(h.previous_cost)) : "—"}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums font-medium">{peso(Number(h.new_cost))}</TableCell>
                      <TableCell className="text-xs">{h.changed_by_email || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{h.reason || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

