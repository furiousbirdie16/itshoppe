import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { UserPlus, Shield, User, Trash2, Search } from "lucide-react";
import { ColumnDef, ColumnVisibilityMenu, useColumnPrefs } from "@/components/ColumnVisibility";

const USER_COLUMNS: ColumnDef[] = [
  { key: "user", label: "User", defaultVisible: true },
  { key: "role", label: "Role", defaultVisible: true },
];

interface ManagedUser {
  id: string;
  email: string;
  display_name: string;
  role: "admin" | "user";
  created_at: string;
}

async function callAdminUsers(action: string, params: Record<string, any> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await supabase.functions.invoke("admin-users", {
    body: { action, ...params },
  });

  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export default function UsersPage() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", password: "", display_name: "", role: "user" });
  const [search, setSearch] = useState("");

  const { data: users = [], isLoading } = useQuery<ManagedUser[]>({
    queryKey: ["admin-users"],
    queryFn: () => callAdminUsers("list"),
    enabled: role === "admin",
  });
  const filteredUsers = users.filter((managedUser) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [managedUser.display_name, managedUser.email, managedUser.role]
      .some((value) => (value || "").toLowerCase().includes(q));
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ user_id, role }: { user_id: string; role: string }) =>
      callAdminUsers("update_role", { user_id, role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("Role updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createUserMutation = useMutation({
    mutationFn: (params: typeof newUser) => callAdminUsers("create", params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("User created");
      setDialogOpen(false);
      setNewUser({ email: "", password: "", display_name: "", role: "user" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (user_id: string) => callAdminUsers("delete", { user_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("User deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (role !== "admin") {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Admin access required</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">User Management</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">Manage team members and their roles · {filteredUsers.length}{filteredUsers.length !== users.length ? ` of ${users.length}` : ""}</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8 text-xs">
              <UserPlus className="h-3.5 w-3.5 mr-1.5" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-base">Create New User</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createUserMutation.mutate(newUser);
              }}
              className="space-y-4 pt-2"
            >
              <div>
                <Label className="text-xs text-muted-foreground">Display Name</Label>
                <Input
                  value={newUser.display_name}
                  onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })}
                  placeholder="Full name"
                  className="h-9 mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Email</Label>
                <Input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="user@example.com"
                  className="h-9 mt-1"
                  required
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Password</Label>
                <Input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  placeholder="Min 6 characters"
                  className="h-9 mt-1"
                  minLength={6}
                  required
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Role</Label>
                <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v })}>
                  <SelectTrigger className="h-9 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full h-9 text-sm" disabled={createUserMutation.isPending}>
                {createUserMutation.isPending ? "Creating..." : "Create User"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {(() => {
        const { state, orderedColumns, visibleColumns, toggle, move, reset } = useColumnPrefs("cols:users", USER_COLUMNS);
        const heads: Record<string, JSX.Element> = {
          user: <TableHead key="h-user" className="text-xs">User</TableHead>,
          role: <TableHead key="h-role" className="text-xs">Role</TableHead>,
        };
        const cells = (u: ManagedUser): Record<string, JSX.Element> => ({
          user: (
            <TableCell key="c-user">
              <div>
                <p className="text-sm font-medium text-foreground">{u.display_name}</p>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </div>
            </TableCell>
          ),
          role: (
            <TableCell key="c-role">
              <Select
                value={u.role}
                onValueChange={(role) => updateRoleMutation.mutate({ user_id: u.id, role })}
                disabled={u.id === user?.id}
              >
                <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin"><span className="flex items-center gap-1.5"><Shield className="h-3 w-3" /> Admin</span></SelectItem>
                  <SelectItem value="user"><span className="flex items-center gap-1.5"><User className="h-3 w-3" /> User</span></SelectItem>
                </SelectContent>
              </Select>
            </TableCell>
          ),
        });
        return (
          <>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="relative max-w-sm flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search users..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <ColumnVisibilityMenu columns={orderedColumns} visible={state.visible} onToggle={toggle} onMove={move} onReset={reset} />
            </div>

            <div className="rounded-xl border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    {visibleColumns.map((c) => heads[c.key])}
                    <TableHead className="text-xs text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={visibleColumns.length + 1} className="text-center text-sm text-muted-foreground py-8">Loading...</TableCell></TableRow>
                  ) : filteredUsers.length === 0 ? (
                    <TableRow><TableCell colSpan={visibleColumns.length + 1} className="text-center text-sm text-muted-foreground py-8">No users found</TableCell></TableRow>
                  ) : (
                    filteredUsers.map((u) => {
                      const rc = cells(u);
                      return (
                        <TableRow key={u.id}>
                          {visibleColumns.map((c) => rc[c.key])}
                          <TableCell className="text-right">
                            {u.id !== user?.id && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => { if (confirm(`Delete ${u.email}?`)) deleteUserMutation.mutate(u.id); }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        );
      })()}
    </div>
  );
}
