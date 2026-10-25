import { Building2, Layers, Star } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useBranch } from "@/contexts/BranchContext";
import { cn } from "@/lib/utils";

const ALL = "__ALL__";

export function BranchSwitcher() {
  const { branches, activeBranchId, setActiveBranchId, canPickAll, homeBranchId, setHomeBranchId, loading } = useBranch();

  if (loading) return null;
  if (branches.length === 0) return null;

  const value = activeBranchId ?? ALL;
  // Every branch's stock added together. Easy to forget it is on, so it looks
  // different from picking a single branch.
  const combined = activeBranchId === null && branches.length > 1;
  const isHome = !!activeBranchId && activeBranchId === homeBranchId;
  const active = branches.find((b) => b.id === activeBranchId);

  return (
    <div className="flex items-center gap-0.5">
      <Select
        value={value}
        onValueChange={(v) => setActiveBranchId(v === ALL ? null : v)}
      >
        <SelectTrigger
          className={cn(
            "h-8 w-auto min-w-[140px] gap-1.5 text-xs",
            combined && "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-500/60 dark:bg-amber-950/40 dark:text-amber-200",
          )}
          aria-label="Branch"
        >
          {combined ? <Layers className="h-3.5 w-3.5 text-amber-600" /> : <Building2 className="h-3.5 w-3.5 text-muted-foreground" />}
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {canPickAll && <SelectItem value={ALL} className="text-xs">All branches (combined)</SelectItem>}
          {branches.map((b) => (
            <SelectItem key={b.id} value={b.id} className="text-xs">
              {b.branch_name} <span className="text-muted-foreground">({b.branch_code})</span>
              {b.id === homeBranchId && <span className="text-muted-foreground"> · home</span>}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* The branch the app opens in. Only a single branch can be home. */}
      {branches.length > 1 && activeBranchId && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg"
          onClick={() => setHomeBranchId(isHome ? null : activeBranchId)}
          title={isHome ? `${active?.branch_name} is your home branch — the app opens here. Click to unset.` : `Make ${active?.branch_name} your home branch — the app will open here`}
          aria-label={isHome ? "Unset home branch" : "Set as home branch"}
          aria-pressed={isHome}
        >
          <Star className={cn("h-4 w-4", isHome ? "fill-amber-400 text-amber-500" : "text-muted-foreground")} />
        </Button>
      )}
    </div>
  );
}

export default BranchSwitcher;
