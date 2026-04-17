import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileSpreadsheet, AlertCircle, Check, Pencil } from "lucide-react";
import { toast } from "sonner";
import { updateItem } from "@/lib/api";
import { peso } from "@/lib/currency";
import * as XLSX from "xlsx";
import type { Item } from "@/types/database";

interface BulkEditUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: Item[];
  isAdmin: boolean;
  onSuccess: () => void;
}

interface DiffRow {
  sku: string;
  itemId: string | null;
  name: string;
  changes: { field: string; from: unknown; to: unknown }[];
  patch: Partial<Item>;
  status: "matched" | "unchanged" | "not_found" | "invalid";
  message?: string;
}

const FIELD_KEYS = ["name", "description", "quantity", "cost_price", "selling_price", "low_stock_threshold", "source"] as const;

// Map common header names → canonical field key
const HEADER_MAP: Record<string, typeof FIELD_KEYS[number]> = {
  "name": "name",
  "item": "name",
  "item name": "name",
  "product": "name",
  "product name": "name",
  "description": "description",
  "desc": "description",
  "quantity": "quantity",
  "qty": "quantity",
  "stock": "quantity",
  "cost": "cost_price",
  "cost price": "cost_price",
  "cost_price": "cost_price",
  "buying": "cost_price",
  "selling price": "selling_price",
  "selling_price": "selling_price",
  "price": "selling_price",
  "sell": "selling_price",
  "low stock threshold": "low_stock_threshold",
  "low_stock_threshold": "low_stock_threshold",
  "low stock": "low_stock_threshold",
  "low stock alert": "low_stock_threshold",
  "source": "source",
  "type": "source",
};

const normalize = (v: unknown) => String(v ?? "").trim().toLowerCase();
const numOrNull = (v: unknown): number | null => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

export default function BulkEditUploadDialog({ open, onOpenChange, items, isAdmin, onSuccess }: BulkEditUploadDialogProps) {
  const [rows, setRows] = useState<DiffRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setRows([]); setFileName(""); };

  const downloadCurrent = () => {
    const data = items.map(i => {
      const isLocal = (((i as any).source as string) || "local") === "local";
      // Non-admins see Cost Price only for local items (blank for imports)
      const showCost = isAdmin || isLocal;
      return {
        SKU: i.sku,
        Name: i.name,
        Description: i.description || "",
        Quantity: i.quantity,
        ...(showCost ? { "Cost Price": Number(i.cost_price) } : { "Cost Price": "" }),
        "Selling Price": Number(i.selling_price),
        ...(isAdmin ? { "Low Stock Threshold": i.low_stock_threshold } : {}),
        Source: (i as any).source || "local",
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 14 }, { wch: 24 }, { wch: 30 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, `inventory_edit_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

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
        // Build header → field-key map for this file
        const colToField: Record<string, typeof FIELD_KEYS[number]> = {};
        let skuCol: string | null = null;
        for (const h of headers) {
          const lower = h.toLowerCase().trim();
          if (lower === "sku" || lower.includes("sku") || lower === "code" || lower === "barcode") {
            skuCol = h;
            continue;
          }
          const mapped = HEADER_MAP[lower];
          if (mapped) colToField[h] = mapped;
        }
        if (!skuCol) { toast.error("Could not find a 'SKU' column — required to match items"); return; }

        const itemsBySku = new Map(items.map(i => [i.sku.trim().toLowerCase(), i]));

        const parsed: DiffRow[] = json.map((row) => {
          const sku = String(row[skuCol!] ?? "").trim();
          if (!sku) {
            return { sku: "", itemId: null, name: "", changes: [], patch: {}, status: "invalid", message: "Missing SKU" };
          }
          const existing = itemsBySku.get(sku.toLowerCase());
          if (!existing) {
            return { sku, itemId: null, name: String(row[headers.find(h => HEADER_MAP[h.toLowerCase()] === "name") ?? ""] ?? ""), changes: [], patch: {}, status: "not_found", message: "SKU not in inventory (skipped)" };
          }

          const changes: DiffRow["changes"] = [];
          const patch: Partial<Item> = {};

          const existingIsLocal = (((existing as any).source as string) || "local") === "local";

          for (const [col, field] of Object.entries(colToField)) {
            // Non-admins: low_stock_threshold always blocked; source change blocked; cost_price allowed only for local items
            if (!isAdmin) {
              if (field === "low_stock_threshold") continue;
              if (field === "source") continue;
              if (field === "cost_price" && !existingIsLocal) continue;
            }

            const raw = row[col];
            const oldVal = (existing as any)[field];

            if (field === "quantity" || field === "cost_price" || field === "selling_price" || field === "low_stock_threshold") {
              const newNum = numOrNull(raw);
              if (newNum === null) continue; // blank → skip
              if (Number(newNum) !== Number(oldVal)) {
                changes.push({ field, from: oldVal, to: newNum });
                (patch as any)[field] = newNum;
              }
            } else if (field === "source") {
              const v = normalize(raw);
              if (v !== "local" && v !== "import") continue;
              if (v !== normalize(oldVal || "local")) {
                changes.push({ field, from: oldVal || "local", to: v });
                (patch as any)[field] = v;
              }
            } else {
              const newStr = String(raw ?? "").trim();
              if (newStr === "" && (oldVal ?? "") !== "") continue; // don't blank-out
              if (newStr !== String(oldVal ?? "").trim()) {
                changes.push({ field, from: oldVal, to: newStr });
                (patch as any)[field] = newStr;
              }
            }
          }

          return {
            sku,
            itemId: existing.id,
            name: existing.name,
            changes,
            patch,
            status: changes.length ? "matched" : "unchanged",
          };
        });

        setRows(parsed);
        const matched = parsed.filter(r => r.status === "matched").length;
        const notFound = parsed.filter(r => r.status === "not_found").length;
        const unchanged = parsed.filter(r => r.status === "unchanged").length;
        toast.success(`${matched} to update · ${unchanged} unchanged · ${notFound} not found`);
      } catch (err) {
        console.error(err);
        toast.error("Failed to parse file");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const handleApply = async () => {
    const toUpdate = rows.filter(r => r.status === "matched" && r.itemId);
    if (toUpdate.length === 0) { toast.error("Nothing to update"); return; }
    setBusy(true);
    let ok = 0;
    let fail = 0;
    for (const r of toUpdate) {
      try {
        await updateItem(r.itemId!, r.patch);
        ok++;
      } catch (e) {
        console.error("Update failed for", r.sku, e);
        fail++;
      }
    }
    setBusy(false);
    if (ok > 0) toast.success(`Updated ${ok} items${fail ? ` (${fail} failed)` : ""}`);
    else toast.error(`All ${fail} updates failed`);
    if (ok > 0) {
      reset();
      onOpenChange(false);
      onSuccess();
    }
  };

  const matchedCount = rows.filter(r => r.status === "matched").length;
  const unchangedCount = rows.filter(r => r.status === "unchanged").length;
  const notFoundCount = rows.filter(r => r.status === "not_found").length;
  const invalidCount = rows.filter(r => r.status === "invalid").length;

  const fmtVal = (field: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return "—";
    if (field === "cost_price" || field === "selling_price") return peso(Number(v));
    return String(v);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <Pencil className="h-5 w-5" /> Bulk Edit via Excel
          </DialogTitle>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="rounded-full bg-muted p-4">
              <Upload className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-center space-y-1 max-w-md">
              <p className="text-sm font-medium">Edit inventory in Excel, then re-upload</p>
              <p className="text-xs text-muted-foreground">
                1. Download the current inventory · 2. Edit any field except SKU · 3. Re-upload — items are matched by SKU and only changed fields are updated. No new items will be created.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={downloadCurrent} className="rounded-lg" disabled={items.length === 0}>
                <FileSpreadsheet className="h-4 w-4 mr-1" /> Download Current ({items.length})
              </Button>
              <Button onClick={() => fileRef.current?.click()} className="rounded-lg">
                <Upload className="h-4 w-4 mr-1" /> Upload Edited File
              </Button>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
          </div>
        ) : (
          <div className="flex flex-col gap-3 overflow-hidden">
            <div className="flex items-center justify-between text-xs flex-wrap gap-2">
              <span className="text-muted-foreground">{fileName} — {rows.length} rows</span>
              <div className="flex gap-3 flex-wrap">
                {matchedCount > 0 && (
                  <span className="flex items-center gap-1 text-primary"><Pencil className="h-3 w-3" />{matchedCount} to update</span>
                )}
                {unchangedCount > 0 && (
                  <span className="flex items-center gap-1 text-muted-foreground"><Check className="h-3 w-3" />{unchangedCount} unchanged</span>
                )}
                {notFoundCount > 0 && (
                  <span className="flex items-center gap-1 text-amber-600"><AlertCircle className="h-3 w-3" />{notFoundCount} SKU not found</span>
                )}
                {invalidCount > 0 && (
                  <span className="flex items-center gap-1 text-destructive"><AlertCircle className="h-3 w-3" />{invalidCount} invalid</span>
                )}
              </div>
            </div>

            <div className="overflow-auto max-h-[50vh] border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-8">#</TableHead>
                    <TableHead className="text-xs">SKU</TableHead>
                    <TableHead className="text-xs">Item</TableHead>
                    <TableHead className="text-xs">Changes</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i} className={
                      row.status === "matched" ? "bg-primary/5"
                      : row.status === "not_found" ? "bg-amber-500/5"
                      : row.status === "invalid" ? "bg-destructive/5"
                      : ""
                    }>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-xs font-mono">{row.sku || "—"}</TableCell>
                      <TableCell className="text-sm">{row.name || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {row.changes.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="space-y-0.5">
                            {row.changes.map((c, k) => (
                              <div key={k} className="flex flex-wrap items-center gap-1">
                                <span className="font-medium">{c.field}:</span>
                                <span className="text-muted-foreground line-through">{fmtVal(c.field, c.from)}</span>
                                <span>→</span>
                                <span className="text-primary font-medium">{fmtVal(c.field, c.to)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.status === "matched" && <span className="text-primary">Update</span>}
                        {row.status === "unchanged" && <span className="text-muted-foreground">Unchanged</span>}
                        {row.status === "not_found" && <span className="text-amber-600">Skipped</span>}
                        {row.status === "invalid" && <span className="text-destructive">{row.message}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={reset} disabled={busy} className="rounded-lg h-9 text-sm">
                Clear
              </Button>
              <Button onClick={handleApply} disabled={busy || matchedCount === 0} className="rounded-lg h-9 text-sm">
                {busy ? "Applying..." : `Apply ${matchedCount} Update${matchedCount === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
