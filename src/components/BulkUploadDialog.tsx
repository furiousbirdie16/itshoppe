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
  qty: number;
  price: number;
  valid: boolean;
  error?: string;
}

interface BulkUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export default function BulkUploadDialog({ open, onOpenChange, onSuccess }: BulkUploadDialogProps) {
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
        const findCol = (keywords: string[]) =>
          headers.find(h => keywords.some(k => h.toLowerCase().includes(k)));

        const itemCol = findCol(["item", "name", "product", "description"]);
        const qtyCol = findCol(["qty", "quantity", "stock"]);
        const priceCol = findCol(["price", "cost", "selling", "amount"]);

        if (!itemCol) { toast.error("Could not find an 'Item' or 'Name' column"); return; }

        const parsed: ParsedRow[] = json.map((row, i) => {
          const item = String(row[itemCol] || "").trim();
          const qty = Number(qtyCol ? row[qtyCol] : 0) || 0;
          const price = Number(priceCol ? row[priceCol] : 0) || 0;

          let error: string | undefined;
          if (!item) error = "Missing item name";
          else if (qty < 0) error = "Negative quantity";
          else if (price < 0) error = "Negative price";

          return { item, qty, price, valid: !error, error };
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
          sku: row.item.substring(0, 3).toUpperCase() + "-" + String(Date.now()).slice(-4),
          description: "",
          quantity: row.qty,
          cost_price: 0,
          selling_price: row.price,
          low_stock_threshold: 10,
        });
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

  const validCount = rows.filter(r => r.valid).length;
  const invalidCount = rows.filter(r => !r.valid).length;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
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
                Columns: <strong>Item/Name</strong>, <strong>Qty/Quantity</strong>, <strong>Price</strong>
              </p>
            </div>
            <Button variant="outline" onClick={() => fileRef.current?.click()} className="rounded-lg">
              Select File
            </Button>
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
                    <TableHead className="text-xs text-right">Qty</TableHead>
                    <TableHead className="text-xs text-right">Price</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i} className={row.valid ? "" : "bg-destructive/5"}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-sm">{row.item || "—"}</TableCell>
                      <TableCell className="text-sm text-right">{row.qty}</TableCell>
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
