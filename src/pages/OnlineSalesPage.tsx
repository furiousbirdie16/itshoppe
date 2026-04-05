import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getOnlineSales, createOnlineSale, updateOnlineSale, deleteOnlineSale, generateShopeeOrderNumber, generateLazadaOrderNumber, getItems } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, Upload, FileSpreadsheet, Check, AlertCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { peso } from "@/lib/currency";
import type { OnlineSale } from "@/types/database";
import { ItemSearch } from "@/components/ItemSearch";
import * as XLSX from "xlsx";
import { useRef } from "react";

type SalesChannel = "shopee" | "lazada";

interface SaleForm {
  order_date: string;
  product_name: string;
  sales_channel: SalesChannel;
  posted_price: number;
  notes: string;
  item_id: string;
}

const emptyForm: SaleForm = {
  order_date: new Date().toISOString().split("T")[0],
  product_name: "",
  sales_channel: "shopee",
  posted_price: 0,
  notes: "",
  item_id: "",
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

  // Bulk upload state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<{ product_name: string; sales_channel: SalesChannel; posted_price: number; order_date: string; sku: string; item_id: string | null; valid: boolean; error?: string }[]>([]);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkFileName, setBulkFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const deleteMut = useMutation({ mutationFn: deleteOnlineSale, onSuccess: () => { qc.invalidateQueries({ queryKey: ["online_sales"] }); toast.success("Deleted"); } });

  const openNew = () => { setEditingSale(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (s: OnlineSale) => {
    setEditingSale(s);
    setForm({ order_date: s.order_date, product_name: s.product_name, sales_channel: s.sales_channel, posted_price: s.posted_price, notes: s.notes || "", item_id: s.item_id || "" });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.product_name.trim()) { toast.error("Product name is required"); return; }
    setSaving(true);
    try {
      const payload: any = { ...form, item_id: form.item_id || null };
      if (editingSale) {
        await updateOnlineSale(editingSale.id, payload);
        toast.success("Updated");
      } else {
        const orderNumber = form.sales_channel === "shopee" ? await generateShopeeOrderNumber() : await generateLazadaOrderNumber();
        await createOnlineSale({ ...payload, order_number: orderNumber });
        toast.success("Created");
      }
      qc.invalidateQueries({ queryKey: ["online_sales"] });
      setDialogOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Failed");
    }
    setSaving(false);
  };

  // Bulk upload
  const handleBulkFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
        if (json.length === 0) { toast.error("File is empty"); return; }

        const headers = Object.keys(json[0]);
        const findCol = (keywords: string[]) => headers.find(h => keywords.some(k => h.toLowerCase().includes(k)));
        const productCol = findCol(["product", "item", "name"]);
        const channelCol = findCol(["channel", "platform", "shopee", "lazada"]);
        const priceCol = findCol(["price", "amount", "posted"]);
        const dateCol = findCol(["date"]);
        const skuCol = findCol(["sku"]);

        if (!productCol && !skuCol) { toast.error("Could not find a 'Product/Name' or 'SKU' column"); return; }

        const parsed = json.map((row) => {
          const sku = String(skuCol ? row[skuCol] : "").trim();
          const matchedItem = sku ? items.find(i => i.sku.toLowerCase() === sku.toLowerCase()) : null;
          const product_name = matchedItem ? matchedItem.name : String(productCol ? row[productCol] : "").trim();
          const rawChannel = String(channelCol ? row[channelCol] : "shopee").toLowerCase().trim();
          const sales_channel: SalesChannel = rawChannel.includes("lazada") ? "lazada" : "shopee";
          const posted_price = Number(priceCol ? row[priceCol] : 0) || 0;
          const order_date = dateCol && row[dateCol] ? String(row[dateCol]).substring(0, 10) : new Date().toISOString().split("T")[0];

          let error: string | undefined;
          if (!product_name && !sku) error = "Missing product name or SKU";
          else if (sku && !matchedItem) error = `SKU "${sku}" not found`;
          else if (posted_price < 0) error = "Negative price";

          return { product_name, sales_channel, posted_price, order_date, sku, item_id: matchedItem?.id || null, valid: !error, error };
        });
        setBulkRows(parsed);
      } catch {
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
    for (const row of valid) {
      try {
        const orderNumber = row.sales_channel === "shopee" ? await generateShopeeOrderNumber() : await generateLazadaOrderNumber();
        await createOnlineSale({ order_number: orderNumber, product_name: row.product_name, sales_channel: row.sales_channel, posted_price: row.posted_price, order_date: row.order_date, item_id: row.item_id, notes: "" });
        success++;
      } catch { /* skip */ }
    }
    setBulkUploading(false);
    toast.success(`Uploaded ${success} sales records`);
    setBulkRows([]);
    setBulkFileName("");
    setBulkOpen(false);
    qc.invalidateQueries({ queryKey: ["online_sales"] });
  };

  const bulkValidCount = bulkRows.filter(r => r.valid).length;
  const bulkInvalidCount = bulkRows.filter(r => !r.valid).length;

  const channelLabel = (c: string) => c === "shopee" ? "Shopee" : "Lazada";
  const channelColor = (c: string) => c === "shopee" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700";

  const filtered = sales.filter((s: any) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return s.product_name?.toLowerCase().includes(q) || s.order_number?.toLowerCase().includes(q) || s.items?.sku?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Online Sales</h1>
          <p className="text-sm text-muted-foreground">Record Shopee & Lazada orders</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
            <Upload className="h-4 w-4 mr-1" /> Bulk Upload
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> Add Sale
          </Button>
        </div>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input placeholder="Search by SKU, product, order#..." value={filter} onChange={e => setFilter(e.target.value)} className="pl-9 h-9 rounded-lg text-sm" />
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Order #</TableHead>
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs">SKU</TableHead>
              <TableHead className="text-xs">Product</TableHead>
              <TableHead className="text-xs">Channel</TableHead>
              <TableHead className="text-xs text-right">Price</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No sales records found</TableCell></TableRow>
            ) : filtered.map((s: any) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono text-xs">{s.order_number}</TableCell>
                <TableCell className="text-sm">{s.order_date}</TableCell>
                <TableCell className="font-mono text-xs text-primary font-medium">{s.items?.sku || "—"}</TableCell>
                <TableCell className="text-sm font-medium">{s.product_name}</TableCell>
                <TableCell><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${channelColor(s.sales_channel)}`}>{channelLabel(s.sales_channel)}</span></TableCell>
                <TableCell className="text-right text-sm">{peso(s.posted_price)}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)}><Pencil className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMut.mutate(s.id)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingSale ? "Edit Sale" : "New Online Sale"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Inventory Item (search by SKU)</Label>
              <ItemSearch
                items={items}
                value={form.item_id}
                onChange={(itemId, item) => setForm(f => ({ ...f, item_id: itemId, product_name: item.name, posted_price: Number(item.selling_price) }))}
              />
              <p className="text-[10px] text-muted-foreground">Optional — auto-fills product name & price</p>
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Product Name</Label>
              <Input value={form.product_name} onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))} placeholder="Product name" />
            </div>
            <div className="space-y-1.5">
              <Label>Sales Channel</Label>
              <Select value={form.sales_channel} onValueChange={(v: SalesChannel) => setForm(f => ({ ...f, sales_channel: v }))} disabled={!!editingSale}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="shopee">Shopee</SelectItem>
                  <SelectItem value="lazada">Lazada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Posted Price</Label>
              <Input type="number" min={0} step="0.01" value={form.posted_price} onChange={e => setForm(f => ({ ...f, posted_price: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
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
                <p className="text-xs text-muted-foreground">Columns: <strong>SKU</strong> (preferred), <strong>Product/Name</strong>, <strong>Channel</strong>, <strong>Price</strong>, <strong>Date</strong></p>
              </div>
              <Button variant="outline" onClick={() => fileRef.current?.click()}>Select File</Button>
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
                      <TableHead className="text-xs">SKU</TableHead>
                      <TableHead className="text-xs">Product</TableHead>
                      <TableHead className="text-xs">Channel</TableHead>
                      <TableHead className="text-xs text-right">Price</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bulkRows.map((row, i) => (
                      <TableRow key={i} className={row.valid ? "" : "bg-destructive/5"}>
                        <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-mono text-xs text-primary">{row.sku || "—"}</TableCell>
                        <TableCell className="text-sm">{row.product_name || "—"}</TableCell>
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
