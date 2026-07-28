import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Building2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  userId: string;
}

interface Branch {
  id: string;
  branch_name: string;
  branch_code: string;
}

export function UserBranchesCell({ userId }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ["branches", "all-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("branches")
        .select("id, branch_name, branch_code")
        .eq("is_active", true)
        .order("branch_code");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: assigned = [] } = useQuery<string[]>({
    queryKey: ["user-branches", userId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("user_branches")
        .select("branch_id")
        .eq("user_id", userId);
      if (error) throw error;
      return (data || []).map((r: any) => r.branch_id);
    },
  });

  const assignedSet = useMemo(() => new Set(assigned), [assigned]);

  const toggleMut = useMutation({
    mutationFn: async ({ branchId, on }: { branchId: string; on: boolean }) => {
      if (on) {
        const { error } = await (supabase as any)
          .from("user_branches")
          .insert({ user_id: userId, branch_id: branchId });
        if (error && !`${error.message}`.includes("duplicate")) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("user_branches")
          .delete()
          .eq("user_id", userId)
          .eq("branch_id", branchId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-branches", userId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const label = assigned.length === 0
    ? "None"
    : branches.filter((b) => assignedSet.has(b.id)).map((b) => b.branch_code).join(", ");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs font-normal">
          <Building2 className="h-3 w-3" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <div className="text-[11px] uppercase text-muted-foreground px-1 pb-1.5">Assigned branches</div>
        <div className="space-y-1">
          {branches.map((b) => {
            const on = assignedSet.has(b.id);
            return (
              <label
                key={b.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
              >
                <Checkbox
                  checked={on}
                  onCheckedChange={(v) => toggleMut.mutate({ branchId: b.id, on: !!v })}
                />
                <span className="flex-1">{b.branch_name}</span>
                <span className="text-xs text-muted-foreground">{b.branch_code}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default UserBranchesCell;
