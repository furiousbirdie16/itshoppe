import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getItems, createItem, updateItem, deleteItem } from "@/lib/api";
import { peso } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2, Search, Package, Upload } from "lucide-react";
import { toast } from "sonner";
import type { Item } from "@/types/database";
import BulkUploadDialog from "@/components/BulkUploadDialog";

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState({ name: "", sku: "", description: "", quantity: "0", cost_price: "0", selling_price: "0", low_stock_threshold: "10" });

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

  const openCreate = () => { setEditing(null); setForm({ name: "", sku: "", description: "", quantity: "0", cost_price: "0", selling_price: "0", low_stock_threshold: "10" }); setOpen(true); };
  const openEdit = (item: Item) => {
    setEditing(item);
    setForm({ name: item.name, sku: item.sku, description: item.description, quantity: String(item.quantity), cost_price: String(item.cost_price), selling_price: String(item.selling_price), low_stock_threshold: String(item.low_stock_threshold) });
    setOpen(true);
  };

  const handleSubmit = () => {
    const data: any = { name: form.name, sku: form.sku, description: form.description, cost_price: parseFloat(form.cost_price), selling_price: parseFloat(form.selling_price), low_stock_threshold: parseInt(form.low_stock_threshold) };
    if (!editing) data.quantity = parseInt(form.quantity) || 0;
    if (editing) updateMut.mutate({ id: editing.id, data });
    else createMut.mutate(data);
  };

  const filtered = items.filter(i => i.name.toLowerCase().includes(filter.toLowerCase()) || i.sku.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">Inventory</h1>
          <p className="page-description">{items.length} items in stock</p>
        </div>
        <Button onClick={openCreate} className="rounded-lg h-9 px-4 text-sm font-medium">
          <Plus className="h-4 w-4 mr-1.5" /> Add Item
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg">{editing ? "Edit Item" : "New Item"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Name</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">SKU</Label>
                <Input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Description</Label>
              <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="resize-none" rows={2} />
            </div>
            {!editing && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Initial Quantity</Label>
                <Input type="number" min={0} value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="h-9" />
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Cost Price</Label>
                <Input type="number" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Selling Price</Label>
                <Input type="number" value={form.selling_price} onChange={e => setForm({ ...form, selling_price: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Low Stock Alert</Label>
                <Input type="number" value={form.low_stock_threshold} onChange={e => setForm({ ...form, low_stock_threshold: e.target.value })} className="h-9" />
              </div>
            </div>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending} className="mt-2 rounded-lg h-9">
              {editing ? "Update Item" : "Create Item"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Filter by name or SKU..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="pl-9 h-9 rounded-lg text-sm"
        />
      </div>

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Name</TableHead>
              <TableHead className="text-xs">SKU</TableHead>
              <TableHead className="text-xs text-right">Qty</TableHead>
              <TableHead className="text-xs text-right">Cost</TableHead>
              <TableHead className="text-xs text-right">Sell</TableHead>
              <TableHead className="text-xs text-right w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <div className="flex justify-center"><div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="empty-state">
                    <Package className="empty-state-icon" />
                    <p className="text-sm">No items found</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : filtered.map(item => (
              <TableRow key={item.id} className="hover:bg-muted/30">
                <TableCell className="font-medium text-sm">{item.name}</TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">{item.sku}</TableCell>
                <TableCell className={`text-right text-sm font-semibold ${item.quantity <= item.low_stock_threshold ? 'text-destructive' : ''}`}>
                  {item.quantity}
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">{peso(Number(item.cost_price))}</TableCell>
                <TableCell className="text-right text-sm">{peso(Number(item.selling_price))}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(item)} className="h-7 w-7 rounded-md">
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(item.id)} className="h-7 w-7 rounded-md">
                      <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                    </Button>
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
