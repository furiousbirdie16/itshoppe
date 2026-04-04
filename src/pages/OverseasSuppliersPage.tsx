import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getOverseasSuppliers, createOverseasSupplier, updateOverseasSupplier, deleteOverseasSupplier } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Globe, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { peso } from "@/lib/currency";
import type { OverseasSupplier } from "@/types/database";

const defaultForm = { name: "", contact_person: "", email: "", phone: "", address: "", country: "", currency: "USD" as "USD" | "RMB", exchange_rate: "1", notes: "" };

export default function OverseasSuppliersPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OverseasSupplier | null>(null);
  const [form, setForm] = useState(defaultForm);

  // Converter state
  const [convAmount, setConvAmount] = useState("");
  const [convCurrency, setConvCurrency] = useState<"USD" | "RMB">("USD");
  const [convRate, setConvRate] = useState("");

  const { data: suppliers = [], isLoading } = useQuery<OverseasSupplier[]>({ queryKey: ["overseas_suppliers"], queryFn: getOverseasSuppliers });

  const createMut = useMutation({
    mutationFn: (data: Partial<OverseasSupplier>) => createOverseasSupplier(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["overseas_suppliers"] }); setOpen(false); toast.success("Overseas supplier created"); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<OverseasSupplier> }) => updateOverseasSupplier(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["overseas_suppliers"] }); setOpen(false); setEditing(null); toast.success("Updated"); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteOverseasSupplier,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["overseas_suppliers"] }); toast.success("Deleted"); },
  });

  const openCreate = () => { setEditing(null); setForm(defaultForm); setOpen(true); };
  const openEdit = (s: OverseasSupplier) => {
    setEditing(s);
    setForm({ name: s.name, contact_person: s.contact_person, email: s.email, phone: s.phone, address: s.address, country: s.country, currency: s.currency, exchange_rate: String(s.exchange_rate), notes: s.notes });
    setOpen(true);
  };

  const handleSubmit = () => {
    const payload = { ...form, exchange_rate: parseFloat(form.exchange_rate) || 1 };
    if (editing) updateMut.mutate({ id: editing.id, data: payload });
    else createMut.mutate(payload);
  };

  const convertedPhp = convAmount && convRate ? (parseFloat(convAmount) * parseFloat(convRate)) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">Overseas Suppliers</h1>
          <p className="page-description">{suppliers.length} overseas suppliers</p>
        </div>
        <Button onClick={openCreate} className="rounded-lg h-9 px-4 text-sm font-medium">
          <Plus className="h-4 w-4 mr-1.5" /> Add Supplier
        </Button>
      </div>

      {/* Currency Converter Card */}
      <div className="border rounded-xl p-4 bg-card">
        <div className="flex items-center gap-2 mb-3">
          <ArrowRightLeft className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Currency Converter</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Amount</Label>
            <Input type="number" placeholder="0.00" value={convAmount} onChange={e => setConvAmount(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Currency</Label>
            <Select value={convCurrency} onValueChange={(v: "USD" | "RMB") => setConvCurrency(v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD ($)</SelectItem>
                <SelectItem value="RMB">RMB (¥)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Rate to PHP</Label>
            <Input type="number" placeholder="e.g. 56.50" value={convRate} onChange={e => setConvRate(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">PHP Equivalent</Label>
            <div className="h-9 flex items-center px-3 rounded-md border bg-muted text-sm font-medium">
              {convertedPhp !== null ? peso(convertedPhp) : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="text-lg">{editing ? "Edit Overseas Supplier" : "New Overseas Supplier"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Name</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Country</Label>
                <Input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} className="h-9" placeholder="e.g. China" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Contact Person</Label>
                <Input value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Phone</Label>
                <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Email</Label>
              <Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Currency</Label>
                <Select value={form.currency} onValueChange={(v: "USD" | "RMB") => setForm({ ...form, currency: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD ($)</SelectItem>
                    <SelectItem value="RMB">RMB (¥)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Exchange Rate to PHP</Label>
                <Input type="number" value={form.exchange_rate} onChange={e => setForm({ ...form, exchange_rate: e.target.value })} className="h-9" placeholder="e.g. 56.50" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Address</Label>
              <Textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="resize-none" rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="resize-none" rows={2} />
            </div>
            <Button onClick={handleSubmit} className="mt-2 rounded-lg h-9">{editing ? "Update" : "Create Supplier"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Table */}
      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Name</TableHead>
              <TableHead className="text-xs">Country</TableHead>
              <TableHead className="text-xs">Contact</TableHead>
              <TableHead className="text-xs">Currency</TableHead>
              <TableHead className="text-xs">Rate to PHP</TableHead>
              <TableHead className="text-xs">Email</TableHead>
              <TableHead className="text-xs text-right w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="h-32 text-center"><div className="flex justify-center"><div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div></TableCell></TableRow>
            ) : suppliers.length === 0 ? (
              <TableRow><TableCell colSpan={7}><div className="empty-state"><Globe className="empty-state-icon" /><p className="text-sm">No overseas suppliers yet</p></div></TableCell></TableRow>
            ) : suppliers.map(s => (
              <TableRow key={s.id} className="hover:bg-muted/30">
                <TableCell className="font-medium text-sm">{s.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{s.country}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{s.contact_person}</TableCell>
                <TableCell className="text-sm">
                  <span className="inline-flex items-center rounded-md bg-accent px-2 py-0.5 text-xs font-medium">
                    {s.currency === "USD" ? "$ USD" : "¥ RMB"}
                  </span>
                </TableCell>
                <TableCell className="text-sm font-mono">{s.exchange_rate}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{s.email}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(s)} className="h-7 w-7 rounded-md"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(s.id)} className="h-7 w-7 rounded-md"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
