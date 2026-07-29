import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ArrowRight, ClipboardList, Send, CheckCircle2, PackageCheck, XCircle, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { getItems } from "@/lib/api";
import type { Item, ItemVariation } from "@/types/database";
import { ItemSearch } from "@/components/ItemSearch";
import {
  listStockTransfers,
  getTransferItems,
  getTransferAudit,
  createTransfer,
  transitionTransfer,
  dispatchTransfer,
  receiveTransfer,
  cancelTransfer,
  deleteTransfer,
  STATUS_META,
  type StockTransfer,
  type StockTransferStatus,
} from "@/lib/stockTransfers";

interface LineDraft {
  id: string;
  item_id: string;
  item_name: string;
  variation_id: string | null;
  variation_name?: string;
  quantity: string;
  source_location: "warehouse" | "store";
  destination_location: "warehouse" | "store";
}

const emptyLine = (): LineDraft => ({
  id: crypto.randomUUID(),
  item_id: "",
  item_name: "",
  variation_id: null,
  quantity: "",
  source_location: "warehouse",
  destination_location: "warehouse",
});

export default function StockTransfersPage() {
  const qc = useQueryClient();
  const { branches, activeBranchId } = useBranch();
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const [statusFilter, setStatusFilter] = useState<"all" | StockTransferStatus>("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);

  const { data: transfers = [], isLoading } = useQuery({
    queryKey: ["stock_transfers", activeBranchId],
    queryFn: () => listStockTransfers(activeBranchId),
  });

  const { data: items = [] } = useQuery({ queryKey: ["items"], queryFn: getItems });

  const filtered = useMemo(() => {
    return transfers.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        if (!t.transfer_number.toLowerCase().includes(s) && !(t.notes || "").toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [transfers, statusFilter, search]);

  // Create form state
  const [srcBranch, setSrcBranch] = useState<string>(activeBranchId ?? "");
  const [dstBranch, setDstBranch] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const resetCreate = () => {
    setSrcBranch(activeBranchId ?? "");
    setDstBranch("");
    setNotes("");
    setLines([emptyLine()]);
  };

  const openCreate = () => {
    resetCreate();
    setCreateOpen(true);
  };

  const createMut = useMutation({
    mutationFn: async () => {
      if (!srcBranch || !dstBranch) throw new Error("Select source and destination branches");
      if (srcBranch === dstBranch) throw new Error("Source and destination must differ");
      const valid = lines.filter((l) => l.item_id && Number(l.quantity) > 0);
      if (valid.length === 0) throw new Error("Add at least one item with quantity");
      await createTransfer({
        source_branch_id: srcBranch,
        destination_branch_id: dstBranch,
        notes,
        lines: valid.map((l) => ({
          item_id: l.item_id,
          variation_id: l.variation_id,
          quantity: Number(l.quantity),
          source_location: l.source_location,
          destination_location: l.destination_location,
        })),
      });
    },
    onSuccess: () => {
      toast.success("Transfer created");
      qc.invalidateQueries({ queryKey: ["stock_transfers"] });
      setCreateOpen(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create transfer"),
  });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ClipboardList className="h-5 w-5" /> Stock Transfers
          </h1>
          <p className="text-xs text-muted-foreground">Move inventory between branches with approval &amp; receipt workflow.</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> New Transfer
        </Button>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search transfer #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-56 text-xs"
          />
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(STATUS_META).map(([k, m]) => (
                <SelectItem key={k} value={k}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto text-xs text-muted-foreground">
            {filtered.length} of {transfers.length}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transfer #</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Dispatched</TableHead>
                <TableHead>Received</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-8">Loading...</TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-8">No transfers.</TableCell>
                </TableRow>
              ) : (
                filtered.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.transfer_number}</TableCell>
                    <TableCell>
                      <span className="text-xs">
                        {t.source_branch?.branch_code} <ArrowRight className="inline h-3 w-3" /> {t.destination_branch?.branch_code}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-[10px]", STATUS_META[t.status].className)}>
                        {STATUS_META[t.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{t.requested_at ? format(new Date(t.requested_at), "MMM d, yyyy") : "—"}</TableCell>
                    <TableCell className="text-xs">{t.dispatched_at ? format(new Date(t.dispatched_at), "MMM d, yyyy") : "—"}</TableCell>
                    <TableCell className="text-xs">{t.received_at ? format(new Date(t.received_at), "MMM d, yyyy") : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setViewId(t.id)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>New Stock Transfer</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Source Branch</Label>
                <Select value={srcBranch} onValueChange={setSrcBranch}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.branch_name} ({b.branch_code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Destination Branch</Label>
                <Select value={dstBranch} onValueChange={setDstBranch}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select destination" />
                  </SelectTrigger>
                  <SelectContent>
                    {(isAdmin
                      ? branches.filter((b) => b.id !== srcBranch)
                      : branches.filter((b) => b.id !== srcBranch)
                    ).map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.branch_name} ({b.branch_code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">Line Items</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => setLines((l) => [...l, emptyLine()])}>
                  <Plus className="h-3 w-3 mr-1" /> Add Line
                </Button>
              </div>
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[38%]">Item</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead className="w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, idx) => (
                      <TableRow key={l.id}>
                        <TableCell>
                          <ItemSearch
                            items={items as Item[]}
                            value={l.item_id}
                            variationId={l.variation_id}
                            onChange={(itemId, item, _custom, variation) => {
                              setLines((prev) =>
                                prev.map((p, i) =>
                                  i === idx
                                    ? {
                                        ...p,
                                        item_id: itemId,
                                        item_name: item?.name || "",
                                        variation_id: variation?.id ?? null,
                                        variation_name: variation?.name,
                                      }
                                    : p
                                )
                              );
                            }}
                            placeholder="Search item..."
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            className="h-8 w-20"
                            value={l.quantity}
                            onChange={(e) => setLines((prev) => prev.map((p, i) => (i === idx ? { ...p, quantity: e.target.value } : p)))}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={l.source_location}
                            onValueChange={(v) => setLines((prev) => prev.map((p, i) => (i === idx ? { ...p, source_location: v as any } : p)))}
                          >
                            <SelectTrigger className="h-8 w-28 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="warehouse">Warehouse</SelectItem>
                              <SelectItem value="store">Store</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={l.destination_location}
                            onValueChange={(v) => setLines((prev) => prev.map((p, i) => (i === idx ? { ...p, destination_location: v as any } : p)))}
                          >
                            <SelectTrigger className="h-8 w-28 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="warehouse">Warehouse</SelectItem>
                              <SelectItem value="store">Store</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                            disabled={lines.length === 1}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
              {createMut.isPending ? "Saving..." : "Create Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {viewId && (
        <TransferDetailDialog
          transferId={viewId}
          transfer={transfers.find((t) => t.id === viewId) || null}
          isAdmin={isAdmin}
          onClose={() => setViewId(null)}
        />
      )}
    </div>
  );
}

function TransferDetailDialog({
  transferId,
  transfer,
  isAdmin,
  onClose,
}: {
  transferId: string;
  transfer: StockTransfer | null;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: items = [] } = useQuery({
    queryKey: ["stock_transfer_items", transferId],
    queryFn: () => getTransferItems(transferId),
  });
  const { data: audit = [] } = useQuery({
    queryKey: ["stock_transfer_audit", transferId],
    queryFn: () => getTransferAudit(transferId),
  });

  const [cancelReason, setCancelReason] = useState("");
  const [receiveDraft, setReceiveDraft] = useState<Record<string, string>>({});

  const runMut = useMutation({
    mutationFn: async (fn: () => Promise<void>) => fn(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_transfers"] });
      qc.invalidateQueries({ queryKey: ["stock_transfer_items", transferId] });
      qc.invalidateQueries({ queryKey: ["stock_transfer_audit", transferId] });
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["item_branch_stock"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Action failed"),
  });

  if (!transfer) return null;
  const status = transfer.status;

  const canSubmit = status === "draft";
  const canApprove = status === "pending_approval";
  const canDispatch = status === "approved" || status === "pending_approval";
  const canReceive = status === "in_transit";
  const canCancel = ["draft", "pending_approval", "approved"].includes(status) || (status === "in_transit" && isAdmin);
  const canDelete = status === "draft" || status === "cancelled";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {transfer.transfer_number}
            <Badge variant="outline" className={cn("text-[10px]", STATUS_META[status].className)}>
              {STATUS_META[status].label}
            </Badge>
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {transfer.source_branch?.branch_name} ({transfer.source_branch?.branch_code}) <ArrowRight className="inline h-3 w-3" />{" "}
            {transfer.destination_branch?.branch_name} ({transfer.destination_branch?.branch_code})
          </p>
        </DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <Actor label="Requested By" email={transfer.requested_by_email} at={transfer.requested_at} />
          <Actor label="Approved By" email={transfer.approved_by_email} at={transfer.approved_at} />
          <Actor label="Dispatched By" email={transfer.dispatched_by_email} at={transfer.dispatched_at} />
          <Actor label="Received By" email={transfer.received_by_email} at={transfer.received_at} />
        </div>

        {transfer.notes && <p className="text-xs text-muted-foreground border rounded-md p-2">Notes: {transfer.notes}</p>}

        <div>
          <Label className="text-xs mb-1 block">Items</Label>
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  {canReceive && <TableHead>Receive Now</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((li) => (
                  <TableRow key={li.id}>
                    <TableCell className="text-xs">
                      {li.items?.name || "—"}
                      {li.item_variations?.name && <span className="text-muted-foreground"> · {li.item_variations.name}</span>}
                    </TableCell>
                    <TableCell className="text-xs">{Number(li.quantity)}</TableCell>
                    <TableCell className="text-xs">{Number(li.received_quantity)}</TableCell>
                    <TableCell className="text-xs">{li.source_location}</TableCell>
                    <TableCell className="text-xs">{li.destination_location}</TableCell>
                    {canReceive && (
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          max={Number(li.quantity) - Number(li.received_quantity)}
                          className="h-7 w-20 text-xs"
                          value={receiveDraft[li.id] ?? ""}
                          onChange={(e) => setReceiveDraft((prev) => ({ ...prev, [li.id]: e.target.value }))}
                          placeholder={String(Number(li.quantity) - Number(li.received_quantity))}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <div>
          <Label className="text-xs mb-1 block">Audit Trail</Label>
          <div className="border rounded-md max-h-40 overflow-y-auto text-xs">
            {audit.length === 0 ? (
              <p className="p-2 text-muted-foreground">No events yet.</p>
            ) : (
              <ul className="divide-y">
                {audit.map((a) => (
                  <li key={a.id} className="px-2 py-1.5 flex items-center justify-between">
                    <span>
                      <span className="font-medium">{a.action}</span>
                      {a.from_status && a.to_status && (
                        <span className="text-muted-foreground"> ({a.from_status} → {a.to_status})</span>
                      )}
                      {a.notes && <span className="text-muted-foreground"> — {a.notes}</span>}
                    </span>
                    <span className="text-muted-foreground">
                      {a.actor_email || "system"} · {format(new Date(a.created_at), "MMM d, HH:mm")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {canCancel && (
          <div>
            <Label className="text-xs">Cancel reason (optional)</Label>
            <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="h-8" />
          </div>
        )}

        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {canDelete && (
            <Button
              variant="outline"
              onClick={() => {
                if (!confirm("Delete this transfer permanently?")) return;
                runMut.mutate(async () => {
                  await deleteTransfer(transferId);
                  toast.success("Transfer deleted");
                  onClose();
                });
              }}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          )}
          {canCancel && (
            <Button
              variant="destructive"
              onClick={() =>
                runMut.mutate(async () => {
                  await cancelTransfer(transferId, cancelReason);
                  toast.success("Transfer cancelled");
                })
              }
            >
              <XCircle className="h-4 w-4 mr-1" /> Cancel Transfer
            </Button>
          )}
          {canSubmit && (
            <Button
              variant="outline"
              onClick={() =>
                runMut.mutate(async () => {
                  await transitionTransfer(transferId, "pending_approval");
                  toast.success("Submitted for approval");
                })
              }
            >
              <Send className="h-4 w-4 mr-1" /> Submit for Approval
            </Button>
          )}
          {canApprove && (
            <Button
              onClick={() =>
                runMut.mutate(async () => {
                  await transitionTransfer(transferId, "approved");
                  toast.success("Transfer approved");
                })
              }
            >
              <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
            </Button>
          )}
          {canDispatch && (
            <Button
              onClick={() =>
                runMut.mutate(async () => {
                  await dispatchTransfer(transferId);
                  toast.success("Dispatched — stock now in transit");
                })
              }
            >
              <Send className="h-4 w-4 mr-1" /> Dispatch
            </Button>
          )}
          {canReceive && (
            <Button
              onClick={() =>
                runMut.mutate(async () => {
                  const payload = items
                    .map((li) => {
                      const remaining = Number(li.quantity) - Number(li.received_quantity);
                      const draft = receiveDraft[li.id];
                      const qty = draft === "" || draft === undefined ? remaining : Number(draft);
                      return { id: li.id, received_quantity: qty };
                    })
                    .filter((r) => r.received_quantity > 0);
                  if (payload.length === 0) throw new Error("Nothing to receive");
                  await receiveTransfer(transferId, payload);
                  toast.success("Receipt recorded");
                })
              }
            >
              <PackageCheck className="h-4 w-4 mr-1" /> Receive
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Actor({ label, email, at }: { label: string; email: string | null; at: string | null }) {
  return (
    <div className="border rounded-md p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="truncate">{email || "—"}</div>
      <div className="text-[10px] text-muted-foreground">{at ? format(new Date(at), "MMM d, yyyy HH:mm") : ""}</div>
    </div>
  );
}
