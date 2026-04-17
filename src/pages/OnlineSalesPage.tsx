import { useState, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getOnlineSales, createOnlineSale, updateOnlineSale, deleteOnlineSale, returnOnlineSale, generateShopeeOrderNumber, generateLazadaOrderNumber, getItems } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, Upload, FileSpreadsheet, Check, AlertCircle, Search, Undo2, XCircle } from "lucide-react";
import ExportButton from "@/components/ExportButton";
import { toast } from "sonner";
import { peso } from "@/lib/currency";
import type { OnlineSale } from "@/types/database";
import { ItemSearch } from "@/components/ItemSearch";
import * as XLSX from "xlsx";
import { useAuth } from "@/contexts/AuthContext";

type SalesChannel = "shopee" | "lazada" | "others";

type BulkCell = string | number | Date | boolean | null | undefined;

interface SaleForm {
  order_date: string;
  order_number: string;
  product_name: string;
  quantity: number;
  sales_channel: SalesChannel;
  posted_price: number;
  notes: string;
  item_id: string;
}

const emptyForm: SaleForm = {
  order_date: new Date().toISOString().split("T")[0],
  order_number: "",
  product_name: "",
  quantity: 1,
  sales_channel: "shopee",
  posted_price: 0,
  notes: "",
  item_id: "",
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
  const { data: sales = [], isLoading } = useQuery({ queryKey: ["online_sales"], queryFn: getOnlineSales });
  const { data: items = [] } = useQuery({ queryKey: ["items"], queryFn: getItems });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<OnlineSale | null>(null);
  const [form, setForm] = useState<SaleForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState("completed");

  // Bulk upload state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<{ product_name: string; quantity: number; sales_channel: SalesChannel; posted_price: number; order_date: string; order_id: string; item_id: string | null; valid: boolean; error?: string }[]>([]);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkFileName, setBulkFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const deleteMut = useMutation({ mutationFn: deleteOnlineSale, onSuccess: () => { qc.invalidateQueries({ queryKey: ["online_sales"] }); qc.invalidateQueries({ queryKey: ["items"] }); toast.success("Deleted"); } });
  const returnMut = useMutation({ mutationFn: ({ id, status }: { id: string; status: 'returned' | 'cancelled' }) => returnOnlineSale(id, status), onSuccess: () => { qc.invalidateQueries({ queryKey: ["online_sales"] }); qc.invalidateQueries({ queryKey: ["items"] }); } });

  const openNew = () => { setEditingSale(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (s: OnlineSale) => {
    setEditingSale(s);
    setForm({
      order_date: s.order_date,
      order_number: s.order_number,
      product_name: s.product_name,
      quantity: s.quantity || 1,
      sales_channel: s.sales_channel,
      posted_price: s.posted_price,
      notes: s.notes || "",
      item_id: s.item_id || "",
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
    if (!form.product_name.trim()) { toast.error("Product name is required"); return; }
    setSaving(true);
    try {
      const payload: any = {
        order_date: form.order_date,
        product_name: form.product_name,
        quantity: form.quantity,
        sales_channel: form.sales_channel,
        posted_price: form.posted_price,
        deal_price: 0,
        notes: form.notes,
        item_id: form.item_id || null,
      };
      if (editingSale) {
        await updateOnlineSale(editingSale.id, payload);
        toast.success("Updated");
      } else {
        const orderNumber = form.order_number.trim() || await generateOrderNumber(form.sales_channel);
        await createOnlineSale({ ...payload, order_number: orderNumber });
        toast.success("Created");
      }
      qc.invalidateQueries({ queryKey: ["online_sales"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      setDialogOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Failed");
    }
    setSaving(false);
  };

  // Filter by tab + search
  const filtered = sales.filter((s: any) => {
    const status = s.status || 'completed';
    if (activeTab === 'completed' && status !== 'completed') return false;
    if (activeTab === 'returns' && status !== 'returned' && status !== 'cancelled') return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return s.product_name?.toLowerCase().includes(q) || s.order_number?.toLowerCase().includes(q);
  });

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
        const wb = XLSX.read(evt.target?.result, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const sheetRows = XLSX.utils.sheet_to_json<BulkCell[]>(ws, { header: 1, defval: "", raw: true, blankrows: false })
          .filter((row) => row.some((cell) => normalizeBulkCell(cell) !== ""));
        if (sheetRows.length === 0) { toast.error("File is empty"); return; }

        const resolvedColumns = resolveBulkColumns(sheetRows);
        if (!resolvedColumns || resolvedColumns.indexes.product < 0) {
          toast.error("Could not detect the product column");
          return;
        }

        const today = new Date().toISOString().split("T")[0];
        const parseDate = (v: unknown): string => {
          if (!v) return today;
          if (v instanceof Date) return v.toISOString().split("T")[0];
          if (typeof v === "number") {
            // Excel serial date → JS date (Excel epoch: 1899-12-30)
            const ms = Math.round((v - 25569) * 86400 * 1000);
            const d = new Date(ms);
            if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
            return today;
          }
          const s = String(v).trim();
          // ISO-like already
          if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
          const d = new Date(s);
          if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
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

          const matchedItem = items.find(i => i.name.toLowerCase() === product_name.toLowerCase() || i.sku.toLowerCase() === product_name.toLowerCase());

          let error: string | undefined;
          if (!product_name) error = "Missing product name";
          else if (posted_price < 0) error = "Negative price";

          return { product_name, quantity, sales_channel, posted_price, order_date, order_id, item_id: matchedItem?.id || null, valid: !error, error };
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
        await createOnlineSale({ order_number: orderNumber, product_name: row.product_name, quantity: row.quantity, sales_channel: row.sales_channel, posted_price: row.posted_price, deal_price: 0, order_date: row.order_date, item_id: row.item_id, notes: "" });
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Online Sales</h1>
          <p className="text-sm text-muted-foreground">Record Shopee, Lazada & other orders</p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <Button variant="destructive" size="sm" onClick={handleBulkDelete} disabled={bulkDeleting}>
              <Trash2 className="h-4 w-4 mr-1" /> {bulkDeleting ? "Deleting..." : `Delete ${selected.size} Selected`}
            </Button>
          )}
          <ExportButton
            data={sales}
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
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Order ID</TableHead>
                  <TableHead className="text-xs">Product Name</TableHead>
                  <TableHead className="text-xs text-center">Qty</TableHead>
                  <TableHead className="text-xs">Channel</TableHead>
                  <TableHead className="text-xs text-right">Selling Price</TableHead>
                  <TableHead className="w-28"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No sales records found</TableCell></TableRow>
                ) : filtered.map((s: any) => (
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
                ))}
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
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Order ID</TableHead>
                  <TableHead className="text-xs">Product Name</TableHead>
                  <TableHead className="text-xs text-center">Qty</TableHead>
                  <TableHead className="text-xs">Channel</TableHead>
                  <TableHead className="text-xs text-right">Selling Price</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No returned / cancelled orders</TableCell></TableRow>
                ) : filtered.map((s: any) => (
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
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingSale ? "Edit Sale" : "New Online Sale"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Order ID <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input value={form.order_number} onChange={e => setForm(f => ({ ...f, order_number: e.target.value }))} placeholder="Auto-generated if blank" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Inventory Item (optional)</Label>
              <ItemSearch
                items={items}
                value={form.item_id}
                onChange={(itemId, item) => setForm(f => ({ ...f, item_id: itemId, product_name: item.name, posted_price: Number(item.selling_price) }))}
              />
              <p className="text-[10px] text-muted-foreground">Auto-fills product name & price</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Date</Label>
              <Input type="date" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Product Name</Label>
              <Input value={form.product_name} onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))} placeholder="Product name" className="h-9" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Quantity</Label>
                <Input type="number" min={1} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: parseInt(e.target.value) || 1 }))} className="h-9" />
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
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Selling Price</Label>
                <Input type="number" min={0} step="0.01" value={form.posted_price} onChange={e => setForm(f => ({ ...f, posted_price: parseFloat(e.target.value) || 0 }))} className="h-9" />
              </div>
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
