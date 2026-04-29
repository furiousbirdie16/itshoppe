import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Upload, FileSpreadsheet, AlertCircle, Check } from "lucide-react";
import { toast } from "sonner";
import { createItem, getItems, createItemVariation } from "@/lib/api";
import { peso } from "@/lib/currency";
import * as XLSX from "xlsx";

interface ParsedItemRow {
  item: string;
  description: string;
  sku: string;
  source: "local" | "import";
  base_unit: string;
  units_per_stock: number;
  open_roll_remaining: number;
  warehouse_qty: number;
  store_qty: number;
  low_stock_threshold: number;
  cost: number;
  cost_rmb: number;
  price: number;
  valid: boolean;
  error?: string;
}

interface ParsedVariationRow {
  itemRef: string;
  matchedItemId?: string;
  matchedItemLabel?: string;
  name: string;
  sku: string;
  type: "pack" | "cut";
  factor: number;
  selling_price: number;
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
  const [tab, setTab] = useState<"items" | "variations">("items");

  // Items state
  const [rows, setRows] = useState<ParsedItemRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Variations state
  const [vRows, setVRows] = useState<ParsedVariationRow[]>([]);
  const [vUploading, setVUploading] = useState(false);
  const [vFileName, setVFileName] = useState("");
  const vFileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setRows([]); setFileName(""); setVRows([]); setVFileName(""); };

  // ============ ITEMS ============
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
        const sourceCol = findCol(["source"]);
        const baseUnitCol = findCol(["base unit", "base_unit", "unit"], ["units per", "units_per"]);
        const unitsPerCol = findCol(["units per", "units_per"]);
        const openRollCol = findCol(["open roll", "open_roll", "remaining"]);
        const warehouseCol = findCol(["warehouse", "wh"]);
        const storeCol = findCol(["store", "shop"]);
        const qtyCol = findCol(["qty", "quantity", "stock"], ["warehouse", "wh", "store", "shop", "low"]);
        const lowStockCol = findCol(["low stock", "low_stock", "threshold", "alert"]);
        const costCol = findCol(["cost", "buying"], ["rmb", "¥"]);
        const costRmbCol = findCol(["rmb", "cost rmb", "cost_rmb", "¥"]);
        const priceCol = findCol(["price", "selling", "amount"], ["cost"]);

        if (!itemCol) { toast.error("Could not find an 'Item' or 'Name' column"); return; }
        if (!skuCol) { toast.error("Could not find a 'SKU' column"); return; }

        const parsed: ParsedItemRow[] = json.map((row) => {
          const item = String(row[itemCol] || "").trim();
          const description = String(descCol ? row[descCol] || "" : "").trim();
          const sku = String(skuCol ? row[skuCol] || "" : "").trim();
          const sourceRaw = String(sourceCol ? row[sourceCol] || "" : "").toLowerCase().trim();
          const source: "local" | "import" = sourceRaw.startsWith("i") ? "import" : "local";
          const base_unit = String(baseUnitCol ? row[baseUnitCol] || "" : "").trim() || "pcs";
          const units_per_stock = Number(unitsPerCol ? row[unitsPerCol] : 1) || 1;
          const open_roll_remaining = Number(openRollCol ? row[openRollCol] : 0) || 0;
          const warehouse_qty_raw = warehouseCol ? Number(row[warehouseCol]) || 0 : NaN;
          const store_qty_raw = storeCol ? Number(row[storeCol]) || 0 : NaN;
          const fallback_qty = qtyCol ? Number(row[qtyCol]) || 0 : 0;
          const warehouse_qty = !isNaN(warehouse_qty_raw) ? warehouse_qty_raw : (isNaN(store_qty_raw) ? fallback_qty : 0);
          const store_qty = !isNaN(store_qty_raw) ? store_qty_raw : 0;
          const low_stock_threshold = Number(lowStockCol ? row[lowStockCol] : 10) || 10;
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
          else if (units_per_stock <= 0) error = "Units per stock must be > 0";

          return { item, description, sku, source, base_unit, units_per_stock, open_roll_remaining, warehouse_qty, store_qty, low_stock_threshold, cost, cost_rmb, price, valid: !error, error };
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
          source: row.source,
          base_unit: row.base_unit,
          units_per_stock: row.units_per_stock,
          open_roll_remaining: row.open_roll_remaining,
          warehouse_quantity: row.warehouse_qty,
          store_quantity: row.store_qty,
          cost_price: row.cost,
          ...(isAdmin ? { cost_price_rmb: row.cost_rmb } : {}),
          selling_price: row.price,
          low_stock_threshold: row.low_stock_threshold,
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
    const base = {
      "Item": "Sample Product A",
      "SKU": "SKU-001",
      "Description": "Brief description",
      "Source": "local",
      "Base Unit": "pcs",
      "Units Per Stock": 1,
      "Open Roll Remaining": 0,
      "Warehouse Qty": 8,
      "Store Qty": 2,
      "Low Stock Threshold": 10,
      "Cost": 50,
      ...(isAdmin ? { "Cost RMB": 12.5 } : {}),
      "Price": 100,
    };
    const base2 = {
      "Item": "Sample Product B",
      "SKU": "SKU-002",
      "Description": "",
      "Source": "import",
      "Base Unit": "m",
      "Units Per Stock": 100,
      "Open Roll Remaining": 0,
      "Warehouse Qty": 20,
      "Store Qty": 5,
      "Low Stock Threshold": 5,
      "Cost": 120,
      ...(isAdmin ? { "Cost RMB": 30 } : {}),
      "Price": 250,
    };
    const ws = XLSX.utils.json_to_sheet([base, base2]);
    ws["!cols"] = Object.keys(base).map(() => ({ wch: 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, "inventory_template.xlsx");
  };

  // ============ VARIATIONS ============
  const handleVFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVFileName(file.name);

    let items: { id: string; name: string; sku: string }[] = [];
    try {
      items = (await getItems()).map(i => ({ id: i.id, name: i.name, sku: i.sku }));
    } catch {
      toast.error("Failed to load inventory for matching"); return;
    }
    const bySku = new Map(items.map(i => [i.sku.toLowerCase().trim(), i]));

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
        if (json.length === 0) { toast.error("File is empty"); return; }

        const headers = Object.keys(json[0]);
        const findCol = (keywords: string[]) =>
          headers.find(h => keywords.some(k => h.toLowerCase().includes(k)));

        const itemCol = findCol(["item sku", "parent sku", "item_sku", "parent"]) || findCol(["item", "product", "name"]);
        const nameCol = findCol(["variation name", "variation", "name"]);
        const skuCol = findCol(["variation sku", "var sku", "var_sku"]);
        const typeCol = findCol(["type"]);
        const factorCol = findCol(["factor", "qty", "pcs", "meters", "size"]);
        const priceCol = findCol(["price", "selling"]);

        if (!itemCol) { toast.error("Missing 'Item SKU' or 'Item' column"); return; }
        if (!nameCol) { toast.error("Missing 'Variation Name' column"); return; }
        if (!typeCol) { toast.error("Missing 'Type' column (pack/cut)"); return; }
        if (!factorCol) { toast.error("Missing 'Factor' column"); return; }

        const parsed: ParsedVariationRow[] = json.map((row) => {
          const itemRef = String(row[itemCol] || "").trim();
          const name = String(row[nameCol] || "").trim();
          const sku = skuCol ? String(row[skuCol] || "").trim() : "";
          const typeRaw = String(row[typeCol] || "").toLowerCase().trim();
          const type: "pack" | "cut" = typeRaw.startsWith("c") ? "cut" : "pack";
          const factor = Number(row[factorCol]) || 0;
          const selling_price = priceCol ? Number(row[priceCol]) || 0 : 0;

          const match = bySku.get(itemRef.toLowerCase());

          let error: string | undefined;
          if (!itemRef) error = "Missing item SKU";
          else if (!match) error = `SKU "${itemRef}" not found in inventory`;
          else if (!name) error = "Missing variation name";
          else if (!["pack", "cut"].includes(type)) error = "Type must be pack or cut";
          else if (factor <= 0) error = "Factor must be > 0";
          else if (selling_price < 0) error = "Negative price";

          return {
            itemRef, matchedItemId: match?.id, matchedItemLabel: match ? `${match.name} (${match.sku})` : undefined,
            name, sku, type, factor, selling_price, valid: !error, error,
          };
        });

        setVRows(parsed);
      } catch {
        toast.error("Failed to parse file");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const handleVUpload = async () => {
    const valid = vRows.filter(r => r.valid && r.matchedItemId);
    if (valid.length === 0) { toast.error("No valid rows to upload"); return; }
    setVUploading(true);
    let success = 0, failed = 0;
    for (const row of valid) {
      try {
        await createItemVariation({
          item_id: row.matchedItemId!,
          name: row.name,
          sku: row.sku || null,
          type: row.type,
          factor: row.factor,
          selling_price: row.selling_price,
        } as never);
        success++;
      } catch { failed++; }
    }
    setVUploading(false);
    toast.success(`Created ${success} variations${failed ? `, ${failed} failed` : ""}`);
    reset();
    onOpenChange(false);
    onSuccess();
  };

  const downloadVTemplate = () => {
    const template = [
      { "Item SKU": "DCM-001", "Variation Name": "DC male 5pcs pack", "Variation SKU": "DCM-001-5", "Type": "pack", "Factor": 5, "Selling Price": 75 },
      { "Item SKU": "DCM-001", "Variation Name": "DC male 10pcs pack", "Variation SKU": "DCM-001-10", "Type": "pack", "Factor": 10, "Selling Price": 140 },
      { "Item SKU": "CAT6-CCA", "Variation Name": "CAT6 CCA 50m cut", "Variation SKU": "", "Type": "cut", "Factor": 50, "Selling Price": 850 },
    ];
    const ws = XLSX.utils.json_to_sheet(template);
    ws["!cols"] = [{ wch: 14 }, { wch: 26 }, { wch: 16 }, { wch: 8 }, { wch: 8 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Variations");
    XLSX.writeFile(wb, "variations_template.xlsx");
  };

  const validCount = rows.filter(r => r.valid).length;
  const invalidCount = rows.filter(r => !r.valid).length;
  const vValidCount = vRows.filter(r => r.valid).length;
  const vInvalidCount = vRows.filter(r => !r.valid).length;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Bulk Upload
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "items" | "variations")} className="flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-2 max-w-sm">
            <TabsTrigger value="items">Items</TabsTrigger>
            <TabsTrigger value="variations">Variations</TabsTrigger>
          </TabsList>

          <TabsContent value="items" className="flex-1 overflow-hidden mt-4">
            {rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <div className="rounded-full bg-muted p-4">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                </div>
                <div className="text-center space-y-1 max-w-xl">
                  <p className="text-sm font-medium">Upload an Excel file (.xlsx, .xls)</p>
                  <p className="text-xs text-muted-foreground">
                    Columns: <strong>Item</strong>, <strong>SKU</strong>, <strong>Description</strong>, <strong>Source</strong> (local/import), <strong>Base Unit</strong>, <strong>Units Per Stock</strong>, <strong>Open Roll Remaining</strong>, <strong>Warehouse Qty</strong>, <strong>Store Qty</strong>, <strong>Low Stock Threshold</strong>, <strong>Cost</strong>{isAdmin ? <>, <strong>Cost RMB</strong></> : null}, <strong>Price</strong>
                  </p>
                  <p className="text-[11px] text-muted-foreground">Missing optional columns use sensible defaults (source=local, base unit=pcs, units per stock=1, low stock=10).</p>
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

                <div className="overflow-auto max-h-[45vh] border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs w-8">#</TableHead>
                        <TableHead className="text-xs">Item</TableHead>
                        <TableHead className="text-xs">SKU</TableHead>
                        <TableHead className="text-xs">Source</TableHead>
                        <TableHead className="text-xs">Base Unit</TableHead>
                        <TableHead className="text-xs text-right">Units/Stock</TableHead>
                        <TableHead className="text-xs text-right">Warehouse</TableHead>
                        <TableHead className="text-xs text-right">Store</TableHead>
                        <TableHead className="text-xs text-right">Low Stock</TableHead>
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
                          <TableCell className="text-xs uppercase">{row.source}</TableCell>
                          <TableCell className="text-xs">{row.base_unit}</TableCell>
                          <TableCell className="text-sm text-right">{row.units_per_stock}</TableCell>
                          <TableCell className="text-sm text-right">{row.warehouse_qty}</TableCell>
                          <TableCell className="text-sm text-right">{row.store_qty}</TableCell>
                          <TableCell className="text-sm text-right">{row.low_stock_threshold}</TableCell>
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
                  <Button variant="outline" onClick={() => { setRows([]); setFileName(""); }} className="rounded-lg h-9 text-sm">
                    Clear
                  </Button>
                  <Button onClick={handleUpload} disabled={uploading || validCount === 0} className="rounded-lg h-9 text-sm">
                    {uploading ? "Uploading..." : `Upload ${validCount} Items`}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="variations" className="flex-1 overflow-hidden mt-4">
            {vRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <div className="rounded-full bg-muted p-4">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">Upload an Excel file (.xlsx, .xls)</p>
                  <p className="text-xs text-muted-foreground max-w-md">
                    Columns: <strong>Item SKU</strong> (matches parent), <strong>Variation Name</strong>, <strong>Type</strong> (pack/cut),
                    <strong> Factor</strong> (pcs per pack or meters per cut), <strong>Selling Price</strong>, optional <strong>Variation SKU</strong>.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={downloadVTemplate} className="rounded-lg">
                    <FileSpreadsheet className="h-4 w-4 mr-1" /> Download Template
                  </Button>
                  <Button onClick={() => vFileRef.current?.click()} className="rounded-lg">Select File</Button>
                </div>
                <input ref={vFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleVFile} className="hidden" />
              </div>
            ) : (
              <div className="flex flex-col gap-3 overflow-hidden">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{vFileName} — {vRows.length} rows</span>
                  <div className="flex gap-3">
                    {vValidCount > 0 && (
                      <span className="flex items-center gap-1 text-green-600"><Check className="h-3 w-3" />{vValidCount} valid</span>
                    )}
                    {vInvalidCount > 0 && (
                      <span className="flex items-center gap-1 text-destructive"><AlertCircle className="h-3 w-3" />{vInvalidCount} invalid</span>
                    )}
                  </div>
                </div>

                <div className="overflow-auto max-h-[45vh] border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs w-8">#</TableHead>
                        <TableHead className="text-xs">Parent Item</TableHead>
                        <TableHead className="text-xs">Variation</TableHead>
                        <TableHead className="text-xs">Type</TableHead>
                        <TableHead className="text-xs text-right">Factor</TableHead>
                        <TableHead className="text-xs text-right">Price</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vRows.map((row, i) => (
                        <TableRow key={i} className={row.valid ? "" : "bg-destructive/5"}>
                          <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="text-sm">
                            {row.matchedItemLabel || <span className="text-destructive">{row.itemRef || "—"}</span>}
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.name || "—"}
                            {row.sku && <div className="text-[10px] font-mono text-muted-foreground">{row.sku}</div>}
                          </TableCell>
                          <TableCell className="text-xs uppercase">{row.type}</TableCell>
                          <TableCell className="text-sm text-right">{row.factor}</TableCell>
                          <TableCell className="text-sm text-right">{peso(row.selling_price)}</TableCell>
                          <TableCell className="text-xs">
                            {row.valid ? <span className="text-green-600">✓</span> : <span className="text-destructive">{row.error}</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => { setVRows([]); setVFileName(""); }} className="rounded-lg h-9 text-sm">Clear</Button>
                  <Button onClick={handleVUpload} disabled={vUploading || vValidCount === 0} className="rounded-lg h-9 text-sm">
                    {vUploading ? "Uploading..." : `Upload ${vValidCount} Variations`}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
