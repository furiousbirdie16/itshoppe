import { supabase } from "@/integrations/supabase/client";

export type StockTransferStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "in_transit"
  | "received"
  | "cancelled";

export interface StockTransfer {
  id: string;
  transfer_number: string;
  source_branch_id: string;
  destination_branch_id: string;
  status: StockTransferStatus;
  notes: string;
  requested_by_email: string | null;
  requested_at: string | null;
  approved_by_email: string | null;
  approved_at: string | null;
  dispatched_by_email: string | null;
  dispatched_at: string | null;
  received_by_email: string | null;
  received_at: string | null;
  cancelled_by_email: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  source_branch?: { branch_name: string; branch_code: string } | null;
  destination_branch?: { branch_name: string; branch_code: string } | null;
}

export interface StockTransferItem {
  id: string;
  transfer_id: string;
  item_id: string;
  variation_id: string | null;
  quantity: number;
  received_quantity: number;
  source_location: "warehouse" | "store";
  destination_location: "warehouse" | "store";
  items?: { name: string; sku: string } | null;
  item_variations?: { name: string; sku: string | null } | null;
}

export interface StockTransferAudit {
  id: string;
  transfer_id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  actor_email: string | null;
  notes: string | null;
  created_at: string;
}

const anySb = supabase as any;

export const STATUS_META: Record<StockTransferStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  pending_approval: { label: "Pending Approval", className: "bg-warning/15 text-warning" },
  approved: { label: "Approved", className: "bg-primary/15 text-primary" },
  in_transit: { label: "In Transit", className: "bg-accent/20 text-accent-foreground" },
  received: { label: "Received", className: "bg-success/15 text-success" },
  cancelled: { label: "Cancelled", className: "bg-destructive/15 text-destructive" },
};

export async function listStockTransfers(activeBranchId: string | null): Promise<StockTransfer[]> {
  let q = anySb
    .from("stock_transfers")
    .select("*, source_branch:branches!stock_transfers_source_branch_id_fkey(branch_name, branch_code), destination_branch:branches!stock_transfers_destination_branch_id_fkey(branch_name, branch_code)")
    .order("created_at", { ascending: false });
  if (activeBranchId) {
    q = q.or(`source_branch_id.eq.${activeBranchId},destination_branch_id.eq.${activeBranchId}`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as StockTransfer[];
}

export async function getTransferItems(transferId: string): Promise<StockTransferItem[]> {
  const { data, error } = await anySb
    .from("stock_transfer_items")
    .select("*, items(name, sku), item_variations(name, sku)")
    .eq("transfer_id", transferId)
    .order("created_at");
  if (error) throw error;
  return (data || []) as StockTransferItem[];
}

export async function getTransferAudit(transferId: string): Promise<StockTransferAudit[]> {
  const { data, error } = await anySb
    .from("stock_transfer_audit")
    .select("*")
    .eq("transfer_id", transferId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as StockTransferAudit[];
}

async function nextTransferNumber(): Promise<string> {
  const { data, error } = await anySb.from("document_sequences").select("*").eq("id", "STOCK_TRANSFER").single();
  if (error) throw error;
  const seq = data as { prefix: string; next_number: number; padding: number };
  const num = String(seq.next_number).padStart(seq.padding, "0");
  await anySb.from("document_sequences").update({ next_number: seq.next_number + 1 }).eq("id", "STOCK_TRANSFER");
  return `${seq.prefix}-${num}`;
}

export async function createTransfer(input: {
  source_branch_id: string;
  destination_branch_id: string;
  notes: string;
  lines: Array<{ item_id: string; variation_id?: string | null; quantity: number; source_location: "warehouse" | "store"; destination_location: "warehouse" | "store" }>;
}): Promise<StockTransfer> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  const transfer_number = await nextTransferNumber();
  const { data, error } = await anySb
    .from("stock_transfers")
    .insert({
      transfer_number,
      source_branch_id: input.source_branch_id,
      destination_branch_id: input.destination_branch_id,
      notes: input.notes,
      status: "draft",
      requested_by: user?.id ?? null,
      requested_by_email: user?.email ?? null,
      requested_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  const transfer = data as StockTransfer;

  if (input.lines.length > 0) {
    const { error: liErr } = await anySb.from("stock_transfer_items").insert(
      input.lines.map((l) => ({
        transfer_id: transfer.id,
        item_id: l.item_id,
        variation_id: l.variation_id ?? null,
        quantity: l.quantity,
        source_location: l.source_location,
        destination_location: l.destination_location,
      }))
    );
    if (liErr) throw liErr;
  }

  await anySb.from("stock_transfer_audit").insert({
    transfer_id: transfer.id,
    action: "created",
    from_status: null,
    to_status: "draft",
    actor_id: user?.id ?? null,
    actor_email: user?.email ?? null,
  });

  return transfer;
}

/** Statuses at which nothing has moved yet, so the transfer can still be changed. */
export const EDITABLE_TRANSFER_STATUSES = ["draft", "pending_approval", "approved"];

/**
 * Rewrites a transfer that has not been dispatched.
 *
 * Lines are replaced wholesale rather than diffed: they carry no history worth
 * preserving before dispatch, and received_quantity is still zero throughout.
 * Editing stops at dispatch because that is when stock actually leaves the
 * source branch — the database enforces the same cut-off.
 */
export async function updateTransfer(
  transferId: string,
  input: {
    source_branch_id: string;
    destination_branch_id: string;
    notes: string;
    lines: Array<{ item_id: string; variation_id?: string | null; quantity: number; source_location: "warehouse" | "store"; destination_location: "warehouse" | "store" }>;
  },
) {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  const { data: current } = await anySb
    .from("stock_transfers").select("status").eq("id", transferId).maybeSingle();
  const status = (current as any)?.status;
  if (!EDITABLE_TRANSFER_STATUSES.includes(status)) {
    throw new Error(`A transfer can only be edited before it is dispatched (this one is ${status}).`);
  }

  const { error } = await anySb
    .from("stock_transfers")
    .update({
      source_branch_id: input.source_branch_id,
      destination_branch_id: input.destination_branch_id,
      notes: input.notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", transferId);
  if (error) throw error;

  const { error: delErr } = await anySb.from("stock_transfer_items").delete().eq("transfer_id", transferId);
  if (delErr) throw delErr;

  if (input.lines.length > 0) {
    const { error: liErr } = await anySb.from("stock_transfer_items").insert(
      input.lines.map((l) => ({
        transfer_id: transferId,
        item_id: l.item_id,
        variation_id: l.variation_id ?? null,
        quantity: l.quantity,
        source_location: l.source_location,
        destination_location: l.destination_location,
      })),
    );
    if (liErr) throw liErr;
  }

  // The audit trail is the only record that the contents changed, since the
  // lines themselves were replaced.
  await anySb.from("stock_transfer_audit").insert({
    transfer_id: transferId,
    action: "edited",
    from_status: status,
    to_status: status,
    actor_id: user?.id ?? null,
    actor_email: user?.email ?? null,
  });
}

export async function transitionTransfer(transferId: string, toStatus: "pending_approval" | "approved") {
  const { error } = await anySb.rpc("transition_stock_transfer", {
    _transfer_id: transferId,
    _to_status: toStatus,
  });
  if (error) throw error;
}

export async function dispatchTransfer(transferId: string) {
  const { error } = await anySb.rpc("dispatch_stock_transfer", { _transfer_id: transferId });
  if (error) throw error;
}

export async function receiveTransfer(
  transferId: string,
  lines: Array<{ id: string; received_quantity: number }>
) {
  const { error } = await anySb.rpc("receive_stock_transfer", {
    _transfer_id: transferId,
    _lines: lines,
  });
  if (error) throw error;
}

export async function cancelTransfer(transferId: string, reason: string) {
  const { error } = await anySb.rpc("cancel_stock_transfer", {
    _transfer_id: transferId,
    _reason: reason,
  });
  if (error) throw error;
}

export async function deleteTransfer(transferId: string) {
  const { error } = await anySb.from("stock_transfers").delete().eq("id", transferId);
  if (error) throw error;
}
