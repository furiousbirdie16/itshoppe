import { useState, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getOnlineSales, createOnlineSale, updateOnlineSale, deleteOnlineSale, returnOnlineSale, generateShopeeOrderNumber, generateLazadaOrderNumber, getItems, getItemVariations } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, Upload, FileSpreadsheet, Check, AlertCircle, Search, Undo2, XCircle, Filter, ChevronRight, ChevronDown, X, DollarSign, CircleDollarSign } from "lucide-react";
import ExportButton from "@/components/ExportButton";
import { toast } from "sonner";
import { peso } from "@/lib/currency";
import type { OnlineSale } from "@/types/database";
import { ItemSearch } from "@/components/ItemSearch";
import * as XLSX from "xlsx";
import { useAuth } from "@/contexts/AuthContext";
import { BulkEditDialog, type BulkField } from "@/components/BulkEditDialog";
import { DateField } from "@/components/DateField";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";

type SalesChannel = "shopee" | "lazada" | "others";

type BulkCell = string | number | Date | boolean | null | undefined;

interface SaleLine {
  product_name: string;
  quantity: number;
  posted_price: number;
  item_id: string;
  variation_id: string | null;
}

interface SaleForm {
  order_date: string;
  order_number: string;
  sales_channel: SalesChannel;
  notes: string;
  lines: SaleLine[];
}

const emptyLine: SaleLine = {
  product_name: "",
  quantity: 1,
  posted_price: 0,
  item_id: "",
  variation_id: null,
};

const emptyForm: SaleForm = {
  order_date: new Date().toISOString().split("T")[0],
  order_number: "",
  sales_channel: "shopee",
  notes: "",
  lines: [{ ...emptyLine }],
};

const generateOrderNumber = async (channel: SalesChannel) => {
  if (channel === "shopee") return generateShopeeOrderNumber();
  if (channel === "lazada") return generateLazadaOrderNumber();
  return `OTH-${Date.now().toString(36).toUpperCase()}`;
};

const bulkColumnKeywords = {
  product: ["product", "item", "name"],
  channel: ["channel", "platform", "store", "marketplace", "shopee", "lazada"],
  price: ["price", "amount", "selling", "srp", "posted"],
  date: ["date", "created"],
  quantity: ["qty", "quantity", "pieces", "pcs"],
  orderId: ["order id", "order_id", "orderid", "order no", "order number", "order"],
};

const normalizeBulkCell = (value: BulkCell) => String(value ?? "").trim();

const parseBulkNumber = (value: BulkCell, fallback: number) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const normalized = normalizeBulkCell(value).replace(/,/g, "").replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const matchBulkColumnIndex = (row: BulkCell[], keywords: string[]) => row.findIndex((cell) => {
  const normalized = normalizeBulkCell(cell).toLowerCase();
  return normalized && keywords.some((keyword) => normalized.includes(keyword));
});

const resolveBulkColumns = (rows: BulkCell[][]) => {
  const headerRow = rows[0] ?? [];
  const headerIndexes = {
    product: matchBulkColumnIndex(headerRow, bulkColumnKeywords.product),
    channel: matchBulkColumnIndex(headerRow, bulkColumnKeywords.channel),
    price: matchBulkColumnIndex(headerRow, bulkColumnKeywords.price),
    date: matchBulkColumnIndex(headerRow, bulkColumnKeywords.date),
    quantity: matchBulkColumnIndex(headerRow, bulkColumnKeywords.quantity),
    orderId: matchBulkColumnIndex(headerRow, bulkColumnKeywords.orderId),
  };

  const headerScore = Object.values(headerIndexes).filter((index) => index >= 0).length;
  if (headerScore >= 2 || headerIndexes.product >= 0) {
    return { indexes: headerIndexes, dataRows: rows.slice(1) };
  }

  if (headerRow.length >= 6) {
    return {
      indexes: { product: 2, channel: 4, price: 5, date: 0, quantity: 3, orderId: 1 },
      dataRows: rows,
    };
  }

  return null;
};

export default function OnlineSalesPage() {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { data: sales = [], isLoading } = useQuery({ queryKey: ["online_sales"], queryFn: getOnlineSales });
  const { data: items = [] } = useQuery({ queryKey: ["items"], queryFn: getItems });
  const { data: variations = [] } = useQuery({ queryKey: ["item_variations"], queryFn: () => getItemVariations() });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<OnlineSale | null>(null);
  const [form, setForm] = useState<SaleForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState("completed");

  // Filters (Quotations-style panel)
  const [showFilters, setShowFilters] = useState(false);
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterChannel, setFilterChannel] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const clearFilters = () => { setFilterDateFrom(""); setFilterDateTo(""); setFilterChannel("all"); setFilterStatus("all"); setFilter(""); };

  // Bulk upload state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<{ product_name: string; quantity: number; sales_channel: SalesChannel; posted_price: number; order_date: string; order_id: string; item_id: string | null; variation_id: string | null; valid: boolean; error?: string }[]>([]);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkFileName, setBulkFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Payment marking state
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<{ ids: string[]; orderNumber: string; expected: number } | null>(null);
  const [payAmount, setPayAmount] = useState("");

  // Bulk payment upload state
  const [bulkPayOpen, setBulkPayOpen] = useState(false);
  const [bulkPayRows, setBulkPayRows] = useState<{ order_id: string; amount_paid: number; matched_ids: string[]; expected: number; valid: boolean; error?: string }[]>([]);
  const [bulkPayUploading, setBulkPayUploading] = useState(false);
  const [bulkPayFileName, setBulkPayFileName] = useState("");
  const payFileRef = useRef<HTMLInputElement>(null);

  const deleteMut = useMutation({ mutationFn: deleteOnlineSale, onSuccess: () => { qc.invalidateQueries({ queryKey: ["online_sales"] }); qc.invalidateQueries({ queryKey: ["items"] }); toast.success("Deleted"); } });
  const returnMut = useMutation({ mutationFn: ({ id, status }: { id: string; status: 'returned' | 'cancelled' }) => returnOnlineSale(id, status), onSuccess: () => { qc.invalidateQueries({ queryKey: ["online_sales"] }); qc.invalidateQueries({ queryKey: ["items"] }); } });

  const openNew = () => { setEditingSale(null); setForm({ ...emptyForm, lines: [{ ...emptyLine }] }); setDialogOpen(true); };
  const openEdit = (s: OnlineSale) => {
    setEditingSale(s);
    setForm({
      order_date: s.order_date,
      order_number: s.order_number,
      sales_channel: s.sales_channel,
      notes: s.notes || "",
      lines: [{
        product_name: s.product_name,
        quantity: s.quantity || 1,
        posted_price: s.posted_price,
        item_id: s.item_id || "",
        variation_id: (s as any).variation_id || null,
      }],
    });
    setDialogOpen(true);
  };

  const handleReturn = async (id: string, status: 'returned' | 'cancelled') => {
    try {
      await returnMut.mutateAsync({ id, status });
      toast.success(status === 'returned' ? 'Order marked as returned — inventory restored' : 'Order cancelled — inventory restored');
    } catch (e: any) {
      toast.error(e.message || 'Failed');
    }
  };

  const handleSave = async () => {
    const cleanLines = form.lines.filter(l => l.product_name.trim());
    if (cleanLines.length === 0) { toast.error("Add at least one item with a product name"); return; }
    setSaving(true);
    try {
      if (editingSale) {
        // Edit mode = single line only
        const line = cleanLines[0];
        await updateOnlineSale(editingSale.id, {
          order_date: form.order_date,
          product_name: line.product_name,
          quantity: line.quantity,
          sales_channel: form.sales_channel,
          posted_price: line.posted_price,
          deal_price: 0,
          notes: form.notes,
          item_id: line.item_id || null,
          variation_id: line.variation_id || null,
        } as any);
        toast.success("Updated");
      } else {
        const orderNumber = form.order_number.trim() || await generateOrderNumber(form.sales_channel);
        for (const line of cleanLines) {
          await createOnlineSale({
            order_number: orderNumber,
            order_date: form.order_date,
            product_name: line.product_name,
            quantity: line.quantity,
            sales_channel: form.sales_channel,
            posted_price: line.posted_price,
            deal_price: 0,
            notes: form.notes,
            item_id: line.item_id || null,
            variation_id: line.variation_id || null,
          });
        }
        toast.success(cleanLines.length > 1 ? `Created order with ${cleanLines.length} items` : "Created");
      }
      qc.invalidateQueries({ queryKey: ["online_sales"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      setDialogOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Failed");
    }
    setSaving(false);
  };

  // Filter by tab + search + advanced filters
  const filtered = sales.filter((s: any) => {
    const status = s.status || 'completed';
    if (activeTab === 'completed' && status !== 'completed') return false;
    if (activeTab === 'returns' && status !== 'returned' && status !== 'cancelled') return false;
    if (filterDateFrom && (s.order_date || "") < filterDateFrom) return false;
    if (filterDateTo && (s.order_date || "") > filterDateTo) return false;
    if (filterChannel !== "all" && s.sales_channel !== filterChannel) return false;
    if (filterStatus !== "all" && status !== filterStatus) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return s.product_name?.toLowerCase().includes(q) || s.order_number?.toLowerCase().includes(q);
  });

  const { sort, toggle, sorted: sortedFiltered } = useSort<any>(filtered, {
    order_date: (r) => r.order_date,
    order_number: (r) => r.order_number,
    product_name: (r) => r.product_name,
    quantity: (r) => Number(r.quantity || 1),
    sales_channel: (r) => r.sales_channel,
    posted_price: (r) => Number(r.posted_price),
    status: (r) => r.status || "completed",
  });

  // Group by Order ID for display. Preserves sort order based on first occurrence.
  const groupedFiltered = useMemo(() => {
    const map = new Map<string, any[]>();
    const order: string[] = [];
    for (const s of sortedFiltered) {
      const key = s.order_number || `__no_id_${s.id}`;
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key)!.push(s);
    }
    return order.map(key => ({ orderNumber: map.get(key)![0].order_number, items: map.get(key)! }));
  }, [sortedFiltered]);

  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const toggleExpand = (key: string) => setExpandedOrders(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Admin-only total: sum of completed sales (deal_price preferred, else posted_price) in current filter
  const totalSales = useMemo(() => {
    return filtered
      .filter((s: any) => (s.status || "completed") === "completed")
      .reduce((sum: number, s: any) => {
        const price = Number(s.deal_price) > 0 ? Number(s.deal_price) : Number(s.posted_price || 0);
        const qty = Number(s.quantity || 1);
        return sum + price * qty;
      }, 0);
  }, [filtered]);

  const allSelected = filtered.length > 0 && filtered.every((s: any) => selected.has(s.id));
  const toggleSelectAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((s: any) => s.id)));
  };
  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    setBulkDeleting(true);
    let success = 0;
    for (const id of selected) {
      try { await deleteOnlineSale(id); success++; } catch { /* skip */ }
    }
    setBulkDeleting(false);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["online_sales"] });
    qc.invalidateQueries({ queryKey: ["items"] });
    toast.success(`Deleted ${success} records`);
  };

  // Bulk upload
  const handleBulkFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        // IMPORTANT: do NOT use cellDates — it converts Excel serials into JS Date
        // objects in local time, which causes -1 day shifts depending on timezone.
        // Using raw:false returns the formatted display string (e.g. "4/21/26"),
        // which we parse explicitly below as-is, ignoring any timezone.
        const wb = XLSX.read(evt.target?.result, { type: "array", cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const sheetRows = XLSX.utils.sheet_to_json<BulkCell[]>(ws, { header: 1, defval: "", raw: false, blankrows: false })
          .filter((row) => row.some((cell) => normalizeBulkCell(cell) !== ""));
        if (sheetRows.length === 0) { toast.error("File is empty"); return; }

        const resolvedColumns = resolveBulkColumns(sheetRows);
        if (!resolvedColumns || resolvedColumns.indexes.product < 0) {
          toast.error("Could not detect the product column");
          return;
        }

        const pad = (n: number) => String(n).padStart(2, "0");
        const fmtLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const fmtUTC = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
        const today = fmtLocal(new Date());
        const parseDate = (v: unknown): string => {
          if (!v) return today;
          // xlsx with cellDates:true returns a Date whose UTC components hold the
          // sheet's date. Reading local components causes a -1 day shift in
          // negative-UTC zones; reading UTC components is always correct.
          if (v instanceof Date) {
            if (isNaN(v.getTime())) return today;
            return fmtUTC(v);
          }
          if (typeof v === "number") {
            // Excel serial date → date parts (avoid timezone drift)
            const totalDays = Math.floor(v);
            // Excel epoch 1899-12-30 in UTC, then read UTC parts
            const utc = new Date(Date.UTC(1899, 11, 30) + totalDays * 86400000);
            if (isNaN(utc.getTime())) return today;
            return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
          }
          const s = String(v).trim();
          if (!s) return today;
          // ISO YYYY-MM-DD already
          const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
          if (iso) return `${iso[1]}-${pad(+iso[2])}-${pad(+iso[3])}`;
          // M/D/YY or M/D/YYYY (also handles D/M with slash; default to MM/DD/YYYY which matches Excel US locale exports)
          const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
          if (slash) {
            let [, a, b, y] = slash;
            let yr = parseInt(y);
            if (yr < 100) yr += 2000;
            // Treat as M/D/Y (most common Excel export)
            const m = parseInt(a);
            const d = parseInt(b);
            if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
              return `${yr}-${pad(m)}-${pad(d)}`;
            }
          }
          const d = new Date(s);
          if (!isNaN(d.getTime())) return fmtLocal(d);
          return today;
        };

        const { indexes, dataRows } = resolvedColumns;
        const parsed = dataRows.map((row) => {
          const product_name = normalizeBulkCell(row[indexes.product]);
          const rawChannel = normalizeBulkCell(indexes.channel >= 0 ? row[indexes.channel] : "shopee").toLowerCase();
          const sales_channel: SalesChannel = rawChannel.includes("lazada") ? "lazada" : rawChannel.includes("shopee") ? "shopee" : "others";
          const posted_price = parseBulkNumber(indexes.price >= 0 ? row[indexes.price] : 0, 0);
          const quantity = parseBulkNumber(indexes.quantity >= 0 ? row[indexes.quantity] : 1, 1) || 1;
          const order_date = parseDate(indexes.date >= 0 ? row[indexes.date] : null);
          const order_id = normalizeBulkCell(indexes.orderId >= 0 ? row[indexes.orderId] : "");

          // Strict SKU match — try parent item SKU first, then variation SKU
          const skuLower = product_name.toLowerCase();
          const matchedItem = items.find(i => i.sku.toLowerCase() === skuLower);
          const matchedVariation = !matchedItem
            ? variations.find(v => (v.sku || "").toLowerCase() === skuLower)
            : null;
          const resolvedItemId = matchedItem?.id || matchedVariation?.item_id || null;
          const resolvedVariationId = matchedVariation?.id || null;

          let error: string | undefined;
          if (!product_name) error = "Missing SKU";
          else if (!resolvedItemId) error = `SKU "${product_name}" not found in inventory`;
          else if (posted_price < 0) error = "Negative price";

          return { product_name, quantity, sales_channel, posted_price, order_date, order_id, item_id: resolvedItemId, variation_id: resolvedVariationId, valid: !error, error };
        });
        setBulkRows(parsed);
      } catch (err) {
        console.error("Bulk parse error", err);
        toast.error("Failed to parse file");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const handleBulkUpload = async () => {
    const valid = bulkRows.filter(r => r.valid);
    if (valid.length === 0) return;
    setBulkUploading(true);
    let success = 0;
    let failed = 0;
    let lastError = "";
    for (const row of valid) {
      try {
        const orderNumber = row.order_id || await generateOrderNumber(row.sales_channel);
        await createOnlineSale({ order_number: orderNumber, product_name: row.product_name, quantity: row.quantity, sales_channel: row.sales_channel, posted_price: row.posted_price, deal_price: 0, order_date: row.order_date, item_id: row.item_id, variation_id: row.variation_id, notes: "" });
        success++;
      } catch (e: any) {
        failed++;
        lastError = e?.message || String(e);
        console.error("Bulk row failed:", row, e);
      }
    }
    setBulkUploading(false);
    if (success > 0) toast.success(`Uploaded ${success} sales records${failed ? ` (${failed} failed)` : ""}`);
    if (success === 0 && failed > 0) toast.error(`All ${failed} rows failed: ${lastError}`);
    if (success > 0) {
      setBulkRows([]);
      setBulkFileName("");
      setBulkOpen(false);
    }
    qc.invalidateQueries({ queryKey: ["online_sales"] });
    qc.invalidateQueries({ queryKey: ["items"] });
  };

  // ── Payment helpers ─────────────────────────────────────────────────
  const expectedForItem = (s: any) => Number(s.posted_price || 0) * Number(s.quantity || 1);
  const expectedForGroup = (items: any[]) => items.reduce((sum, x) => sum + expectedForItem(x), 0);

  const openPayDialog = (ids: string[], orderNumber: string, expected: number, currentPaid: number) => {
    setPayTarget({ ids, orderNumber, expected });
    setPayAmount(currentPaid > 0 ? String(currentPaid) : String(expected));
    setPayDialogOpen(true);
  };

  const submitPayment = async () => {
    if (!payTarget) return;
    const amt = parseFloat(payAmount);
    if (!Number.isFinite(amt) || amt < 0) { toast.error("Enter a valid amount"); return; }
    // Distribute amount proportionally across line items by their expected value
    const ids = payTarget.ids;
    if (ids.length === 1) {
      try {
        await updateOnlineSale(ids[0], { amount_paid: amt, payment_status: 'paid', paid_at: new Date().toISOString() } as any);
        toast.success(`Order ${payTarget.orderNumber} marked as paid`);
      } catch (e: any) { toast.error(e.message || "Failed"); }
    } else {
      // Split proportionally
      const lineSales = sales.filter((s: any) => ids.includes(s.id));
      const totalExpected = lineSales.reduce((sum: number, s: any) => sum + expectedForItem(s), 0) || 1;
      let allocated = 0;
      for (let i = 0; i < lineSales.length; i++) {
        const s = lineSales[i];
        const share = i === lineSales.length - 1
          ? Math.max(0, amt - allocated)
          : Math.round((amt * (expectedForItem(s) / totalExpected)) * 100) / 100;
        allocated += share;
        try {
          await updateOnlineSale(s.id, { amount_paid: share, payment_status: 'paid', paid_at: new Date().toISOString() } as any);
        } catch (e) { console.error(e); }
      }
      toast.success(`Order ${payTarget.orderNumber}: ${ids.length} items marked paid`);
    }
    qc.invalidateQueries({ queryKey: ["online_sales"] });
    setPayDialogOpen(false);
    setPayTarget(null);
  };

  const markUnpaid = async (ids: string[]) => {
    try {
      for (const id of ids) {
        await updateOnlineSale(id, { amount_paid: 0, payment_status: 'unpaid', paid_at: null } as any);
      }
      qc.invalidateQueries({ queryKey: ["online_sales"] });
      toast.success(ids.length > 1 ? `${ids.length} items marked unpaid` : "Marked unpaid");
    } catch (e: any) { toast.error(e.message || "Failed"); }
  };

  // ── Bulk payment upload ─────────────────────────────────────────────
  const handleBulkPayFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkPayFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: "array", cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const sheetRows = XLSX.utils.sheet_to_json<BulkCell[]>(ws, { header: 1, defval: "", raw: false, blankrows: false })
          .filter((row) => row.some((cell) => normalizeBulkCell(cell) !== ""));
        if (sheetRows.length === 0) { toast.error("File is empty"); return; }

        const header = sheetRows[0] ?? [];
        const orderIdx = matchBulkColumnIndex(header, bulkColumnKeywords.orderId);
        const amountIdx = matchBulkColumnIndex(header, ["amount paid", "paid", "payout", "amount", "net"]);
        if (orderIdx < 0) { toast.error("Could not find an Order ID column"); return; }
        if (amountIdx < 0) { toast.error("Could not find an Amount Paid column"); return; }

        const dataRows = sheetRows.slice(1);
        const parsed = dataRows.map((row) => {
          const order_id = normalizeBulkCell(row[orderIdx]);
          const amount_paid = parseBulkNumber(row[amountIdx], 0);
          let error: string | undefined;
          let matched_ids: string[] = [];
          let expected = 0;
          if (!order_id) {
            error = "Missing Order ID — row rejected";
          } else {
            const matches = sales.filter((s: any) => s.order_number === order_id);
            if (matches.length === 0) error = `Order "${order_id}" not found`;
            else {
              matched_ids = matches.map((s: any) => s.id);
              expected = expectedForGroup(matches);
            }
          }
          if (!error && amount_paid < 0) error = "Negative amount";
          return { order_id, amount_paid, matched_ids, expected, valid: !error, error };
        });
        setBulkPayRows(parsed);
      } catch (err) {
        console.error("Bulk payment parse error", err);
        toast.error("Failed to parse file");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const handleBulkPayUpload = async () => {
    const valid = bulkPayRows.filter(r => r.valid);
    if (valid.length === 0) return;
    setBulkPayUploading(true);
    let success = 0; let failed = 0;
    for (const row of valid) {
      try {
        if (row.matched_ids.length === 1) {
          await updateOnlineSale(row.matched_ids[0], { amount_paid: row.amount_paid, payment_status: 'paid', paid_at: new Date().toISOString() } as any);
        } else {
          const lineSales = sales.filter((s: any) => row.matched_ids.includes(s.id));
          const totalExpected = lineSales.reduce((sum: number, s: any) => sum + expectedForItem(s), 0) || 1;
          let allocated = 0;
          for (let i = 0; i < lineSales.length; i++) {
            const s = lineSales[i];
            const share = i === lineSales.length - 1
              ? Math.max(0, row.amount_paid - allocated)
              : Math.round((row.amount_paid * (expectedForItem(s) / totalExpected)) * 100) / 100;
            allocated += share;
            await updateOnlineSale(s.id, { amount_paid: share, payment_status: 'paid', paid_at: new Date().toISOString() } as any);
          }
        }
        success++;
      } catch (e) { failed++; console.error(e); }
    }
    setBulkPayUploading(false);
    if (success > 0) toast.success(`Marked ${success} orders as paid${failed ? ` (${failed} failed)` : ""}`);
    if (success === 0 && failed > 0) toast.error(`All ${failed} payments failed`);
    if (success > 0) {
      setBulkPayRows([]);
      setBulkPayFileName("");
      setBulkPayOpen(false);
    }
    qc.invalidateQueries({ queryKey: ["online_sales"] });
  };

  const downloadPaymentsTemplate = () => {
    const template = [
      { "Order ID": "SHOPEE12345", "Amount Paid": 95.50 },
      { "Order ID": "LAZADA67890", "Amount Paid": 240.00 },
    ];
    const ws = XLSX.utils.json_to_sheet(template);
    ws["!cols"] = [{ wch: 22 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Payments");
    XLSX.writeFile(wb, "online_sales_payments_template.xlsx");
  };

  const bulkPayValidCount = bulkPayRows.filter(r => r.valid).length;
  const bulkPayInvalidCount = bulkPayRows.filter(r => !r.valid).length;

  const downloadTemplate = () => {
    const template = [
      { "Order ID": "", "Date": new Date().toISOString().split("T")[0], "Product Name": "Sample Product", "Quantity": 1, "Channel": "shopee", "Selling Price": 100 },
      { "Order ID": "", "Date": new Date().toISOString().split("T")[0], "Product Name": "Another Product", "Quantity": 2, "Channel": "lazada", "Selling Price": 250 },
    ];
    const ws = XLSX.utils.json_to_sheet(template);
    ws["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 30 }, { wch: 10 }, { wch: 12 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Online Sales");
    XLSX.writeFile(wb, "online_sales_template.xlsx");
  };

  const bulkValidCount = bulkRows.filter(r => r.valid).length;
  const bulkInvalidCount = bulkRows.filter(r => !r.valid).length;

  const channelLabel = (c: string) => c === "shopee" ? "Shopee" : c === "lazada" ? "Lazada" : "Others";
  const channelColor = (c: string) => c === "shopee" ? "bg-orange-100 text-orange-700" : c === "lazada" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700";
  const statusColor = (s: string) => s === 'returned' ? 'bg-yellow-100 text-yellow-700' : s === 'cancelled' ? 'bg-red-100 text-red-700' : '';
  const statusLabel = (s: string) => s === 'returned' ? 'Returned' : s === 'cancelled' ? 'Cancelled' : 'Completed';

  const completedCount = sales.filter((s: any) => (s.status || 'completed') === 'completed').length;
  const returnsCount = sales.filter((s: any) => s.status === 'returned' || s.status === 'cancelled').length;

  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Online Sales</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">Record Shopee, Lazada & other orders</p>
        </div>
        <div className="toolbar-actions">
          {selected.size > 0 && (
            <>
              <BulkEditDialog
                selectedIds={Array.from(selected)}
                entityLabel="sales"
                fields={[
                  { key: "sales_channel", label: "Channel", type: "select", options: [
                    { value: "shopee", label: "Shopee" },
                    { value: "lazada", label: "Lazada" },
                    { value: "others", label: "Others" },
                  ]},
                  { key: "status", label: "Status", type: "select", options: [
                    { value: "completed", label: "Completed" },
                    { value: "returned", label: "Returned" },
                    { value: "cancelled", label: "Cancelled" },
                  ]},
                  { key: "posted_price", label: "Selling Price", type: "number", transform: v => parseFloat(v) || 0 },
                  { key: "deal_price", label: "Deal Price", type: "number", transform: v => parseFloat(v) || 0 },
                  { key: "order_date", label: "Order Date", type: "date" },
                  { key: "notes", label: "Notes", type: "textarea" },
                ] as BulkField[]}
                updateOne={async (id, patch) => { await updateOnlineSale(id, patch as any); }}
                onSuccess={() => { qc.invalidateQueries({ queryKey: ["online_sales"] }); setSelected(new Set()); }}
              />
              <Button variant="destructive" size="sm" onClick={handleBulkDelete} disabled={bulkDeleting}>
                <Trash2 className="h-4 w-4 mr-1" /> {bulkDeleting ? "Deleting..." : `Delete ${selected.size} Selected`}
              </Button>
            </>
          )}
          <ExportButton
            data={sales}
            columns={{ "Order ID": (r: any) => r.order_number, "Date": (r: any) => r.order_date, "Product": (r: any) => r.product_name, "Qty": (r: any) => r.quantity || 1, "Channel": (r: any) => r.sales_channel, "Selling Price": (r: any) => r.posted_price, "Status": (r: any) => r.status || 'completed' }}
            dateField={(r: any) => r.order_date || ""}
            fileName="Online_Sales"
          />
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="rounded-lg h-9 px-3 text-sm">
            <Filter className="h-4 w-4 mr-1.5" /> Filters
          </Button>
          <ExportButton
            data={filtered}
            columns={{ "Order ID": (r: any) => r.order_number, "Date": (r: any) => r.order_date, "Product": (r: any) => r.product_name, "Qty": (r: any) => r.quantity || 1, "Channel": (r: any) => r.sales_channel, "Selling Price": (r: any) => r.posted_price, "Status": (r: any) => r.status || 'completed' }}
            dateField={(r: any) => r.order_date || ""}
            fileName="Online_Sales"
          />
          <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
            <Upload className="h-4 w-4 mr-1" /> Bulk Upload
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> Add Sale
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="filter-bar">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Date From</Label>
            <Input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="h-9 sm:h-8 sm:w-36 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Date To</Label>
            <Input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="h-9 sm:h-8 sm:w-36 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Channel</Label>
            <Select value={filterChannel} onValueChange={setFilterChannel}>
              <SelectTrigger className="h-9 sm:h-8 sm:w-36 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Channels</SelectItem>
                <SelectItem value="shopee">Shopee</SelectItem>
                <SelectItem value="lazada">Lazada</SelectItem>
                <SelectItem value="others">Others</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Status</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-9 sm:h-8 sm:w-36 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="returned">Returned</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
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
            <p className="text-xs text-muted-foreground mt-0.5">Sum of completed sales in current view</p>
          </div>
          <p className="text-xl sm:text-2xl font-bold tabular-nums truncate">{peso(totalSales)}</p>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setSelected(new Set()); }}>
        <TabsList>
          <TabsTrigger value="completed">Completed ({completedCount})</TabsTrigger>
          <TabsTrigger value="returns">Returns / Cancelled ({returnsCount})</TabsTrigger>
        </TabsList>

        <div className="mt-4 relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search by product, order ID..." value={filter} onChange={e => setFilter(e.target.value)} className="pl-9 h-9 rounded-lg text-sm" />
        </div>

        <TabsContent value="completed">
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} aria-label="Select all" />
                  </TableHead>
                  <SortableHeader sortKey="order_date" label="Date" sort={sort} onToggle={toggle} />
                  <SortableHeader sortKey="order_number" label="Order ID" sort={sort} onToggle={toggle} />
                  <SortableHeader sortKey="product_name" label="Product Name" sort={sort} onToggle={toggle} />
                  <SortableHeader sortKey="quantity" label="Qty" sort={sort} onToggle={toggle} align="center" />
                  <SortableHeader sortKey="sales_channel" label="Channel" sort={sort} onToggle={toggle} />
                  <SortableHeader sortKey="posted_price" label="Selling Price" sort={sort} onToggle={toggle} align="right" />
                  <TableHead className="w-28"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
                ) : groupedFiltered.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No sales records found</TableCell></TableRow>
                ) : groupedFiltered.flatMap((group) => {
                  const groupKey = group.orderNumber || `__no_id_${group.items[0].id}`;
                  if (group.items.length === 1) {
                    const s = group.items[0];
                    return [(
                      <TableRow key={s.id} className={selected.has(s.id) ? "bg-muted/50" : ""}>
                        <TableCell>
                          <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggleSelect(s.id)} aria-label={`Select ${s.order_number}`} />
                        </TableCell>
                        <TableCell className="text-sm">{s.order_date}</TableCell>
                        <TableCell className="font-mono text-xs">{s.order_number}</TableCell>
                        <TableCell className="text-sm font-medium">{s.product_name}</TableCell>
                        <TableCell className="text-sm text-center">{s.quantity || 1}</TableCell>
                        <TableCell><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${channelColor(s.sales_channel)}`}>{channelLabel(s.sales_channel)}</span></TableCell>
                        <TableCell className="text-right text-sm">{peso(s.posted_price)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)} title="Edit"><Pencil className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-yellow-600" onClick={() => handleReturn(s.id, 'returned')} title="Return"><Undo2 className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleReturn(s.id, 'cancelled')} title="Cancel"><XCircle className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMut.mutate(s.id)} title="Delete"><Trash2 className="h-3 w-3" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )];
                  }
                  // Multi-item group
                  const isOpen = expandedOrders.has(groupKey);
                  const totalQty = group.items.reduce((sum, x) => sum + (Number(x.quantity) || 1), 0);
                  const totalAmount = group.items.reduce((sum, x) => sum + (Number(x.posted_price) || 0) * (Number(x.quantity) || 1), 0);
                  const allChannelsSame = group.items.every(x => x.sales_channel === group.items[0].sales_channel);
                  const groupSelected = group.items.every(x => selected.has(x.id));
                  return [
                    (
                      <TableRow key={`g-${groupKey}`} className="cursor-pointer hover:bg-muted/40 bg-muted/20" onClick={() => toggleExpand(groupKey)}>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={groupSelected}
                            onCheckedChange={() => {
                              setSelected(prev => {
                                const next = new Set(prev);
                                if (groupSelected) group.items.forEach(x => next.delete(x.id));
                                else group.items.forEach(x => next.add(x.id));
                                return next;
                              });
                            }}
                            aria-label={`Select order ${group.orderNumber}`}
                          />
                        </TableCell>
                        <TableCell className="text-sm">{group.items[0].order_date}</TableCell>
                        <TableCell className="font-mono text-xs">
                          <div className="flex items-center gap-1">
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            {group.orderNumber}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          <span className="text-muted-foreground italic">{group.items.length} items</span>
                        </TableCell>
                        <TableCell className="text-sm text-center font-semibold">{totalQty}</TableCell>
                        <TableCell>
                          {allChannelsSame
                            ? <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${channelColor(group.items[0].sales_channel)}`}>{channelLabel(group.items[0].sales_channel)}</span>
                            : <span className="text-xs text-muted-foreground">Mixed</span>}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold">{peso(totalAmount)}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-yellow-600" title="Return all items in this order" onClick={async () => {
                              for (const x of group.items) { try { await returnMut.mutateAsync({ id: x.id, status: 'returned' }); } catch {} }
                              toast.success(`Order ${group.orderNumber}: ${group.items.length} items returned`);
                            }}><Undo2 className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Cancel all items in this order" onClick={async () => {
                              for (const x of group.items) { try { await returnMut.mutateAsync({ id: x.id, status: 'cancelled' }); } catch {} }
                              toast.success(`Order ${group.orderNumber}: ${group.items.length} items cancelled`);
                            }}><XCircle className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Delete entire order" onClick={async () => {
                              for (const x of group.items) { try { await deleteOnlineSale(x.id); } catch {} }
                              qc.invalidateQueries({ queryKey: ["online_sales"] });
                              qc.invalidateQueries({ queryKey: ["items"] });
                              toast.success(`Order ${group.orderNumber} deleted`);
                            }}><Trash2 className="h-3 w-3" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ),
                    ...(isOpen ? group.items.map((s: any) => (
                      <TableRow key={s.id} className={`${selected.has(s.id) ? "bg-muted/50" : ""}`}>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggleSelect(s.id)} aria-label={`Select ${s.product_name}`} />
                        </TableCell>
                        <TableCell></TableCell>
                        <TableCell className="text-xs text-muted-foreground pl-8">↳</TableCell>
                        <TableCell className="text-sm pl-4">{s.product_name}</TableCell>
                        <TableCell className="text-sm text-center">{s.quantity || 1}</TableCell>
                        <TableCell><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${channelColor(s.sales_channel)}`}>{channelLabel(s.sales_channel)}</span></TableCell>
                        <TableCell className="text-right text-sm">{peso(s.posted_price)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)} title="Edit"><Pencil className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-yellow-600" onClick={() => handleReturn(s.id, 'returned')} title="Return"><Undo2 className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleReturn(s.id, 'cancelled')} title="Cancel"><XCircle className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMut.mutate(s.id)} title="Delete"><Trash2 className="h-3 w-3" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )) : []),
                  ];
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="returns">
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} aria-label="Select all" />
                  </TableHead>
                  <SortableHeader sortKey="order_date" label="Date" sort={sort} onToggle={toggle} />
                  <SortableHeader sortKey="order_number" label="Order ID" sort={sort} onToggle={toggle} />
                  <SortableHeader sortKey="product_name" label="Product Name" sort={sort} onToggle={toggle} />
                  <SortableHeader sortKey="quantity" label="Qty" sort={sort} onToggle={toggle} align="center" />
                  <SortableHeader sortKey="sales_channel" label="Channel" sort={sort} onToggle={toggle} />
                  <SortableHeader sortKey="posted_price" label="Selling Price" sort={sort} onToggle={toggle} align="right" />
                  <SortableHeader sortKey="status" label="Status" sort={sort} onToggle={toggle} />
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
                ) : groupedFiltered.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No returned / cancelled orders</TableCell></TableRow>
                ) : groupedFiltered.flatMap((group) => {
                  const groupKey = group.orderNumber || `__no_id_${group.items[0].id}`;
                  if (group.items.length === 1) {
                    const s = group.items[0];
                    return [(
                      <TableRow key={s.id} className={selected.has(s.id) ? "bg-muted/50" : ""}>
                        <TableCell>
                          <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggleSelect(s.id)} aria-label={`Select ${s.order_number}`} />
                        </TableCell>
                        <TableCell className="text-sm">{s.order_date}</TableCell>
                        <TableCell className="font-mono text-xs">{s.order_number}</TableCell>
                        <TableCell className="text-sm font-medium">{s.product_name}</TableCell>
                        <TableCell className="text-sm text-center">{s.quantity || 1}</TableCell>
                        <TableCell><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${channelColor(s.sales_channel)}`}>{channelLabel(s.sales_channel)}</span></TableCell>
                        <TableCell className="text-right text-sm">{peso(s.posted_price)}</TableCell>
                        <TableCell><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(s.status)}`}>{statusLabel(s.status)}</span></TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMut.mutate(s.id)} title="Delete"><Trash2 className="h-3 w-3" /></Button>
                        </TableCell>
                      </TableRow>
                    )];
                  }
                  const isOpen = expandedOrders.has(groupKey);
                  const totalQty = group.items.reduce((sum, x) => sum + (Number(x.quantity) || 1), 0);
                  const totalAmount = group.items.reduce((sum, x) => sum + (Number(x.posted_price) || 0) * (Number(x.quantity) || 1), 0);
                  const allChannelsSame = group.items.every(x => x.sales_channel === group.items[0].sales_channel);
                  const allStatusSame = group.items.every(x => (x.status || 'completed') === (group.items[0].status || 'completed'));
                  const groupSelected = group.items.every(x => selected.has(x.id));
                  return [
                    (
                      <TableRow key={`g-${groupKey}`} className="cursor-pointer hover:bg-muted/40 bg-muted/20" onClick={() => toggleExpand(groupKey)}>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={groupSelected}
                            onCheckedChange={() => {
                              setSelected(prev => {
                                const next = new Set(prev);
                                if (groupSelected) group.items.forEach(x => next.delete(x.id));
                                else group.items.forEach(x => next.add(x.id));
                                return next;
                              });
                            }}
                            aria-label={`Select order ${group.orderNumber}`}
                          />
                        </TableCell>
                        <TableCell className="text-sm">{group.items[0].order_date}</TableCell>
                        <TableCell className="font-mono text-xs">
                          <div className="flex items-center gap-1">
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            {group.orderNumber}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-medium"><span className="text-muted-foreground italic">{group.items.length} items</span></TableCell>
                        <TableCell className="text-sm text-center font-semibold">{totalQty}</TableCell>
                        <TableCell>
                          {allChannelsSame
                            ? <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${channelColor(group.items[0].sales_channel)}`}>{channelLabel(group.items[0].sales_channel)}</span>
                            : <span className="text-xs text-muted-foreground">Mixed</span>}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold">{peso(totalAmount)}</TableCell>
                        <TableCell>
                          {allStatusSame
                            ? <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(group.items[0].status)}`}>{statusLabel(group.items[0].status)}</span>
                            : <span className="text-xs text-muted-foreground">Mixed</span>}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Delete entire order" onClick={async () => {
                            for (const x of group.items) { try { await deleteOnlineSale(x.id); } catch {} }
                            qc.invalidateQueries({ queryKey: ["online_sales"] });
                            qc.invalidateQueries({ queryKey: ["items"] });
                            toast.success(`Order ${group.orderNumber} deleted`);
                          }}><Trash2 className="h-3 w-3" /></Button>
                        </TableCell>
                      </TableRow>
                    ),
                    ...(isOpen ? group.items.map((s: any) => (
                      <TableRow key={s.id} className={selected.has(s.id) ? "bg-muted/50" : ""}>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggleSelect(s.id)} aria-label={`Select ${s.product_name}`} />
                        </TableCell>
                        <TableCell></TableCell>
                        <TableCell className="text-xs text-muted-foreground pl-8">↳</TableCell>
                        <TableCell className="text-sm pl-4">{s.product_name}</TableCell>
                        <TableCell className="text-sm text-center">{s.quantity || 1}</TableCell>
                        <TableCell><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${channelColor(s.sales_channel)}`}>{channelLabel(s.sales_channel)}</span></TableCell>
                        <TableCell className="text-right text-sm">{peso(s.posted_price)}</TableCell>
                        <TableCell><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(s.status)}`}>{statusLabel(s.status)}</span></TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMut.mutate(s.id)} title="Delete"><Trash2 className="h-3 w-3" /></Button>
                        </TableCell>
                      </TableRow>
                    )) : []),
                  ];
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingSale ? "Edit Sale" : "New Online Sale"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Order ID <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input value={form.order_number} onChange={e => setForm(f => ({ ...f, order_number: e.target.value }))} placeholder="Auto-generated" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Date</Label>
                <DateField value={form.order_date} onChange={v => setForm(f => ({ ...f, order_date: v }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Channel</Label>
                <Select value={form.sales_channel} onValueChange={(v: SalesChannel) => setForm(f => ({ ...f, sales_channel: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shopee">Shopee</SelectItem>
                    <SelectItem value="lazada">Lazada</SelectItem>
                    <SelectItem value="others">Others</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Items {!editingSale && form.lines.length > 1 && <span className="text-muted-foreground font-normal">({form.lines.length})</span>}</Label>
                {!editingSale && (
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setForm(f => ({ ...f, lines: [...f.lines, { ...emptyLine }] }))}>
                    <Plus className="h-3 w-3 mr-1" /> Add another item
                  </Button>
                )}
              </div>
              {form.lines.map((line, idx) => (
                <div key={idx} className="border rounded-lg p-3 space-y-3 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Item {idx + 1}</span>
                    {!editingSale && form.lines.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }))}>
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">Inventory Item / Variation (optional)</Label>
                    <ItemSearch
                      items={items}
                      value={line.item_id}
                      variationId={line.variation_id}
                      onChange={(_itemId, item, _custom, variation) => {
                        setForm(f => {
                          const lines = [...f.lines];
                          if (variation && item) {
                            lines[idx] = { ...lines[idx], item_id: item.id, variation_id: variation.id, product_name: `${item.name} — ${variation.name}`, posted_price: Number(variation.selling_price) };
                          } else if (item) {
                            lines[idx] = { ...lines[idx], item_id: item.id, variation_id: null, product_name: item.name, posted_price: Number(item.selling_price) };
                          }
                          return { ...f, lines };
                        });
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">Product Name</Label>
                    <Input value={line.product_name} onChange={e => setForm(f => { const lines = [...f.lines]; lines[idx] = { ...lines[idx], product_name: e.target.value }; return { ...f, lines }; })} placeholder="Product name" className="h-9" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-muted-foreground">Quantity</Label>
                      <Input type="number" min={1} value={line.quantity} onChange={e => setForm(f => { const lines = [...f.lines]; lines[idx] = { ...lines[idx], quantity: parseInt(e.target.value) || 1 }; return { ...f, lines }; })} className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-muted-foreground">Selling Price</Label>
                      <Input type="number" min={0} step="0.01" value={line.posted_price} onChange={e => setForm(f => { const lines = [...f.lines]; lines[idx] = { ...lines[idx], posted_price: parseFloat(e.target.value) || 0 }; return { ...f, lines }; })} className="h-9" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes</Label>
              <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" className="h-9" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editingSale ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Upload Dialog */}
      <Dialog open={bulkOpen} onOpenChange={(v) => { if (!v) { setBulkRows([]); setBulkFileName(""); } setBulkOpen(v); }}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Bulk Upload Sales</DialogTitle>
          </DialogHeader>

          {bulkRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="rounded-full bg-muted p-4"><Upload className="h-8 w-8 text-muted-foreground" /></div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">Upload an Excel file (.xlsx, .xls, .csv)</p>
                <p className="text-xs text-muted-foreground">Columns: <strong>Order ID</strong> (optional), <strong>Date</strong>, <strong>Product/Name</strong>, <strong>Quantity</strong>, <strong>Channel</strong>, <strong>Selling Price</strong></p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={downloadTemplate}><FileSpreadsheet className="h-4 w-4 mr-1" /> Download Template</Button>
                <Button onClick={() => fileRef.current?.click()}>Select File</Button>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleBulkFile} className="hidden" />
            </div>
          ) : (
            <div className="flex flex-col gap-3 overflow-hidden">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{bulkFileName} — {bulkRows.length} rows</span>
                <div className="flex gap-3">
                  {bulkValidCount > 0 && <span className="flex items-center gap-1 text-green-600"><Check className="h-3 w-3" />{bulkValidCount} valid</span>}
                  {bulkInvalidCount > 0 && <span className="flex items-center gap-1 text-destructive"><AlertCircle className="h-3 w-3" />{bulkInvalidCount} invalid</span>}
                </div>
              </div>
              <div className="overflow-auto max-h-[40vh] border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs w-8">#</TableHead>
                      <TableHead className="text-xs">Order ID</TableHead>
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs">Product</TableHead>
                      <TableHead className="text-xs text-center">Qty</TableHead>
                      <TableHead className="text-xs">Channel</TableHead>
                      <TableHead className="text-xs text-right">Price</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bulkRows.map((row, i) => (
                      <TableRow key={i} className={row.valid ? "" : "bg-destructive/5"}>
                        <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-mono text-xs">{row.order_id || "—"}</TableCell>
                        <TableCell className="text-xs">{row.order_date}</TableCell>
                        <TableCell className="text-sm">{row.product_name || "—"}</TableCell>
                        <TableCell className="text-sm text-center">{row.quantity}</TableCell>
                        <TableCell><span className={`text-xs px-2 py-0.5 rounded-full ${channelColor(row.sales_channel)}`}>{channelLabel(row.sales_channel)}</span></TableCell>
                        <TableCell className="text-sm text-right">{peso(row.posted_price)}</TableCell>
                        <TableCell className="text-xs">{row.valid ? <span className="text-green-600">✓</span> : <span className="text-destructive">{row.error}</span>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => { setBulkRows([]); setBulkFileName(""); }}>Clear</Button>
                <Button onClick={handleBulkUpload} disabled={bulkUploading || bulkValidCount === 0}>{bulkUploading ? "Uploading..." : `Upload ${bulkValidCount} Records`}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
