import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileSpreadsheet, AlertCircle, Check } from "lucide-react";
import { toast } from "sonner";
import {
  createOverseasPurchaseOrder,
  createOverseasPOItems,
  generateOverseasPONumber,
  getOverseasSuppliers,
} from "@/lib/api";
import * as XLSX from "xlsx";

interface ParsedRow {
  poNumber: string;
  supplierName: string;
  currency: string;
  exchangeRate: number;
  orderDate: string;
  estimatedArrival: string;
  notes: string;
  itemName: string;
  description: string;
  quantity: number;
  unitCost: number;
  valid: boolean;
  error?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const toDateString = (v: unknown): string => {
  if (!v) return "";
  if (typeof v === "number") {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  if (!s) return "";
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s;
};

export default function OverseasPOBulkUploadDialog({ open, onOpenChange, onSuccess }: Props) {
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
        const wb = XLSX.read(evt.target?.result, { type: "array", cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
        if (json.length === 0) { toast.error("File is empty"); return; }

        const headers = Object.keys(json[0]);
        const findCol = (keywords: string[]) =>
          headers.find(h => keywords.some(k => h.toLowerCase().includes(k)));

        const poCol = findCol(["po #", "po#", "po number", "po_number", "po"]);
        const supplierCol = findCol(["supplier"]);
        const currencyCol = findCol(["currency"]);
        const rateCol = findCol(["exchange", "rate"]);
        const orderDateCol = findCol(["order date", "date ordered", "order_date"]);
        const arrivalCol = findCol(["arrival", "estimated", "expected"]);
        const notesCol = findCol(["notes"]);
        const itemCol = findCol(["item", "product"]);
        const descCol = findCol(["description", "desc"]);
        const qtyCol = findCol(["qty", "quantity"]);
        const costCol = findCol(["cost", "unit_cost", "unit cost", "price"]);

        if (!poCol) { toast.error("Could not find a 'PO #' column"); return; }
        if (!itemCol) { toast.error("Could not find an 'Item' column"); return; }

        const parsed: ParsedRow[] = json.map((row) => {
          const poNumber = String(row[poCol] || "").trim();
          const supplierName = String(supplierCol ? row[supplierCol] || "" : "").trim();
          const currency = String(currencyCol ? row[currencyCol] || "USD" : "USD").trim().toUpperCase() || "USD";
          const exchangeRate = Number(rateCol ? row[rateCol] : 1) || 1;
          const orderDate = toDateString(orderDateCol ? row[orderDateCol] : "");
          const estimatedArrival = toDateString(arrivalCol ? row[arrivalCol] : "");
          const notes = String(notesCol ? row[notesCol] || "" : "").trim();
          const itemName = String(row[itemCol] || "").trim();
          const description = String(descCol ? row[descCol] || "" : "").trim();
          const quantity = Number(qtyCol ? row[qtyCol] : 0) || 0;
          const unitCost = Number(costCol ? row[costCol] : 0) || 0;

          let error: string | undefined;
          if (!poNumber) error = "Missing PO #";
          else if (!itemName) error = "Missing item";
          else if (quantity <= 0) error = "Qty must be > 0";
          else if (unitCost < 0) error = "Negative cost";

          return {
            poNumber, supplierName, currency, exchangeRate, orderDate, estimatedArrival,
            notes, itemName, description, quantity, unitCost,
            valid: !error, error,
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
    const valid = rows.filter(r => r.valid);
    if (valid.length === 0) { toast.error("No valid rows to upload"); return; }

    setUploading(true);

    // Group by PO #
    const groups = new Map<string, ParsedRow[]>();
    for (const r of valid) {
      const arr = groups.get(r.poNumber) || [];
      arr.push(r);
      groups.set(r.poNumber, arr);
    }

    // Resolve suppliers by name (case-insensitive)
    const suppliers = await getOverseasSuppliers();
    const supplierByName = new Map(suppliers.map(s => [s.name.toLowerCase(), s]));

    let posCreated = 0;
    let itemsCreated = 0;
    let failed = 0;

    for (const [, groupRows] of groups) {
      try {
        const first = groupRows[0];
        const sup = first.supplierName ? supplierByName.get(first.supplierName.toLowerCase()) : null;
        const total = groupRows.reduce((s, r) => s + r.quantity * r.unitCost, 0);
        const poNumber = await generateOverseasPONumber();

        const po = await createOverseasPurchaseOrder({
          po_number: poNumber,
          supplier_id: sup?.id || null,
          status: "unpaid",
          order_date: first.orderDate || new Date().toISOString().slice(0, 10),
          expected_delivery: first.estimatedArrival || null,
          notes: first.notes,
          total_amount: total,
          currency: (sup?.currency as string) || first.currency || "USD",
          exchange_rate: sup?.exchange_rate ?? first.exchangeRate ?? 1,
        } as any);

        await createOverseasPOItems(groupRows.map(r => ({
          po_id: po.id,
          item_name: r.itemName,
          description: r.description,
          quantity: r.quantity,
          unit_cost: r.unitCost,
          item_id: null,
        })));

        posCreated++;
        itemsCreated += groupRows.length;
      } catch {
        failed++;
      }
    }

    setUploading(false);
    toast.success(`Created ${posCreated} POs with ${itemsCreated} items${failed ? `, ${failed} failed` : ""}`);
    reset();
    onOpenChange(false);
    onSuccess();
  };

  const downloadTemplate = () => {
    const template = [
      { "PO #": "OPO-A", "Supplier": "Supplier ABC", "Currency": "USD", "Exchange Rate": 56.5, "Order Date": "2026-04-17", "Estimated Arrival": "2026-05-17", "Notes": "Sample order", "Item": "Product A", "Description": "Black variant", "Qty": 10, "Unit Cost": 5 },
      { "PO #": "OPO-A", "Supplier": "Supplier ABC", "Currency": "USD", "Exchange Rate": 56.5, "Order Date": "2026-04-17", "Estimated Arrival": "2026-05-17", "Notes": "Sample order", "Item": "Product B", "Description": "White variant", "Qty": 5, "Unit Cost": 8 },
      { "PO #": "OPO-B", "Supplier": "Supplier XYZ", "Currency": "RMB", "Exchange Rate": 7.8, "Order Date": "2026-04-18", "Estimated Arrival": "2026-05-25", "Notes": "", "Item": "Product C", "Description": "", "Qty": 20, "Unit Cost": 35 },
    ];
    const ws = XLSX.utils.json_to_sheet(template);
    ws["!cols"] = [{ wch: 10 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 8 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Overseas POs");
    XLSX.writeFile(wb, "overseas_po_template.xlsx");
  };

  const validCount = rows.filter(r => r.valid).length;
  const invalidCount = rows.filter(r => !r.valid).length;
  const groupCount = new Set(rows.filter(r => r.valid).map(r => r.poNumber)).size;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Bulk Upload Overseas POs
          </DialogTitle>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="rounded-full bg-muted p-4">
              <Upload className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-center space-y-1 max-w-md">
              <p className="text-sm font-medium">Upload an Excel file (.xlsx, .xls)</p>
              <p className="text-xs text-muted-foreground">
                Rows with the same <strong>PO #</strong> are combined into one PO. Each row = one line item.
              </p>
              <p className="text-xs text-muted-foreground">
                Columns: <strong>PO #</strong>, Supplier, Currency, Exchange Rate, Order Date, Estimated Arrival, Notes, <strong>Item</strong>, Description, <strong>Qty</strong>, Unit Cost
              </p>
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
              <span className="text-muted-foreground">{fileName} — {rows.length} rows → {groupCount} POs</span>
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
                    <TableHead className="text-xs">PO #</TableHead>
                    <TableHead className="text-xs">Supplier</TableHead>
                    <TableHead className="text-xs">Item</TableHead>
                    <TableHead className="text-xs text-right">Qty</TableHead>
                    <TableHead className="text-xs text-right">Unit Cost</TableHead>
                    <TableHead className="text-xs">Order Date</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i} className={row.valid ? "" : "bg-destructive/5"}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-sm font-medium">{row.poNumber || "—"}</TableCell>
                      <TableCell className="text-sm">{row.supplierName || "—"}</TableCell>
                      <TableCell className="text-sm">{row.itemName || "—"}</TableCell>
                      <TableCell className="text-sm text-right">{row.quantity}</TableCell>
                      <TableCell className="text-sm text-right">{row.unitCost} {row.currency}</TableCell>
                      <TableCell className="text-xs">{row.orderDate || "—"}</TableCell>
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
                {uploading ? "Uploading..." : `Create ${groupCount} POs`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
