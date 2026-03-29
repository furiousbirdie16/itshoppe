import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getItems, createItem, updateItem, deleteItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import type { Item } from "@/types/database";

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState({ name: "", sku: "", description: "", cost_price: "0", selling_price: "0", low_stock_threshold: "10" });

  const { data: items = [], isLoading } = useQuery({ queryKey: ["items"], queryFn: getItems });

  const createMut = useMutation({
    mutationFn: (data: Partial<Item>) => createItem(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["items"] }); setOpen(false); toast.success("Item created"); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Item> }) => updateItem(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["items"] }); setOpen(false); setEditing(null); toast.success("Item updated"); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteItem,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["items"] }); toast.success("Item deleted"); },
  });

  const openCreate = () => { setEditing(null); setForm({ name: "", sku: "", description: "", cost_price: "0", selling_price: "0", low_stock_threshold: "10" }); setOpen(true); };
  const openEdit = (item: Item) => {
    setEditing(item);
    setForm({ name: item.name, sku: item.sku, description: item.description, cost_price: String(item.cost_price), selling_price: String(item.selling_price), low_stock_threshold: String(item.low_stock_threshold) });
    setOpen(true);
  };

  const handleSubmit = () => {
    const data = { name: form.name, sku: form.sku, description: form.description, cost_price: parseFloat(form.cost_price), selling_price: parseFloat(form.selling_price), low_stock_threshold: parseInt(form.low_stock_threshold) };
    if (editing) updateMut.mutate({ id: editing.id, data });
    else createMut.mutate(data);
  };

  const filtered = items.filter(i => i.name.toLowerCase().includes(filter.toLowerCase()) || i.sku.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground">{items.length} items</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Add Item</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Edit Item" : "New Item"}</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>SKU</Label><Input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} /></div>
              </div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-4">
                <div><Label>Cost Price</Label><Input type="number" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} /></div>
                <div><Label>Selling Price</Label><Input type="number" value={form.selling_price} onChange={e => setForm({ ...form, selling_price: e.target.value })} /></div>
                <div><Label>Low Stock Alert</Label><Input type="number" value={form.low_stock_threshold} onChange={e => setForm({ ...form, low_stock_threshold: e.target.value })} /></div>
              </div>
              <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending}>{editing ? "Update" : "Create"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Filter by name or SKU..." value={filter} onChange={e => setFilter(e.target.value)} className="pl-9" />
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Sell</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No items found</TableCell></TableRow>
            ) : filtered.map(item => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell className="text-muted-foreground font-mono text-sm">{item.sku}</TableCell>
                <TableCell className={`text-right font-medium ${item.quantity <= item.low_stock_threshold ? 'text-destructive' : ''}`}>{item.quantity}</TableCell>
                <TableCell className="text-right">${Number(item.cost_price).toFixed(2)}</TableCell>
                <TableCell className="text-right">${Number(item.selling_price).toFixed(2)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(item)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(item.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
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
