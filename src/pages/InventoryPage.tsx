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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Search, Package, Upload, Layers, ArrowLeftRight } from "lucide-react";
import { VariationsManager } from "@/components/VariationsManager";
import TransferStockDialog from "@/components/TransferStockDialog";
import ExportButton from "@/components/ExportButton";
import { toast } from "sonner";
import type { Item } from "@/types/database";
import BulkUploadDialog from "@/components/BulkUploadDialog";
import BulkEditUploadDialog from "@/components/BulkEditUploadDialog";
import BulkVariationsUploadDialog from "@/components/BulkVariationsUploadDialog";
import { useAuth } from "@/contexts/AuthContext";
import { BulkEditDialog, type BulkField } from "@/components/BulkEditDialog";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";

export default function InventoryPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [filter, setFilter] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkVarOpen, setBulkVarOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<"all" | "local" | "import">("all");
  const [variationsItem, setVariationsItem] = useState<Item | null>(null);
  const [transferItem, setTransferItem] = useState<Item | null>(null);
  const [form, setForm] = useState({ name: "", sku: "", description: "", quantity: "0", cost_price: "0", selling_price: "0", low_stock_threshold: "10", source: "local" as "local" | "import" });

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

  const openCreate = () => { setEditing(null); setForm({ name: "", sku: "", description: "", quantity: "0", cost_price: "0", selling_price: "0", low_stock_threshold: "10", source: "local" }); setOpen(true); };
  const openEdit = (item: Item) => {
    setEditing(item);
    setForm({ name: item.name, sku: item.sku, description: item.description, quantity: String(item.quantity), cost_price: String(item.cost_price), selling_price: String(item.selling_price), low_stock_threshold: String(item.low_stock_threshold), source: ((item.source as "local" | "import") || "local") });
    setOpen(true);
  };

  // Non-admins can edit cost_price ONLY for local items
  const canEditCost = isAdmin || form.source === "local";

  const handleSubmit = () => {
    if (!editing) {
      const data: any = { name: form.name, sku: form.sku, description: form.description, selling_price: parseFloat(form.selling_price), low_stock_threshold: parseInt(form.low_stock_threshold), quantity: parseInt(form.quantity) || 0 };
      if (isAdmin) data.source = form.source;
      else data.source = "local"; // non-admin new items default to local
      if (canEditCost) data.cost_price = parseFloat(form.cost_price);
      createMut.mutate(data);
    } else {
      const data: any = { name: form.name, sku: form.sku, description: form.description, selling_price: parseFloat(form.selling_price), quantity: parseInt(form.quantity) || 0 };
      if (isAdmin) data.source = form.source; // non-admins cannot change source
      if (canEditCost) data.cost_price = parseFloat(form.cost_price);
      if (isAdmin) {
        data.low_stock_threshold = parseInt(form.low_stock_threshold);
      }
      updateMut.mutate({ id: editing.id, data });
    }
  };

  const filtered = items.filter(i => {
    const matchesText = i.name.toLowerCase().includes(filter.toLowerCase()) || i.sku.toLowerCase().includes(filter.toLowerCase());
    const itemSource = ((i as any).source as string) || "local";
    const matchesSource = sourceFilter === "all" || itemSource === sourceFilter;
    return matchesText && matchesSource;
  });

  const { sort, toggle, sorted: sortedFiltered } = useSort<typeof filtered[number]>(filtered, {
    name: (r) => r.name,
    sku: (r) => r.sku,
    source: (r: any) => (r.source as string) || "local",
    quantity: (r) => Number(r.quantity),
    warehouse_quantity: (r: any) => Number(r.warehouse_quantity ?? 0),
    store_quantity: (r: any) => Number(r.store_quantity ?? 0),
    cost_price: (r) => Number(r.cost_price),
    selling_price: (r) => Number(r.selling_price),
    low_stock_threshold: (r) => Number(r.low_stock_threshold ?? 0),
  });

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

  const colCount = 10; // checkbox + name + source + qty + warehouse + store + cost + sell + threshold + actions

  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="page-header mb-0">
          <h1 className="page-title">Inventory</h1>
          <p className="page-description">{items.length} items in stock</p>
        </div>
        <div className="toolbar-actions">
          {selectedIds.size > 0 && (() => {
            const selectedItems = items.filter(i => selectedIds.has(i.id));
            const allLocal = selectedItems.every(i => (((i as any).source as string) || 'local') === 'local');
            const canBulkEditCost = isAdmin || allLocal;
            return (
              <BulkEditDialog
                selectedIds={Array.from(selectedIds)}
                entityLabel="items"
                fields={([
                  { key: "selling_price", label: "Selling Price", type: "number", transform: (v) => parseFloat(v) || 0 },
                  ...(isAdmin ? [
                    { key: "source", label: "Source (Local / Import)", type: "select", options: [{ value: "local", label: "Local" }, { value: "import", label: "Import" }] },
                  ] : []),
                  ...(canBulkEditCost ? [
                    { key: "cost_price", label: "Cost Price", type: "number", transform: (v) => parseFloat(v) || 0 },
                  ] : []),
                  ...(isAdmin ? [
                    { key: "low_stock_threshold", label: "Low Stock Threshold", type: "number", transform: (v) => parseInt(v) || 0 },
                  ] : []),
                  { key: "description", label: "Description", type: "textarea" },
                ]) as BulkField[]}
                updateOne={async (id, patch) => { await updateItem(id, patch as Partial<Item>); }}
                onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["items"] }); setSelectedIds(new Set()); }}
              />
            );
          })()}
          {selectedIds.size > 0 && isAdmin && (
            <Button variant="destructive" onClick={() => bulkDeleteMut.mutate()} disabled={bulkDeleteMut.isPending} className="rounded-lg h-9 px-4 text-sm font-medium">
              <Trash2 className="h-4 w-4 mr-1.5" /> Delete {selectedIds.size} selected
            </Button>
          )}
          <ExportButton
            data={items}
            columns={{
              "Name": (r: any) => r.name,
              "SKU": (r: any) => r.sku,
              "Source": (r: any) => r.source || "local",
              "Description": (r: any) => r.description || "",
              "Base Unit": (r: any) => r.base_unit || "",
              "Units Per Stock": (r: any) => r.units_per_stock || 1,
              "Open Roll Remaining": (r: any) => r.open_roll_remaining || 0,
              "Quantity": (r: any) => r.quantity,
              "Warehouse Qty": (r: any) => r.warehouse_quantity ?? 0,
              "Store Qty": (r: any) => r.store_quantity ?? 0,
              "Low Stock Threshold": (r: any) => r.low_stock_threshold ?? "",
              "Cost Price": (r: any) => r.cost_price,
              "Selling Price": (r: any) => r.selling_price,
              "Created": (r: any) => r.created_at || "",
              "Updated": (r: any) => r.updated_at || "",
            }}
            childItems={{
              table: "item_variations",
              foreignKey: "item_id",
              select: "*",
              columns: {
                "Variation Name": (v: any) => v.name || "",
                "Variation SKU": (v: any) => v.sku || "",
                "Variation Type": (v: any) => v.type || "",
                "Variation Factor": (v: any) => Number(v.factor || 1),
                "Variation Selling Price": (v: any) => Number(v.selling_price || 0),
              },
            }}
            dateField={(r: any) => r.created_at?.split("T")[0] || ""}
            fileName="Inventory"
          />
          <Button variant="outline" onClick={() => setBulkOpen(true)} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Upload className="h-4 w-4 mr-1.5" /> Bulk Upload
          </Button>
          <Button variant="outline" onClick={() => setBulkEditOpen(true)} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Pencil className="h-4 w-4 mr-1.5" /> Bulk Edit (Excel)
          </Button>
          <Button variant="outline" onClick={() => setBulkVarOpen(true)} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Layers className="h-4 w-4 mr-1.5" /> Bulk Variations
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Description</Label>
                <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="resize-none" rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Source</Label>
                <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v as "local" | "import" })} disabled={!isAdmin}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">Local</SelectItem>
                    <SelectItem value="import">Import</SelectItem>
                  </SelectContent>
                </Select>
                {!isAdmin && (
                  <p className="text-[10px] text-muted-foreground">Only admins can change source.</p>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{editing ? "Quantity (Manual Adjust)" : "Initial Quantity"}</Label>
              <Input type="number" min={0} value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="h-9" />
            </div>
            <div className={`grid ${isAdmin ? 'grid-cols-3' : (canEditCost ? 'grid-cols-2' : 'grid-cols-1')} gap-3`}>
              {canEditCost && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Cost Price</Label>
                  <Input type="number" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} className="h-9" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Selling Price</Label>
                <Input type="number" value={form.selling_price} onChange={e => setForm({ ...form, selling_price: e.target.value })} className="h-9" />
              </div>
              {isAdmin && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Low Stock Alert</Label>
                  <Input type="number" value={form.low_stock_threshold} onChange={e => setForm({ ...form, low_stock_threshold: e.target.value })} className="h-9" />
                </div>
              )}
            </div>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending} className="mt-2 rounded-lg h-9">
              {editing ? "Update Item" : "Create Item"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <BulkUploadDialog open={bulkOpen} onOpenChange={setBulkOpen} onSuccess={() => queryClient.invalidateQueries({ queryKey: ["items"] })} />
      <BulkVariationsUploadDialog open={bulkVarOpen} onOpenChange={setBulkVarOpen} onSuccess={() => queryClient.invalidateQueries({ queryKey: ["item_variations"] })} />
      <BulkEditUploadDialog open={bulkEditOpen} onOpenChange={setBulkEditOpen} items={items} isAdmin={isAdmin} onSuccess={() => queryClient.invalidateQueries({ queryKey: ["items"] })} />

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative max-w-xs flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter by name or SKU..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="pl-9 h-9 rounded-lg text-sm"
          />
        </div>
        <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as "all" | "local" | "import")}>
          <SelectTrigger className="h-9 w-[140px] rounded-lg text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="local">Local Only</SelectItem>
            <SelectItem value="import">Import Only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              <SortableHeader sortKey="name" label="Name" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="source" label="Source" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="quantity" label="Total" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="warehouse_quantity" label="Warehouse" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="store_quantity" label="Store" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="cost_price" label="Cost" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="selling_price" label="Sell" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="low_stock_threshold" label="Threshold" sort={sort} onToggle={toggle} align="right" />
              <TableHead className="text-xs text-right w-28">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={colCount} className="h-32 text-center">
                  <div className="flex justify-center"><div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
                </TableCell>
              </TableRow>
            ) : sortedFiltered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount}>
                  <div className="empty-state">
                    <Package className="empty-state-icon" />
                    <p className="text-sm">No items found</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : sortedFiltered.map(item => (
              <TableRow key={item.id} className={`hover:bg-muted/30 ${selectedIds.has(item.id) ? 'bg-muted/40' : ''}`} data-state={selectedIds.has(item.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(item.id)}
                    onCheckedChange={() => toggleOne(item.id)}
                    aria-label={`Select ${item.name}`}
                  />
                </TableCell>
                <TableCell className="font-medium text-sm">{item.name}</TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">{item.sku}</TableCell>
                <TableCell>
                  <Badge variant={((item as any).source === 'import') ? 'secondary' : 'outline'} className="text-[10px] uppercase">
                    {((item as any).source as string) || 'local'}
                  </Badge>
                </TableCell>
                <TableCell className={`text-right text-sm font-semibold ${item.low_stock_threshold > 0 && item.quantity <= item.low_stock_threshold ? 'text-destructive' : ''}`}>
                  {item.quantity}
                  {(item.units_per_stock ?? 1) > 1 && (item.open_roll_remaining ?? 0) > 0 && (
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      + {item.open_roll_remaining}{item.base_unit || 'm'} open
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {(isAdmin || (((item as any).source as string) || 'local') === 'local') ? peso(Number(item.cost_price)) : '—'}
                </TableCell>
                <TableCell className="text-right text-sm">{peso(Number(item.selling_price))}</TableCell>
                <TableCell className="text-right text-sm">
                  <div className="flex items-center justify-end gap-1">
                    <span className={item.low_stock_threshold > 0 && item.quantity <= item.low_stock_threshold ? 'text-destructive font-medium' : 'text-muted-foreground'}>
                      {item.low_stock_threshold ?? 0}
                    </span>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 rounded-md"
                        title="Edit threshold"
                        onClick={() => {
                          const raw = window.prompt(`Set low stock threshold for "${item.name}":`, String(item.low_stock_threshold ?? 0));
                          if (raw === null) return;
                          const n = parseInt(raw);
                          if (Number.isNaN(n) || n < 0) { toast.error("Enter a non-negative number"); return; }
                          updateMut.mutate({ id: item.id, data: { low_stock_threshold: n } as Partial<Item> });
                        }}
                      >
                        <Pencil className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => setVariationsItem(item)} className="h-7 w-7 rounded-md" title="Variations">
                      <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    {isAdmin ? (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(item)} className="h-7 w-7 rounded-md">
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(item.id)} className="h-7 w-7 rounded-md">
                          <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                        </Button>
                      </>
                    ) : (
                      <Button variant="ghost" size="icon" onClick={() => openEdit(item)} className="h-7 w-7 rounded-md">
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {variationsItem && (
        <VariationsManager
          item={variationsItem}
          open={!!variationsItem}
          onOpenChange={(o) => { if (!o) setVariationsItem(null); }}
        />
      )}
    </div>
  );
}
