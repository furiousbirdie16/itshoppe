import { Layers } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";

/**
 * A strip on stock pages while "All branches" is picked: the numbers are every
 * branch added together, which reads as wrong when counting one branch's
 * shelves.
 */
export function AllBranchesNotice() {
  const { activeBranchId, branches, setActiveBranchId, homeBranchId } = useBranch();
  if (activeBranchId !== null || branches.length < 2) return null;
  const home = branches.find((b) => b.id === homeBranchId);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/50 dark:bg-amber-950/30 dark:text-amber-200">
      <Layers className="h-4 w-4 shrink-0" />
      <span className="flex-1 min-w-[200px]">
        Showing <strong>all branches combined</strong>. Each stock figure shows its branch split underneath — pick one branch to count its shelves.
      </span>
      {home && (
        <button type="button" onClick={() => setActiveBranchId(home.id)} className="font-medium underline underline-offset-2">
          Switch to {home.branch_name}
        </button>
      )}
    </div>
  );
}

export default AllBranchesNotice;
