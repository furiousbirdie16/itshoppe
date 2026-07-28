import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface Branch {
  id: string;
  branch_name: string;
  branch_code: string;
  is_active: boolean;
}

interface BranchContextType {
  /** Branches the current user is allowed to see. Admins see all active branches. */
  branches: Branch[];
  /** Active branch id, or `null` when admin has picked "All branches". */
  activeBranchId: string | null;
  activeBranch: Branch | null;
  setActiveBranchId: (id: string | null) => void;
  /** Admins may switch to "All branches" (null). Regular users cannot. */
  canPickAll: boolean;
  loading: boolean;
}

const BranchContext = createContext<BranchContextType>({
  branches: [],
  activeBranchId: null,
  activeBranch: null,
  setActiveBranchId: () => {},
  canPickAll: false,
  loading: true,
});

export const useBranch = () => useContext(BranchContext);

const STORAGE_KEY = "active_branch_id";

export function BranchProvider({ children }: { children: ReactNode }) {
  const { user, role, loading: authLoading } = useAuth();
  const canPickAll = role === "admin";

  const { data: branches = [], isLoading } = useQuery<Branch[]>({
    queryKey: ["branches", user?.id, role],
    enabled: !!user && !authLoading,
    queryFn: async () => {
      if (role === "admin") {
        const { data, error } = await (supabase as any)
          .from("branches")
          .select("id, branch_name, branch_code, is_active")
          .eq("is_active", true)
          .order("branch_code");
        if (error) throw error;
        return data || [];
      }
      // Non-admin: only branches assigned via user_branches
      const { data, error } = await (supabase as any)
        .from("user_branches")
        .select("branch:branches(id, branch_name, branch_code, is_active)")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data || [])
        .map((r: any) => r.branch)
        .filter((b: Branch | null) => b && b.is_active);
    },
  });

  const [activeBranchId, setActiveBranchIdState] = useState<string | null>(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return stored === "ALL" ? null : stored;
  });

  // Ensure the stored active branch is still valid for this user.
  useEffect(() => {
    if (isLoading || authLoading) return;
    if (activeBranchId && !branches.some((b) => b.id === activeBranchId)) {
      // Fallback to first available branch (or null for admin)
      const fallback = canPickAll ? null : branches[0]?.id ?? null;
      setActiveBranchIdState(fallback);
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, fallback ?? "ALL");
      }
    } else if (activeBranchId === null && !canPickAll && branches.length > 0) {
      const first = branches[0].id;
      setActiveBranchIdState(first);
      if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, first);
    }
  }, [branches, isLoading, authLoading, activeBranchId, canPickAll]);

  const setActiveBranchId = (id: string | null) => {
    setActiveBranchIdState(id);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, id ?? "ALL");
    }
  };

  const activeBranch = useMemo(
    () => branches.find((b) => b.id === activeBranchId) ?? null,
    [branches, activeBranchId],
  );

  return (
    <BranchContext.Provider
      value={{
        branches,
        activeBranchId,
        activeBranch,
        setActiveBranchId,
        canPickAll,
        loading: authLoading || isLoading,
      }}
    >
      {children}
    </BranchContext.Provider>
  );
}
