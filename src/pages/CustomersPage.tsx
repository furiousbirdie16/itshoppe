import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCustomers, createCustomer, updateCustomer, deleteCustomer } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import type { Customer } from "@/types/database";

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState({ name: "", contact_person: "", email: "", phone: "", address: "" });

  const { data: customers = [], isLoading } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });

  const createMut = useMutation({
    mutationFn: (data: Partial<Customer>) => createCustomer(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["customers"] }); setOpen(false); toast.success("Customer created"); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Customer> }) => updateCustomer(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["customers"] }); setOpen(false); setEditing(null); toast.success("Updated"); },
  });

  const deleteMut = useMutation({
    mutationFn: deleteCustomer,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["customers"] }); toast.success("Deleted"); },
  });

  const openCreate = () => { setEditing(null); setForm({ name: "", contact_person: "", email: "", phone: "", address: "" }); setOpen(true); };
  const openEdit = (c: Customer) => { setEditing(c); setForm({ name: c.name, contact_person: c.contact_person, email: c.email, phone: c.phone, address: c.address }); setOpen(true); };

  const handleSubmit = () => {
    if (editing) updateMut.mutate({ id: editing.id, data: form });
    else createMut.mutate(form);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">Customers</h1>
          <p className="page-description">{customers.length} customers</p>
        </div>
        <Button onClick={openCreate} className="rounded-lg h-9 px-4 text-sm font-medium">
          <Plus className="h-4 w-4 mr-1.5" /> Add Customer
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-lg">{editing ? "Edit Customer" : "New Customer"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Name</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9" />
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
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Address</Label>
              <Textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="resize-none" rows={2} />
            </div>
            <Button onClick={handleSubmit} className="mt-2 rounded-lg h-9">{editing ? "Update" : "Create Customer"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Name</TableHead>
              <TableHead className="text-xs">Contact</TableHead>
              <TableHead className="text-xs">Email</TableHead>
              <TableHead className="text-xs">Phone</TableHead>
              <TableHead className="text-xs text-right w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="h-32 text-center"><div className="flex justify-center"><div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div></TableCell></TableRow>
            ) : customers.length === 0 ? (
              <TableRow><TableCell colSpan={5}><div className="empty-state"><Users className="empty-state-icon" /><p className="text-sm">No customers yet</p></div></TableCell></TableRow>
            ) : customers.map(c => (
              <TableRow key={c.id} className="hover:bg-muted/30">
                <TableCell className="font-medium text-sm">{c.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.contact_person}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.email}</TableCell>
                <TableCell className="text-sm">{c.phone}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(c)} className="h-7 w-7 rounded-md"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(c.id)} className="h-7 w-7 rounded-md"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
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
