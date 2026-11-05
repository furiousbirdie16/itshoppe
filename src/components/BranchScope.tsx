import { useBranch } from "@/contexts/BranchContext";

/**
 * The branch a page is showing, in teal at the start of its subtitle: the
 * one coloured word under every title, and the one people most need to know.
 */
export function BranchScope() {
  const { activeBranch } = useBranch();
  return (
    <span className="font-medium text-primary">
      {activeBranch ? `${activeBranch.branch_name} branch` : "All branches"}
    </span>
  );
}
