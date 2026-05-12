import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Star, StarOff, Pencil, Trash2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  listItemSuppliers,
  upsertItemSupplier,
  setPrimarySupplier,
  deleteItemSupplier,
  type ItemSupplierRow,
} from "@/lib/itemSuppliers";
import type { Item, Supplier, OverseasSupplier } from "@/types/database";
import { format, parseISO } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

export default function ItemSuppliersDialog({
  item,
  open,
  onOpenChange,
}: {
  item: Item | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [editing, setEditing] = useState<ItemSupplierRow | null>(null);
  const [showForm, setShowForm] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["item-suppliers", item?.id],
    queryFn: () => (item ? listItemSuppliers(item.id) : Promise.resolve([])),
    enabled: !!item && open,
  });

  const { data: locals = [] } = useQuery<Supplier[]>({
    queryKey: ["suppliers-list"],
    queryFn: async () => {
      const { data } = await supabase.from("suppliers").select("*").order("name");
      return (data as Supplier[]) || [];
    },
    enabled: open,
  });
  const { data: overseas = [] } = useQuery<OverseasSupplier[]>({
    queryKey: ["overseas-suppliers-list"],
    queryFn: async () => {
      const { data } = await supabase.from("overseas_suppliers").select("*").order("name");
      return (data as OverseasSupplier[]) || [];
    },
    enabled: open,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["item-suppliers", item?.id] });
    qc.invalidateQueries({ queryKey: ["lowstock-item-suppliers"] });
  };

  const setPrimaryMut = useMutation({
    mutationFn: setPrimarySupplier,
    onSuccess: () => { invalidate(); toast.success("Default supplier set"); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteItemSupplier,
    onSuccess: () => { invalidate(); toast.success("Supplier removed"); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setShowForm(false); setEditing(null); } onOpenChange(o); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            Suppliers — <span className="font-normal text-muted-foreground">{item.name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Manage which suppliers carry this product. Costs are stored in the supplier's currency.
            </p>
            {!showForm && (
              <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add supplier
              </Button>
            )}
          </div>

          {showForm && (
            <SupplierForm
              itemId={item.id}
              row={editing}
              locals={locals}
              overseas={overseas}
              onCancel={() => { setShowForm(false); setEditing(null); }}
              onSaved={() => { setShowForm(false); setEditing(null); invalidate(); }}
            />
          )}

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Supplier</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">SKU</TableHead>
                  <TableHead className="text-xs text-right">Latest Cost</TableHead>
                  <TableHead className="text-xs text-right">MOQ</TableHead>
                  <TableHead className="text-xs text-right">Lead</TableHead>
                  <TableHead className="text-xs">Last Ordered</TableHead>
                  <TableHead className="text-xs text-right w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">Loading…</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">No suppliers linked to this product yet.</TableCell></TableRow>
                ) : rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-1.5">
                        {r.is_primary && <Star className="h-3.5 w-3.5 fill-warning text-warning" />}
                        <span className={r.is_primary ? "font-medium" : ""}>{r.supplier_name || "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] uppercase">{r.is_overseas ? "Overseas" : "Local"}</Badge></TableCell>
                    <TableCell className="text-xs font-mono">{r.supplier_sku || "—"}</TableCell>
                    <TableCell className="text-right text-sm">
                      <span className="font-medium">{currencySymbol(r.currency)}{Number(r.latest_cost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      <div className="text-[10px] text-muted-foreground">{r.currency}</div>
                    </TableCell>
                    <TableCell className="text-right text-sm">{r.moq || 1}</TableCell>
                    <TableCell className="text-right text-sm">{r.lead_time_days != null ? `${r.lead_time_days}d` : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.last_purchased_at ? format(parseISO(r.last_purchased_at), "MMM d, yyyy") : "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {!r.is_primary && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Set as default" onClick={() => setPrimaryMut.mutate(r.id)}>
                            <StarOff className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => { setEditing(r); setShowForm(true); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {isAdmin && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Remove" onClick={() => { if (confirm("Remove this supplier from product?")) deleteMut.mutate(r.id); }}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function currencySymbol(c: string) {
  if (c === "RMB") return "¥";
  if (c === "USD") return "$";
  return "₱";
}

function SupplierForm({
  itemId, row, locals, overseas, onSaved, onCancel,
}: {
  itemId: string;
  row: ItemSupplierRow | null;
  locals: Supplier[];
  overseas: OverseasSupplier[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<"local" | "overseas">(row?.is_overseas ? "overseas" : "local");
  const [supplierId, setSupplierId] = useState<string>(row?.supplier_id || "");
  const [overseasId, setOverseasId] = useState<string>(row?.overseas_supplier_id || "");
  const [currency, setCurrency] = useState<string>(row?.currency || "PHP");
  const [supplierSku, setSupplierSku] = useState(row?.supplier_sku || "");
  const [latestCost, setLatestCost] = useState(row ? String(row.latest_cost) : "");
  const [moq, setMoq] = useState(row ? String(row.moq) : "1");
  const [leadTime, setLeadTime] = useState(row?.lead_time_days != null ? String(row.lead_time_days) : "");
  const [isPrimary, setIsPrimary] = useState(row?.is_primary || false);
  const [notes, setNotes] = useState(row?.notes || "");
  const [saving, setSaving] = useState(false);

  // Auto-pick currency when overseas supplier is chosen
  useEffect(() => {
    if (type === "overseas" && overseasId) {
      const s = overseas.find(o => o.id === overseasId);
      if (s) setCurrency(s.currency);
    } else if (type === "local") {
      setCurrency("PHP");
    }
  }, [type, overseasId, overseas]);

  const submit = async () => {
    if (type === "local" && !supplierId) { toast.error("Pick a supplier"); return; }
    if (type === "overseas" && !overseasId) { toast.error("Pick an overseas supplier"); return; }
    setSaving(true);
    try {
      await upsertItemSupplier({
        id: row?.id,
        item_id: itemId,
        supplier_id: type === "local" ? supplierId : null,
        overseas_supplier_id: type === "overseas" ? overseasId : null,
        currency,
        supplier_sku: supplierSku,
        latest_cost: parseFloat(latestCost) || 0,
        moq: parseInt(moq) || 1,
        lead_time_days: leadTime ? parseInt(leadTime) : null,
        is_primary: isPrimary,
        notes,
      });
      toast.success(row ? "Supplier updated" : "Supplier added");
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{row ? "Edit supplier" : "Add supplier"}</div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel}><X className="h-3.5 w-3.5" /></Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as any)} disabled={!!row}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="local">Local supplier</SelectItem>
              <SelectItem value="overseas">Overseas supplier</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Supplier</Label>
          {type === "local" ? (
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select supplier" /></SelectTrigger>
              <SelectContent>{locals.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <Select value={overseasId} onValueChange={setOverseasId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select overseas supplier" /></SelectTrigger>
              <SelectContent>{overseas.map(s => <SelectItem key={s.id} value={s.id}>{s.name} ({s.currency})</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Currency</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="PHP">PHP ₱</SelectItem>
              <SelectItem value="USD">USD $</SelectItem>
              <SelectItem value="RMB">RMB ¥</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Supplier SKU / Code</Label>
          <Input className="h-9" value={supplierSku} onChange={e => setSupplierSku(e.target.value)} placeholder="e.g. CAT6-305M" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Latest cost ({currency})</Label>
          <Input className="h-9" type="number" step="0.01" value={latestCost} onChange={e => setLatestCost(e.target.value)} placeholder="0.00" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">MOQ</Label>
          <Input className="h-9" type="number" min={1} value={moq} onChange={e => setMoq(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Lead time (days)</Label>
          <Input className="h-9" type="number" min={0} value={leadTime} onChange={e => setLeadTime(e.target.value)} placeholder="—" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Notes</Label>
          <Input className="h-9" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-xs col-span-2 cursor-pointer">
          <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} />
          Set as default/primary supplier for this product
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={saving}>{saving ? "Saving…" : (row ? "Update" : "Add supplier")}</Button>
      </div>
    </div>
  );
}
