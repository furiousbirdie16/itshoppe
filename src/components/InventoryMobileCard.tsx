import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { peso } from "@/lib/currency";
import {
  ArrowLeftRight, ClipboardEdit, History, DollarSign, Truck, Layers,
  Pencil, Archive, ArchiveRestore, Trash2,
} from "lucide-react";

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export function getStockStatus(qty: number, threshold: number): StockStatus {
  if (qty <= 0) return "out_of_stock";
  if (threshold > 0 && qty <= threshold) return "low_stock";
  return "in_stock";
}

const STATUS_META: Record<StockStatus, { label: string; className: string }> = {
  in_stock: { label: "In Stock", className: "bg-primary/10 text-primary border-primary/20" },
  low_stock: { label: "Low Stock", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  out_of_stock: { label: "Out of Stock", className: "bg-destructive/10 text-destructive border-destructive/20" },
};

interface Props {
  item: any;
  branchLabel: string;
  isAdmin: boolean;
  viewArchived: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onTransfer: () => void;
  onAdjust: () => void;
  onHistory: () => void;
  /** Omitted for non-admins — cost history is admin-only. */
  onPricing?: () => void;
  onSuppliers: () => void;
  onBundles: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}

function Field({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-medium truncate ${className || ""}`}>{value}</div>
    </div>
  );
}

function IconAction({ icon: Icon, label, onClick, danger, primary }: { icon: any; label: string; onClick: () => void; danger?: boolean; primary?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="h-9 w-9 shrink-0 rounded-md border bg-background"
    >
      <Icon className={`h-4 w-4 ${danger ? "text-destructive/80" : primary ? "text-primary" : "text-muted-foreground"}`} />
    </Button>
  );
}

export function InventoryMobileCard({
  item, branchLabel, isAdmin, viewArchived, selected, onToggleSelect,
  onTransfer, onAdjust, onHistory, onPricing, onSuppliers, onBundles,
  onEdit, onArchive, onRestore, onDelete,
}: Props) {
  const qty = Number(item.quantity ?? 0);
  const threshold = Number(item.low_stock_threshold ?? 0);
  const status = STATUS_META[getStockStatus(qty, threshold)];
  const unit = item.base_unit || "pcs";
  const source = (item.source as string) || "local";
  const canSeeCost = isAdmin || source === "local";
  const openRoll = Number(item.open_roll_remaining ?? 0);
  const invValue = qty * Number(item.cost_price || 0);

  return (
    <div className={`rounded-xl border bg-card p-3 space-y-3 ${selected ? "ring-1 ring-primary" : ""}`}>
      <div className="flex items-start gap-2.5">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label={`Select ${item.name}`}
          className="mt-1"
        />
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold leading-snug break-words">{item.name}</div>
          <div className="mt-0.5 font-mono text-xs text-muted-foreground break-all">{item.sku}</div>
        </div>
        <Badge variant="outline" className={`shrink-0 text-[10px] ${status.className}`}>{status.label}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="text-[10px] uppercase">{branchLabel}</Badge>
        <Badge variant={source === "import" ? "secondary" : "outline"} className="text-[10px] uppercase">{source}</Badge>
        {item.status && item.status !== "active" && (
          <Badge variant="outline" className="text-[10px] uppercase">{item.status}</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t pt-2.5">
        <Field
          label="Current Stock"
          value={
            <>
              {qty} <span className="text-xs font-normal text-muted-foreground">{unit}</span>
              {openRoll > 0 && (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">+{openRoll} open</span>
              )}
            </>
          }
          className={threshold > 0 && qty <= threshold ? "text-destructive" : ""}
        />
        <Field label="Unit" value={unit} />
        {isAdmin && <Field label="Inventory Value" value={peso(invValue)} />}
        <Field label="Cost Price" value={canSeeCost ? peso(Number(item.cost_price || 0)) : "—"} />
        <Field label="Selling Price" value={peso(Number(item.selling_price || 0))} />
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto border-t pt-2.5">
        {!viewArchived && (
          <>
            <IconAction icon={ArrowLeftRight} label="Transfer stock" onClick={onTransfer} />
            <IconAction icon={ClipboardEdit} label="Adjust stock" onClick={onAdjust} />
          </>
        )}
        <IconAction icon={History} label="Stock history" onClick={onHistory} />
        {onPricing && <IconAction icon={DollarSign} label="Pricing" onClick={onPricing} />}
        <IconAction icon={Truck} label="Purchase orders / suppliers" onClick={onSuppliers} />
        {!viewArchived && <IconAction icon={Layers} label="Bundles" onClick={onBundles} />}
        {isAdmin && !viewArchived && (
          <>
            <IconAction icon={Pencil} label="Edit" onClick={onEdit} />
            <IconAction icon={Archive} label="Archive" onClick={onArchive} />
            <IconAction icon={Trash2} label="Delete" onClick={onDelete} danger />
          </>
        )}
        {isAdmin && viewArchived && (
          <IconAction icon={ArchiveRestore} label="Restore" onClick={onRestore} primary />
        )}
      </div>
    </div>
  );
}

export default InventoryMobileCard;
