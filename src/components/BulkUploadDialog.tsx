import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileSpreadsheet, AlertCircle, Check } from "lucide-react";
import { toast } from "sonner";
import { createItem } from "@/lib/api";
import { peso } from "@/lib/currency";
import * as XLSX from "xlsx";

interface ParsedRow {
  item: string;
  description: string;
  sku: string;
  warehouse_qty: number;
  store_qty: number;
  cost: number;
  cost_rmb: number;
  price: number;
  valid: boolean;
  error?: string;
}

interface BulkUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  isAdmin?: boolean;
}

export default function BulkUploadDialog({ open, onOpenChange, onSuccess, isAdmin = false }: BulkUploadDialogProps) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setRows([]); setFileName(""); };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

        if (json.length === 0) { toast.error("File is empty"); return; }

        // Find columns by common names (case-insensitive)
        const headers = Object.keys(json[0]);
        const findCol = (keywords: string[], excludeKeywords: string[] = []) =>
          headers.find(h => {
            const lower = h.toLowerCase();
            if (excludeKeywords.some(k => lower.includes(k))) return false;
            return keywords.some(k => lower.includes(k));
          });

        const itemCol = findCol(["item", "name", "product"]);
        const descCol = findCol(["description", "desc"]);
        const skuCol = findCol(["sku", "code", "barcode"]);
        const warehouseCol = findCol(["warehouse", "wh"]);
        const storeCol = findCol(["store", "shop"]);
        // Generic qty (used as fallback when warehouse/store not split)
        const qtyCol = findCol(["qty", "quantity", "stock"], ["warehouse", "wh", "store", "shop"]);
        const costCol = findCol(["cost", "buying"], ["rmb", "¥"]);
        const costRmbCol = findCol(["rmb", "cost rmb", "cost_rmb", "¥"]);
        const priceCol = findCol(["price", "selling", "amount"], ["cost"]);

        if (!itemCol) { toast.error("Could not find an 'Item' or 'Name' column"); return; }
        if (!skuCol) { toast.error("Could not find a 'SKU' column"); return; }

        const parsed: ParsedRow[] = json.map((row) => {
          const item = String(row[itemCol] || "").trim();
          const description = String(descCol ? row[descCol] || "" : "").trim();
          const sku = String(skuCol ? row[skuCol] || "" : "").trim();
          const warehouse_qty_raw = warehouseCol ? Number(row[warehouseCol]) || 0 : NaN;
          const store_qty_raw = storeCol ? Number(row[storeCol]) || 0 : NaN;
          const fallback_qty = qtyCol ? Number(row[qtyCol]) || 0 : 0;
          const warehouse_qty = !isNaN(warehouse_qty_raw) ? warehouse_qty_raw : (isNaN(store_qty_raw) ? fallback_qty : 0);
          const store_qty = !isNaN(store_qty_raw) ? store_qty_raw : 0;
          const cost = Number(costCol ? row[costCol] : 0) || 0;
          const cost_rmb = isAdmin ? (Number(costRmbCol ? row[costRmbCol] : 0) || 0) : 0;
          const price = Number(priceCol ? row[priceCol] : 0) || 0;

          let error: string | undefined;
          if (!item) error = "Missing item name";
          else if (!sku) error = "Missing SKU";
          else if (warehouse_qty < 0) error = "Negative warehouse qty";
          else if (store_qty < 0) error = "Negative store qty";
          else if (cost < 0) error = "Negative cost";
          else if (cost_rmb < 0) error = "Negative RMB cost";
          else if (price < 0) error = "Negative price";

          return { item, description, sku, warehouse_qty, store_qty, cost, cost_rmb, price, valid: !error, error };
        });

        setRows(parsed);
      } catch {
        toast.error("Failed to parse file");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const handleUpload = async () => {
    const valid = rows.filter(r => r.valid);
    if (valid.length === 0) { toast.error("No valid rows to upload"); return; }

    setUploading(true);
    let success = 0;
    let failed = 0;

    for (const row of valid) {
      try {
        await createItem({
          name: row.item,
          sku: row.sku,
          description: row.description,
          warehouse_quantity: row.warehouse_qty,
          store_quantity: row.store_qty,
          cost_price: row.cost,
          ...(isAdmin ? { cost_price_rmb: row.cost_rmb } : {}),
          selling_price: row.price,
          low_stock_threshold: 10,
        } as any);
        success++;
      } catch {
        failed++;
      }
    }

    setUploading(false);
    toast.success(`Uploaded ${success} items${failed ? `, ${failed} failed` : ""}`);
    reset();
    onOpenChange(false);
    onSuccess();
  };

  const downloadTemplate = () => {
    const template = isAdmin ? [
      { "Item": "Sample Product A", "SKU": "SKU-001", "Description": "Brief description", "Warehouse Qty": 8, "Store Qty": 2, "Cost": 50, "Cost RMB": 12.5, "Price": 100 },
      { "Item": "Sample Product B", "SKU": "SKU-002", "Description": "", "Warehouse Qty": 20, "Store Qty": 5, "Cost": 120, "Cost RMB": 30, "Price": 250 },
    ] : [
      { "Item": "Sample Product A", "SKU": "SKU-001", "Description": "Brief description", "Warehouse Qty": 8, "Store Qty": 2, "Cost": 50, "Price": 100 },
      { "Item": "Sample Product B", "SKU": "SKU-002", "Description": "", "Warehouse Qty": 20, "Store Qty": 5, "Cost": 120, "Price": 250 },
    ];
    const ws = XLSX.utils.json_to_sheet(template);
    ws["!cols"] = [{ wch: 24 }, { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, "inventory_template.xlsx");
  };

  const validCount = rows.filter(r => r.valid).length;
  const invalidCount = rows.filter(r => !r.valid).length;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Bulk Upload Items
          </DialogTitle>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="rounded-full bg-muted p-4">
              <Upload className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">Upload an Excel file (.xlsx, .xls)</p>
              <p className="text-xs text-muted-foreground">
                Columns: <strong>Item/Name</strong>, <strong>SKU</strong>, <strong>Description</strong>, <strong>Warehouse Qty</strong>, <strong>Store Qty</strong>, <strong>Cost</strong>{isAdmin ? <>, <strong>Cost RMB</strong></> : null}, <strong>Price</strong>
              </p>
              <p className="text-[11px] text-muted-foreground">A single <strong>Qty</strong> column is also accepted (loaded into Warehouse).</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={downloadTemplate} className="rounded-lg">
                <FileSpreadsheet className="h-4 w-4 mr-1" /> Download Template
              </Button>
              <Button onClick={() => fileRef.current?.click()} className="rounded-lg">
                Select File
              </Button>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
          </div>
        ) : (
          <div className="flex flex-col gap-3 overflow-hidden">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{fileName} — {rows.length} rows</span>
              <div className="flex gap-3">
                {validCount > 0 && (
                  <span className="flex items-center gap-1 text-green-600"><Check className="h-3 w-3" />{validCount} valid</span>
                )}
                {invalidCount > 0 && (
                  <span className="flex items-center gap-1 text-destructive"><AlertCircle className="h-3 w-3" />{invalidCount} invalid</span>
                )}
              </div>
            </div>

            <div className="overflow-auto max-h-[40vh] border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-8">#</TableHead>
                    <TableHead className="text-xs">Item</TableHead>
                    <TableHead className="text-xs">SKU</TableHead>
                    <TableHead className="text-xs">Description</TableHead>
                    <TableHead className="text-xs text-right">Warehouse</TableHead>
                    <TableHead className="text-xs text-right">Store</TableHead>
                    <TableHead className="text-xs text-right">Cost</TableHead>
                    {isAdmin && <TableHead className="text-xs text-right">Cost RMB</TableHead>}
                    <TableHead className="text-xs text-right">Price</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i} className={row.valid ? "" : "bg-destructive/5"}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-sm">{row.item || "—"}</TableCell>
                      <TableCell className="text-sm">{row.sku || "—"}</TableCell>
                      <TableCell className="text-sm truncate max-w-[120px]">{row.description || "—"}</TableCell>
                      <TableCell className="text-sm text-right">{row.warehouse_qty}</TableCell>
                      <TableCell className="text-sm text-right">{row.store_qty}</TableCell>
                      <TableCell className="text-sm text-right">{peso(row.cost)}</TableCell>
                      {isAdmin && <TableCell className="text-sm text-right">¥{row.cost_rmb}</TableCell>}
                      <TableCell className="text-sm text-right">{peso(row.price)}</TableCell>
                      <TableCell className="text-xs">
                        {row.valid ? (
                          <span className="text-green-600">✓</span>
                        ) : (
                          <span className="text-destructive">{row.error}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={reset} className="rounded-lg h-9 text-sm">
                Clear
              </Button>
              <Button onClick={handleUpload} disabled={uploading || validCount === 0} className="rounded-lg h-9 text-sm">
                {uploading ? "Uploading..." : `Upload ${validCount} Items`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
