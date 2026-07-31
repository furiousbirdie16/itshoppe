import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileSpreadsheet, AlertCircle, Check, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { updateItem, updateItemVariation, setBranchQuantities } from "@/lib/api";
import { useBranch } from "@/contexts/BranchContext";
import { peso } from "@/lib/currency";
import * as XLSX from "xlsx";
import type { Item, ItemVariation } from "@/types/database";

interface BulkEditUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: Item[];
  isAdmin: boolean;
  onSuccess: () => void;
}

type ItemField = "name" | "sku" | "description" | "warehouse_quantity" | "store_quantity" | "cost_price" | "cost_price_rmb" | "selling_price" | "low_stock_threshold" | "source";
type VarField = "name" | "sku" | "type" | "factor" | "selling_price" | "cost_price";

interface DiffRow {
  kind: "item" | "variation";
  matchKey: string; // SKU or ID shown
  targetId: string | null;
  parentName: string;
  name: string;
  changes: { field: string; from: unknown; to: unknown }[];
  patch: Record<string, unknown>;
  status: "matched" | "unchanged" | "not_found" | "invalid";
  message?: string;
}

// Items header → field
const ITEM_HEADER_MAP: Record<string, ItemField> = {
  "name": "name", "item": "name", "item name": "name", "product": "name", "product name": "name",
  "sku": "sku", "code": "sku", "barcode": "sku",
  "description": "description", "desc": "description",
  "warehouse": "warehouse_quantity", "warehouse qty": "warehouse_quantity", "warehouse quantity": "warehouse_quantity", "wh qty": "warehouse_quantity", "wh": "warehouse_quantity", "warehouse_quantity": "warehouse_quantity",
  "store": "store_quantity", "store qty": "store_quantity", "store quantity": "store_quantity", "shop qty": "store_quantity", "store_quantity": "store_quantity",
  "cost": "cost_price", "cost price": "cost_price", "cost_price": "cost_price", "buying": "cost_price",
  "cost rmb": "cost_price_rmb", "cost price rmb": "cost_price_rmb", "cost_price_rmb": "cost_price_rmb", "rmb cost": "cost_price_rmb", "rmb": "cost_price_rmb",
  "selling price": "selling_price", "selling_price": "selling_price", "price": "selling_price", "sell": "selling_price", "sell price": "selling_price",
  "low stock threshold": "low_stock_threshold", "low_stock_threshold": "low_stock_threshold", "low stock": "low_stock_threshold", "threshold": "low_stock_threshold", "low stock alert": "low_stock_threshold",
  "source": "source", "type": "source",
};

// Variations header → field
const VAR_HEADER_MAP: Record<string, VarField> = {
  "variation name": "name", "variation": "name", "name": "name",
  "variation sku": "sku", "sku": "sku",
  "variation type": "type", "type": "type",
  "factor": "factor", "pieces per pack": "factor", "meters per cut": "factor",
  "variation selling price": "selling_price", "selling price": "selling_price", "price": "selling_price",
  "variation cost price": "cost_price", "variation cost": "cost_price", "cost price": "cost_price", "cost": "cost_price", "cost_price": "cost_price",
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

  const downloadCurrent = async () => {
    // Fetch ALL variations once for the full export
    const { data: varData, error: varErr } = await supabase
      .from("item_variations")
      .select("*")
      .order("name");
    if (varErr) {
      toast.error("Failed to load variations: " + varErr.message);
      return;
    }
    const variations = (varData || []) as ItemVariation[];
    const itemById = new Map(items.map(i => [i.id, i]));

    const itemRows = items.map(i => {
      const isLocal = ((i as any).source as string || "local") === "local";
      const showCost = isAdmin || isLocal;
      return {
        "ID": i.id,
        "SKU": i.sku,
        "Name": i.name,
        "Description": i.description || "",
        "Warehouse Qty": (i as any).warehouse_quantity ?? 0,
        "Store Qty": (i as any).store_quantity ?? 0,
        "Total Qty": i.quantity ?? 0,
        ...(showCost ? { "Cost Price": Number(i.cost_price) } : { "Cost Price": "" }),
        ...(isAdmin ? { "Cost RMB": Number((i as any).cost_price_rmb ?? 0) } : {}),
        "Selling Price": Number(i.selling_price),
        ...(isAdmin ? { "Threshold": i.low_stock_threshold } : {}),
        "Source": (i as any).source || "local",
      };
    });

    const variationRows = variations.map(v => {
      const parent = itemById.get(v.item_id);
      return {
        "ID": v.id,
        "Parent ID": v.item_id,
        "Parent SKU": parent?.sku || "",
        "Parent Name": parent?.name || "",
        "Variation Name": v.name,
        "Variation SKU": v.sku || "",
        "Variation Type": v.type,
        "Factor": Number(v.factor),
        "Variation Selling Price": Number(v.selling_price),
        ...(isAdmin ? { "Variation Cost Price": v.cost_price === null || v.cost_price === undefined ? "" : Number(v.cost_price) } : {}),
        "Parent Warehouse Qty": (parent as any)?.warehouse_quantity ?? 0,
        "Parent Store Qty": (parent as any)?.store_quantity ?? 0,
        "Total Available (parent)": parent?.quantity ?? 0,
      };
    });

    const wb = XLSX.utils.book_new();
    const wsItems = XLSX.utils.json_to_sheet(itemRows);
    wsItems["!cols"] = Array(Object.keys(itemRows[0] || {}).length).fill({ wch: 16 });
    XLSX.utils.book_append_sheet(wb, wsItems, "Inventory");

    const wsVars = XLSX.utils.json_to_sheet(variationRows.length ? variationRows : [{ "ID": "", "Parent SKU": "", "Variation Name": "" }]);
    wsVars["!cols"] = Array(Object.keys(variationRows[0] || {}).length || 3).fill({ wch: 18 });
    XLSX.utils.book_append_sheet(wb, wsVars, "Variations");

    XLSX.writeFile(wb, `inventory_edit_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  const parseFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: "array" });

        const parsed: DiffRow[] = [];

        // ---- Inventory sheet ----
        const itemsSheetName = wb.SheetNames.find(n => n.toLowerCase().includes("inventory")) || wb.SheetNames[0];
        if (itemsSheetName) {
          const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[itemsSheetName], { defval: "" });
          if (json.length > 0) {
            const headers = Object.keys(json[0]);
            const colToField: Record<string, ItemField> = {};
            let idCol: string | null = null;
            let skuCol: string | null = null;
            for (const h of headers) {
              const lower = h.toLowerCase().trim();
              if (lower === "id" || lower === "item id" || lower === "item_id") { idCol = h; continue; }
              if (lower === "sku") { skuCol = h; continue; }
              const mapped = ITEM_HEADER_MAP[lower];
              if (mapped) colToField[h] = mapped;
            }
            if (!idCol && !skuCol) {
              toast.error("Inventory sheet needs an 'ID' or 'SKU' column to match items");
            } else {
              const bySku = new Map(items.map(i => [i.sku.trim().toLowerCase(), i]));
              const byId = new Map(items.map(i => [i.id, i]));

              for (const row of json) {
                const rawId = idCol ? String(row[idCol] ?? "").trim() : "";
                const rawSku = skuCol ? String(row[skuCol] ?? "").trim() : "";
                const existing = (rawId && byId.get(rawId)) || (rawSku && bySku.get(rawSku.toLowerCase())) || null;
                if (!rawId && !rawSku) continue;
                if (!existing) {
                  parsed.push({ kind: "item", matchKey: rawSku || rawId, targetId: null, parentName: "", name: rawSku || rawId, changes: [], patch: {}, status: "not_found", message: "Not in inventory" });
                  continue;
                }
                const existingIsLocal = ((existing as any).source || "local") === "local";
                const changes: DiffRow["changes"] = [];
                const patch: Record<string, unknown> = {};

                // SKU change support (uses idCol or matched by SKU equality)
                if (rawSku && rawSku !== existing.sku) {
                  changes.push({ field: "sku", from: existing.sku, to: rawSku });
                  patch.sku = rawSku;
                }

                for (const [col, field] of Object.entries(colToField)) {
                  if (!isAdmin) {
                    if (field === "low_stock_threshold") continue;
                    if (field === "source") continue;
                    if (field === "cost_price_rmb") continue;
                    if (field === "cost_price" && !existingIsLocal) continue;
                  }
                  const raw = row[col];
                  const oldVal = (existing as any)[field];

                  if (["warehouse_quantity", "store_quantity", "cost_price", "cost_price_rmb", "selling_price", "low_stock_threshold"].includes(field)) {
                    const newNum = numOrNull(raw);
                    if (newNum === null) continue;
                    if (Number(newNum) !== Number(oldVal)) {
                      changes.push({ field, from: oldVal, to: newNum });
                      patch[field] = newNum;
                    }
                  } else if (field === "source") {
                    const v = normalize(raw);
                    if (v !== "local" && v !== "import") continue;
                    if (v !== normalize(oldVal || "local")) {
                      changes.push({ field, from: oldVal || "local", to: v });
                      patch[field] = v;
                    }
                  } else if (field === "sku") {
                    // already handled above
                    continue;
                  } else {
                    const newStr = String(raw ?? "").trim();
                    if (newStr === "" && (oldVal ?? "") !== "") continue;
                    if (newStr !== String(oldVal ?? "").trim()) {
                      changes.push({ field, from: oldVal, to: newStr });
                      patch[field] = newStr;
                    }
                  }
                }

                parsed.push({
                  kind: "item",
                  matchKey: existing.sku,
                  targetId: existing.id,
                  parentName: "",
                  name: existing.name,
                  changes,
                  patch,
                  status: changes.length ? "matched" : "unchanged",
                });
              }
            }
          }
        }

        // ---- Variations sheet ----
        const varSheetName = wb.SheetNames.find(n => n.toLowerCase().includes("variation"));
        if (varSheetName) {
          const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[varSheetName], { defval: "" });
          if (json.length > 0) {
            const headers = Object.keys(json[0]);
            const colToField: Record<string, VarField> = {};
            let idCol: string | null = null;
            let varSkuCol: string | null = null;
            let parentSkuCol: string | null = null;
            for (const h of headers) {
              const lower = h.toLowerCase().trim();
              if (lower === "id") { idCol = h; continue; }
              if (lower === "variation sku") { varSkuCol = h; }
              if (lower === "parent sku") { parentSkuCol = h; continue; }
              const mapped = VAR_HEADER_MAP[lower];
              if (mapped) colToField[h] = mapped;
            }

            // Fetch existing variations once for matching
            const { data: existingVars } = await supabase.from("item_variations").select("*");
            const varList = (existingVars || []) as ItemVariation[];
            const varById = new Map(varList.map(v => [v.id, v]));
            const itemBySku = new Map(items.map(i => [i.sku.trim().toLowerCase(), i]));
            // Match by variation SKU + parent SKU
            const varByCompoundKey = new Map<string, ItemVariation>();
            for (const v of varList) {
              if (!v.sku) continue;
              const parent = items.find(i => i.id === v.item_id);
              if (!parent) continue;
              varByCompoundKey.set(`${parent.sku.toLowerCase()}|${v.sku.toLowerCase()}`, v);
            }
            const itemById = new Map(items.map(i => [i.id, i]));

            for (const row of json) {
              const rawId = idCol ? String(row[idCol] ?? "").trim() : "";
              const rawVarSku = varSkuCol ? String(row[varSkuCol] ?? "").trim() : "";
              const rawParentSku = parentSkuCol ? String(row[parentSkuCol] ?? "").trim() : "";
              if (!rawId && !rawVarSku) continue;

              let existing: ItemVariation | undefined;
              if (rawId) existing = varById.get(rawId);
              if (!existing && rawVarSku && rawParentSku) {
                existing = varByCompoundKey.get(`${rawParentSku.toLowerCase()}|${rawVarSku.toLowerCase()}`);
              }
              if (!existing) {
                parsed.push({ kind: "variation", matchKey: rawVarSku || rawId, targetId: null, parentName: rawParentSku, name: rawVarSku || rawId, changes: [], patch: {}, status: "not_found", message: "Variation not found" });
                continue;
              }
              const parent = itemById.get(existing.item_id);
              const changes: DiffRow["changes"] = [];
              const patch: Record<string, unknown> = {};

              for (const [col, field] of Object.entries(colToField)) {
                if (!isAdmin && field === "cost_price") continue;
                const raw = row[col];
                const oldVal = (existing as any)[field];
                if (field === "factor" || field === "selling_price") {
                  const newNum = numOrNull(raw);
                  if (newNum === null) continue;
                  if (Number(newNum) !== Number(oldVal)) {
                    changes.push({ field, from: oldVal, to: newNum });
                    patch[field] = newNum;
                  }
                } else if (field === "cost_price") {
                  const isBlank = raw === "" || raw === null || raw === undefined;
                  const newVal = isBlank ? null : numOrNull(raw);
                  if (!isBlank && newVal === null) continue;
                  const oldNum = oldVal === null || oldVal === undefined ? null : Number(oldVal);
                  if (newVal !== oldNum) {
                    changes.push({ field, from: oldVal, to: newVal });
                    patch[field] = newVal;
                  }
                } else if (field === "type") {
                  const v = normalize(raw);
                  if (v !== "pack" && v !== "cut") continue;
                  if (v !== normalize(oldVal)) {
                    changes.push({ field, from: oldVal, to: v });
                    patch[field] = v;
                  }
                } else {
                  const newStr = String(raw ?? "").trim();
                  if (newStr === "" && (oldVal ?? "") !== "") continue;
                  if (newStr !== String(oldVal ?? "").trim()) {
                    changes.push({ field, from: oldVal, to: newStr });
                    patch[field] = field === "sku" && newStr === "" ? null : newStr;
                  }
                }
              }

              parsed.push({
                kind: "variation",
                matchKey: existing.sku || existing.id.slice(0, 8),
                targetId: existing.id,
                parentName: parent?.name || "",
                name: existing.name,
                changes,
                patch,
                status: changes.length ? "matched" : "unchanged",
              });
            }
          }
        }

        if (parsed.length === 0) {
          toast.error("No matching rows found in file");
          return;
        }
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
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    parseFile(file);
    e.target.value = "";
  };

  const handleApply = async () => {
    const toUpdate = rows.filter(r => r.status === "matched" && r.targetId);
    if (toUpdate.length === 0) { toast.error("Nothing to update"); return; }
    setBusy(true);
    let ok = 0, fail = 0;
    for (const r of toUpdate) {
      try {
        if (r.kind === "item") {
          await updateItem(r.targetId!, r.patch as Partial<Item>);
        } else {
          await updateItemVariation(r.targetId!, r.patch as Partial<ItemVariation>);
        }
        ok++;
      } catch (e) {
        console.error("Update failed for", r.matchKey, e);
        fail++;
      }
    }
    setBusy(false);
    if (ok > 0) toast.success(`Updated ${ok} row${ok === 1 ? "" : "s"}${fail ? ` (${fail} failed)` : ""}`);
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
    if (field === "cost_price_rmb") return `¥${Number(v)}`;
    return String(v);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <Pencil className="h-5 w-5" /> Bulk Edit
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
                1. Download the current inventory (includes Inventory + Variations sheets) · 2. Edit any field — items match by ID or SKU, variations match by ID or Parent SKU + Variation SKU · 3. Re-upload. Only changed fields are written. No new rows are created.
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
                  <span className="flex items-center gap-1 text-amber-600"><AlertCircle className="h-3 w-3" />{notFoundCount} not found</span>
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
                    <TableHead className="text-xs">Kind</TableHead>
                    <TableHead className="text-xs">Match</TableHead>
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
                      <TableCell className="text-xs">{row.kind === "item" ? "Item" : "Variation"}</TableCell>
                      <TableCell className="text-xs font-mono">{row.matchKey || "—"}</TableCell>
                      <TableCell className="text-sm">
                        {row.kind === "variation" && row.parentName ? (
                          <span className="text-muted-foreground">{row.parentName} › </span>
                        ) : null}
                        {row.name || "—"}
                      </TableCell>
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
