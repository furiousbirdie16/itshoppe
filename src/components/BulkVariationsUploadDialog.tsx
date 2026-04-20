import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileSpreadsheet, AlertCircle, Check } from "lucide-react";
import { toast } from "sonner";
import { getItems, createItemVariation } from "@/lib/api";
import { peso } from "@/lib/currency";
import * as XLSX from "xlsx";

interface ParsedRow {
  itemRef: string;        // SKU or name from sheet
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export default function BulkVariationsUploadDialog({ open, onOpenChange, onSuccess }: Props) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setRows([]); setFileName(""); };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    // Load items once for matching
    let items: { id: string; name: string; sku: string }[] = [];
    try {
      items = (await getItems()).map(i => ({ id: i.id, name: i.name, sku: i.sku }));
    } catch {
      toast.error("Failed to load inventory for matching"); return;
    }
    const bySku = new Map(items.map(i => [i.sku.toLowerCase().trim(), i]));
    const byName = new Map(items.map(i => [i.name.toLowerCase().trim(), i]));

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

        const parsed: ParsedRow[] = json.map((row) => {
          const itemRef = String(row[itemCol] || "").trim();
          const name = String(row[nameCol] || "").trim();
          const sku = skuCol ? String(row[skuCol] || "").trim() : "";
          const typeRaw = String(row[typeCol] || "").toLowerCase().trim();
          const type: "pack" | "cut" = typeRaw.startsWith("c") ? "cut" : "pack";
          const factor = Number(row[factorCol]) || 0;
          const selling_price = priceCol ? Number(row[priceCol]) || 0 : 0;

          const match = bySku.get(itemRef.toLowerCase()) || byName.get(itemRef.toLowerCase());

          let error: string | undefined;
          if (!itemRef) error = "Missing item reference";
          else if (!match) error = "Item not found";
          else if (!name) error = "Missing variation name";
          else if (!["pack", "cut"].includes(type)) error = "Type must be pack or cut";
          else if (factor <= 0) error = "Factor must be > 0";
          else if (selling_price < 0) error = "Negative price";

          return {
            itemRef, matchedItemId: match?.id, matchedItemLabel: match ? `${match.name} (${match.sku})` : undefined,
            name, sku, type, factor, selling_price, valid: !error, error,
          };
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
    const valid = rows.filter(r => r.valid && r.matchedItemId);
    if (valid.length === 0) { toast.error("No valid rows to upload"); return; }
    setUploading(true);
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
    setUploading(false);
    toast.success(`Created ${success} variations${failed ? `, ${failed} failed` : ""}`);
    reset();
    onOpenChange(false);
    onSuccess();
  };

  const downloadTemplate = () => {
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

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Bulk Upload Variations
          </DialogTitle>
        </DialogHeader>

        {rows.length === 0 ? (
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
              <Button variant="outline" onClick={downloadTemplate} className="rounded-lg">
                <FileSpreadsheet className="h-4 w-4 mr-1" /> Download Template
              </Button>
              <Button onClick={() => fileRef.current?.click()} className="rounded-lg">Select File</Button>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
          </div>
        ) : (
          <div className="flex flex-col gap-3 overflow-hidden">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{fileName} — {rows.length} rows</span>
              <div className="flex gap-3">
                {validCount > 0 && (
                  <span className="flex items-center gap-1 text-success"><Check className="h-3 w-3" />{validCount} valid</span>
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
                    <TableHead className="text-xs">Parent Item</TableHead>
                    <TableHead className="text-xs">Variation</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs text-right">Factor</TableHead>
                    <TableHead className="text-xs text-right">Price</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
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
                        {row.valid ? <span className="text-success">✓</span> : <span className="text-destructive">{row.error}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={reset} className="rounded-lg h-9 text-sm">Clear</Button>
              <Button onClick={handleUpload} disabled={uploading || validCount === 0} className="rounded-lg h-9 text-sm">
                {uploading ? "Uploading..." : `Upload ${validCount} Variations`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
