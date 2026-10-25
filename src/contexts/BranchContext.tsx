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
  /** The branch the app opens in on this device, or null when none is set. */
  homeBranchId: string | null;
  setHomeBranchId: (id: string | null) => void;
  loading: boolean;
}

const BranchContext = createContext<BranchContextType>({
  branches: [],
  activeBranchId: null,
  activeBranch: null,
  setActiveBranchId: () => {},
  canPickAll: false,
  homeBranchId: null,
  setHomeBranchId: () => {},
  loading: true,
});

export const useBranch = () => useContext(BranchContext);

// The last single branch picked on this device.
const STORAGE_KEY = "active_branch_id";
// The branch the app opens in, set with the star beside the picker.
const HOME_KEY = "home_branch_id";
// This visit's pick, including "All branches". Kept for the session only, so
// a combined view chosen yesterday does not greet you today: forgetting it was
// on made stock counts read double.
const SESSION_KEY = "active_branch_session";

const read = (store: "local" | "session", key: string): string | null => {
  try {
    return (store === "local" ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
};
const write = (store: "local" | "session", key: string, value: string | null) => {
  try {
    const s = store === "local" ? localStorage : sessionStorage;
    if (value === null) s.removeItem(key); else s.setItem(key, value);
  } catch {
    // Storage blocked: the choice just will not be remembered.
  }
};

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

  const [homeBranchId, setHomeBranchIdState] = useState<string | null>(() => read("local", HOME_KEY));

  // Opening order: this session's pick, then the home branch, then the last
  // single branch used. "All branches" is only ever a session pick.
  const [activeBranchId, setActiveBranchIdState] = useState<string | null>(() => {
    const session = read("session", SESSION_KEY);
    if (session) return session === "ALL" ? null : session;
    const home = read("local", HOME_KEY);
    if (home) return home;
    const last = read("local", STORAGE_KEY);
    return last && last !== "ALL" ? last : null;
  });

  // Ensure the stored active branch is still valid for this user.
  useEffect(() => {
    if (isLoading || authLoading) return;
    if (activeBranchId && !branches.some((b) => b.id === activeBranchId)) {
      // Fallback to first available branch (or null for admin)
      const fallback = canPickAll ? null : branches[0]?.id ?? null;
      setActiveBranchIdState(fallback);
      write("session", SESSION_KEY, fallback ?? "ALL");
    } else if (activeBranchId === null && !canPickAll && branches.length > 0) {
      const first = branches[0].id;
      setActiveBranchIdState(first);
      write("local", STORAGE_KEY, first);
    }
    // A home branch this user can no longer see is dropped.
    if (homeBranchId && branches.length > 0 && !branches.some((b) => b.id === homeBranchId)) {
      setHomeBranchIdState(null);
      write("local", HOME_KEY, null);
    }
  }, [branches, isLoading, authLoading, activeBranchId, canPickAll, homeBranchId]);

  const setActiveBranchId = (id: string | null) => {
    setActiveBranchIdState(id);
    write("session", SESSION_KEY, id ?? "ALL");
    if (id) write("local", STORAGE_KEY, id);
  };

  const setHomeBranchId = (id: string | null) => {
    setHomeBranchIdState(id);
    write("local", HOME_KEY, id);
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
        homeBranchId,
        setHomeBranchId,
        loading: authLoading || isLoading,
      }}
    >
      {children}
    </BranchContext.Provider>
  );
}
