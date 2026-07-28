import { Building2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBranch } from "@/contexts/BranchContext";

const ALL = "__ALL__";

export function BranchSwitcher() {
  const { branches, activeBranchId, setActiveBranchId, canPickAll, loading } = useBranch();

  if (loading) return null;
  if (branches.length === 0) return null;

  const value = activeBranchId ?? ALL;

  return (
    <Select
      value={value}
      onValueChange={(v) => setActiveBranchId(v === ALL ? null : v)}
    >
      <SelectTrigger className="h-8 w-auto min-w-[140px] gap-1.5 text-xs">
        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {canPickAll && <SelectItem value={ALL} className="text-xs">All branches</SelectItem>}
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id} className="text-xs">
            {b.branch_name} <span className="text-muted-foreground">({b.branch_code})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default BranchSwitcher;
