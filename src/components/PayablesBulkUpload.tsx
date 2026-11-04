import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { AlertCircle, Check, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createPayable } from "@/lib/api";
import { checkKey, parsePayablesSheet, TEMPLATE_HEADERS, type PayableUploadRow } from "@/lib/payables-upload";
import { peso } from "@/lib/currency";
import type { Payable } from "@/types/database";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: { id: string; name: string }[];
  /** Payables already entered, so checks are not entered twice. */
  payables: Payable[];
}

/** Upload many payables — usually a book of post-dated checks — from a sheet. */
export function PayablesBulkUpload({ open, onOpenChange, accounts, payables }: Props) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<PayableUploadRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [uploading, setUploading] = useState(false);

  const reset = () => { setRows([]); setFileName(""); };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      TEMPLATE_HEADERS,
      ["Meralco", 12500, "000123", "2026-11-15", "BDO", accounts[0]?.name ?? "", "2026-10-27", "Utilities", ""],
      ["Office rent", 30000, "", "2026-11-01", "", "", "", "Rent", "Not a check: no check number"],
    ]);
    ws["!cols"] = [{ wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 13 }, { wch: 14 }, { wch: 28 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Payables");
    XLSX.writeFile(wb, "payables_template.xlsx");
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: "array", cellDates: false });
        const sheet = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false, blankrows: false });
        const existing = new Set<string>();
        for (const p of payables) {
          if (!p.is_check || !p.check_number || p.status === "cancelled") continue;
          existing.add(checkKey(p.check_number, p.check_bank || ""));
          if (p.cash_account_id) existing.add(checkKey(p.check_number, p.cash_account_id));
        }
        const parsed = parsePayablesSheet(sheet, accounts, existing);
        if (!parsed) { toast.error("Could not find the Payee and Amount columns"); return; }
        if (parsed.length === 0) { toast.error("No rows found"); return; }
        setRows(parsed);
      } catch (err) {
        console.error(err);
        toast.error("Could not read the file");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const valid = rows.filter((r) => r.valid);
  const duplicates = rows.filter((r) => r.duplicate).length;
  const invalid = rows.filter((r) => !r.valid && !r.duplicate).length;

  const upload = async () => {
    setUploading(true);
    let ok = 0;
    let lastError = "";
    for (const r of valid) {
      try {
        await createPayable({
          payee: r.payee,
          supplier_id: null,
          amount: r.amount,
          amount_paid: 0,
          due_date: r.due_date,
          status: "unpaid",
          is_check: r.is_check,
          check_number: r.check_number,
          check_bank: r.check_bank,
          cash_account_id: r.cash_account_id,
          date_written: r.date_written,
          category: r.category,
          notes: r.notes,
        });
        ok++;
      } catch (e: any) {
        lastError = e?.message || String(e);
      }
    }
    setUploading(false);
    queryClient.invalidateQueries({ queryKey: ["payables"] });
    const failed = valid.length - ok;
    if (ok) toast.success(`${ok} payable${ok === 1 ? "" : "s"} added${failed ? ` · ${failed} failed: ${lastError}` : ""}`);
    else toast.error(`None added: ${lastError}`);
    if (ok) { reset(); onOpenChange(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5" /> Upload payables</DialogTitle>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-10">
            <div className="space-y-1 text-center">
              <p className="text-sm font-medium">Upload an Excel or CSV file</p>
              <p className="text-xs text-muted-foreground">
                Columns: <strong>Payee</strong>, <strong>Amount</strong>, Check Number, Check Date, Check Bank, Paid From, Date Written, Category, Notes.
              </p>
              <p className="text-[11px] text-muted-foreground">
                A row with a check number is a check; without one it is a bill. Paid From must match an account's name.
                Everything goes in unpaid. A check already entered is left out.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={downloadTemplate}><FileSpreadsheet className="mr-1 h-4 w-4" /> Download template</Button>
              <Button onClick={() => fileRef.current?.click()}>Select file</Button>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
          </div>
        ) : (
          <div className="flex flex-col gap-3 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{fileName} — {rows.length} rows</span>
              <div className="flex gap-3">
                {valid.length > 0 && <span className="flex items-center gap-1 text-green-600"><Check className="h-3 w-3" />{valid.length} ready · {peso(valid.reduce((s, r) => s + r.amount, 0))}</span>}
                {duplicates > 0 && <span className="text-muted-foreground">{duplicates} already entered</span>}
                {invalid > 0 && <span className="flex items-center gap-1 text-destructive"><AlertCircle className="h-3 w-3" />{invalid} with problems</span>}
              </div>
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Payee</TableHead>
                    <TableHead className="text-xs text-right">Amount</TableHead>
                    <TableHead className="text-xs">Check</TableHead>
                    <TableHead className="text-xs">Check date</TableHead>
                    <TableHead className="text-xs">Paid from</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={i} className={r.valid ? "" : r.duplicate ? "bg-muted/40 text-muted-foreground" : "bg-destructive/5"}>
                      <TableCell className="text-sm">
                        {r.payee || "—"}
                        {r.category && <span className="block text-[11px] text-muted-foreground">{r.category}</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{peso(r.amount)}</TableCell>
                      <TableCell className="text-xs">{r.is_check ? `${r.check_number}${r.check_bank ? ` · ${r.check_bank}` : ""}` : "Bill"}</TableCell>
                      <TableCell className="text-xs">{r.due_date || "—"}</TableCell>
                      <TableCell className="text-xs">{r.account_label || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {r.valid ? <span className="text-green-600">✓</span> : <span className={r.duplicate ? "" : "text-destructive"}>{r.error}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={reset}>Clear</Button>
              <Button onClick={upload} disabled={uploading || valid.length === 0}>
                {uploading ? "Uploading…" : `Add ${valid.length} payable${valid.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
