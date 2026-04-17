import { useState, useEffect, ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Pencil } from "lucide-react";

export type BulkFieldType = "text" | "number" | "date" | "textarea" | "select";

export interface BulkField {
  key: string;
  label: string;
  type: BulkFieldType;
  options?: { value: string; label: string }[];
  placeholder?: string;
  /** Optional transform from input string -> value sent to update fn */
  transform?: (raw: string) => unknown;
}

interface BulkEditDialogProps {
  /** Selected ids to apply changes to */
  selectedIds: string[];
  /** Field definitions */
  fields: BulkField[];
  /** Per-id update function. Called for each id with the partial patch. */
  updateOne: (id: string, patch: Record<string, unknown>) => Promise<void>;
  /** Called after a successful run */
  onSuccess?: () => void;
  /** Entity label for messages, e.g. "invoices" */
  entityLabel?: string;
  /** Custom trigger; defaults to a small "Bulk Edit" button */
  trigger?: ReactNode;
}

export function BulkEditDialog({ selectedIds, fields, updateOne, onSuccess, entityLabel = "records", trigger }: BulkEditDialogProps) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setEnabled({});
      setValues({});
    }
  }, [open]);

  const toggle = (key: string) => setEnabled(e => ({ ...e, [key]: !e[key] }));
  const setVal = (key: string, v: string) => setValues(s => ({ ...s, [key]: v }));

  const handleApply = async () => {
    const activeKeys = Object.keys(enabled).filter(k => enabled[k]);
    if (activeKeys.length === 0) {
      toast.error("Select at least one field to update");
      return;
    }
    if (selectedIds.length === 0) {
      toast.error("No rows selected");
      return;
    }
    const patch: Record<string, unknown> = {};
    for (const key of activeKeys) {
      const field = fields.find(f => f.key === key);
      if (!field) continue;
      const raw = values[key] ?? "";
      patch[key] = field.transform ? field.transform(raw) : raw;
    }
    setBusy(true);
    let ok = 0;
    let fail = 0;
    for (const id of selectedIds) {
      try {
        await updateOne(id, patch);
        ok++;
      } catch (e) {
        fail++;
        console.error("Bulk edit failed for", id, e);
      }
    }
    setBusy(false);
    if (ok > 0) toast.success(`Updated ${ok} ${entityLabel}${fail ? ` (${fail} failed)` : ""}`);
    else toast.error(`All ${fail} updates failed`);
    if (ok > 0) {
      setOpen(false);
      onSuccess?.();
    }
  };

  return (
    <>
      <span onClick={() => setOpen(true)}>
        {trigger ?? (
          <Button variant="outline" size="sm" disabled={selectedIds.length === 0}>
            <Pencil className="h-4 w-4 mr-1" /> Bulk Edit
          </Button>
        )}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">Bulk Edit {selectedIds.length} {entityLabel}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            Tick the fields you want to overwrite. Only ticked fields will be changed.
          </p>
          <div className="space-y-3 pt-2">
            {fields.map(f => (
              <div key={f.key} className="rounded-lg border p-3 space-y-2 bg-card">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={!!enabled[f.key]} onCheckedChange={() => toggle(f.key)} />
                  <span className="text-sm font-medium">{f.label}</span>
                </label>
                {enabled[f.key] && (
                  <div>
                    {f.type === "text" && (
                      <Input value={values[f.key] ?? ""} onChange={e => setVal(f.key, e.target.value)} placeholder={f.placeholder} className="h-9" />
                    )}
                    {f.type === "number" && (
                      <Input type="number" value={values[f.key] ?? ""} onChange={e => setVal(f.key, e.target.value)} placeholder={f.placeholder} className="h-9" />
                    )}
                    {f.type === "date" && (
                      <Input type="date" value={values[f.key] ?? ""} onChange={e => setVal(f.key, e.target.value)} className="h-9" />
                    )}
                    {f.type === "textarea" && (
                      <Textarea value={values[f.key] ?? ""} onChange={e => setVal(f.key, e.target.value)} placeholder={f.placeholder} rows={2} className="resize-none" />
                    )}
                    {f.type === "select" && (
                      <Select value={values[f.key] ?? ""} onValueChange={v => setVal(f.key, v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Select..." /></SelectTrigger>
                        <SelectContent>
                          {(f.options ?? []).map(o => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleApply} disabled={busy}>
              {busy ? "Updating..." : `Apply to ${selectedIds.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
