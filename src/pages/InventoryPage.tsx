import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getItems, createItem, updateItem, deleteItem } from "@/lib/api";
import { peso } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, Search, Package, Upload } from "lucide-react";
import ExportButton from "@/components/ExportButton";
import { toast } from "sonner";
import type { Item } from "@/types/database";
import BulkUploadDialog from "@/components/BulkUploadDialog";
import { useAuth } from "@/contexts/AuthContext";

export default function InventoryPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [filter, setFilter] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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
    const data: any = { name: form.name, sku: form.sku, description: form.description, selling_price: parseFloat(form.selling_price), low_stock_threshold: parseInt(form.low_stock_threshold) };
    if (isAdmin) data.cost_price = parseFloat(form.cost_price);
    if (!editing) {
      data.quantity = parseInt(form.quantity) || 0;
      createMut.mutate(data);
    } else {
      if (!isAdmin) {
        toast.error("Only admins can edit inventory items");
        return;
      }
      data.quantity = parseInt(form.quantity) || 0;
      updateMut.mutate({ id: editing.id, data });
    }
  };

  const filtered = items.filter(i => i.name.toLowerCase().includes(filter.toLowerCase()) || i.sku.toLowerCase().includes(filter.toLowerCase()));

  const allSelected = filtered.length > 0 && filtered.every(i => selectedIds.has(i.id));
  const someSelected = filtered.some(i => selectedIds.has(i.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(i => i.id)));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const bulkDeleteMut = useMutation({
    mutationFn: async () => {
      for (const id of selectedIds) await deleteItem(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      setSelectedIds(new Set());
      toast.success(`Deleted ${selectedIds.size} items`);
    },
  });

  const colCount = (isAdmin ? 7 : 6);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">Inventory</h1>
          <p className="page-description">{items.length} items in stock</p>
        </div>
        <div className="flex gap-2">
          <ExportButton
            data={items}
            columns={{ "Name": (r: any) => r.name, "SKU": (r: any) => r.sku, "Description": (r: any) => r.description, "Quantity": (r: any) => r.quantity, "Cost Price": (r: any) => r.cost_price, "Selling Price": (r: any) => r.selling_price }}
            dateField={(r: any) => r.created_at?.split("T")[0] || ""}
            fileName="Inventory"
          />
          <Button variant="outline" onClick={() => setBulkOpen(true)} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Upload className="h-4 w-4 mr-1.5" /> Bulk Upload
          </Button>
          <Button onClick={openCreate} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Plus className="h-4 w-4 mr-1.5" /> Add Item
          </Button>
        </div>
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
            {(!editing || isAdmin) && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{editing ? "Quantity (Manual Adjust)" : "Initial Quantity"}</Label>
                <Input type="number" min={0} value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="h-9" />
              </div>
            )}
            <div className={`grid ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'} gap-3`}>
              {isAdmin && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Cost Price</Label>
                  <Input type="number" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} className="h-9" />
                </div>
              )}
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

      <BulkUploadDialog open={bulkOpen} onOpenChange={setBulkOpen} onSuccess={() => queryClient.invalidateQueries({ queryKey: ["items"] })} />

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
              {isAdmin && <TableHead className="text-xs text-right">Cost</TableHead>}
              <TableHead className="text-xs text-right">Sell</TableHead>
              <TableHead className="text-xs text-right w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 6 : 5} className="h-32 text-center">
                  <div className="flex justify-center"><div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 6 : 5}>
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
                {isAdmin && <TableCell className="text-right text-sm text-muted-foreground">{peso(Number(item.cost_price))}</TableCell>}
                <TableCell className="text-right text-sm">{peso(Number(item.selling_price))}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    {isAdmin && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(item)} className="h-7 w-7 rounded-md">
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(item.id)} className="h-7 w-7 rounded-md">
                          <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                        </Button>
                      </>
                    )}
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
