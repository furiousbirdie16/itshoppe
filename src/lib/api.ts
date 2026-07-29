import { supabase } from "@/integrations/supabase/client";
import type { Item, ItemVariation, Supplier, Customer, PurchaseOrder, PurchaseOrderItem, Quotation, QuotationItem, Invoice, InvoiceItem, InventoryMovement, OverseasSupplier, OverseasPurchaseOrder, OverseasPurchaseOrderItem, ShipmentTracking, OnlineSale } from "@/types/database";
import { logActivity } from "@/lib/activity-log";
import { applyVariationDelta } from "@/lib/variations";
import { recordMovement } from "@/lib/inventoryLog";


// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _sb: any = supabase as any;
const _from = (table: string) => _sb.from(table);

/** Read the branch-scoped stock row (returns zeros if missing). */
async function getBranchStock(itemId: string, branchId: string) {
  const { data } = await _from("item_branch_stock")
    .select("warehouse_quantity, store_quantity, quantity, open_roll_remaining, units_per_stock")
    .eq("item_id", itemId)
    .eq("branch_id", branchId)
    .maybeSingle();
  const r = (data as any) || {};
  return {
    warehouse_quantity: Number(r.warehouse_quantity || 0),
    store_quantity: Number(r.store_quantity || 0),
    quantity: Number(r.quantity || 0),
    open_roll_remaining: Number(r.open_roll_remaining || 0),
    units_per_stock: Number(r.units_per_stock || 1),
  };
}

/** RPC wrapper — mutates item_branch_stock atomically. */
async function applyBranchStockRpc(args: {
  itemId: string;
  branchId: string;
  location: "warehouse" | "store";
  deltaStock: number;
  deltaOpen?: number;
  unitsPerStock?: number | null;
}) {
  const { data, error } = await _sb.rpc("apply_branch_stock_change", {
    _item_id: args.itemId,
    _branch_id: args.branchId,
    _location: args.location,
    _delta_stock: args.deltaStock,
    _delta_open: args.deltaOpen ?? 0,
    _units_per_stock: args.unitsPerStock ?? null,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as {
    warehouse_quantity: number;
    store_quantity: number;
    quantity: number;
    open_roll_remaining: number;
    units_per_stock: number;
    wh_before: number;
    st_before: number;
    open_before: number;
  };
}

// ---------- Item Variations ----------
export const getItemVariations = async (itemId?: string): Promise<ItemVariation[]> => {
  let q = from("item_variations").select("*, items(*)").order("name");
  if (itemId) q = q.eq("item_id", itemId);
  const { data, error } = await q;
  if (error) throw error;
  return data as ItemVariation[];
};

export const createItemVariation = async (v: Partial<ItemVariation>) => {
  const { data, error } = await from("item_variations").insert(v).select().single();
  if (error) throw error;
  return data as ItemVariation;
};

export const updateItemVariation = async (id: string, v: Partial<ItemVariation>) => {
  const { data, error } = await from("item_variations").update(v).eq("id", id).select().single();
  if (error) throw error;
  return data as ItemVariation;
};

export const deleteItemVariation = async (id: string) => {
  const { error } = await from("item_variations").delete().eq("id", id);
  if (error) throw error;
};

/**
 * Apply a sale (qty>0) or restore (qty<0) against `item_branch_stock` for the
 * TRANSACTION'S branch (never the currently-viewed branch). Variation-aware.
 * All sales deduct from the branch's store bucket; restores add back to store.
 */
export const applyStockChange = async (params: {
  itemId: string;
  variationId: string | null;
  branchId: string;
  qty: number; // positive = deduct, negative = restore
  referenceId: string;
  referenceType: string;
  movementType: "in_po" | "out_invoice" | "out_online_sale";
  notes?: string;
}) => {
  const { itemId, variationId, branchId, qty, referenceId, referenceType, movementType, notes } = params;
  if (qty === 0) return;
  if (!branchId) throw new Error("applyStockChange: branchId is required");

  const { data: item } = await _from("items").select("base_unit, units_per_stock").eq("id", itemId).maybeSingle();
  const baseUnit = (item as any)?.base_unit ?? "pcs";
  const itemUps = Number((item as any)?.units_per_stock || 1);

  // Read current branch stock (before mutation) for ledger + variation math.
  const cur = await getBranchStock(itemId, branchId);
  const effectiveUps = Math.max(cur.units_per_stock || 0, itemUps || 0, 1);

  let baseUnitsMoved = qty;
  let deltaStock = -qty; // default: deduct N stock units from store
  let deltaOpen = 0;

  if (variationId) {
    const { data: v } = await _from("item_variations").select("type, factor").eq("id", variationId).single();
    const variation = v as any;
    if (!variation) return;
    baseUnitsMoved = Number(variation.factor) * qty;

    if (variation.type === "cut") {
      // Simulate variation delta on the branch row
      const sim = applyVariationDelta(
        { quantity: cur.quantity, open_roll_remaining: cur.open_roll_remaining, units_per_stock: effectiveUps },
        { type: "cut", factor: Number(variation.factor) },
        qty,
      );
      const stockConsumed = cur.quantity - sim.quantity; // + = consumed, - = restored
      deltaStock = -stockConsumed;
      deltaOpen = sim.open_roll_remaining - cur.open_roll_remaining;
    } else {
      // "pack" variation: deducts baseUnitsMoved stock units directly
      deltaStock = -baseUnitsMoved;
    }
  }

  const result = await applyBranchStockRpc({
    itemId,
    branchId,
    location: "store",
    deltaStock,
    deltaOpen,
    unitsPerStock: variationId ? effectiveUps : null,
  });

  await recordMovement({
    itemId,
    variationId: variationId || null,
    branchId,
    type: movementType,
    quantity: Math.abs(baseUnitsMoved),
    unit: baseUnit || (variationId ? "m" : "pcs"),
    location: "store",
    referenceId,
    referenceType,
    notes: notes || (qty < 0 ? "Stock restored" : "Stock deducted"),
    balanceBefore: cur.store_quantity,
    balanceAfter: result.store_quantity,
    openBefore: cur.open_roll_remaining,
    openAfter: result.open_roll_remaining,
  });
};


// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (supabase as any);
const from = (table: string) => db.from(table);

// Items
export const getItems = async (): Promise<Item[]> => {
  const { data, error } = await from("items").select("*").neq("status", "archived").order("name");
  if (error) throw error;
  return data;
};

export const getArchivedItems = async (): Promise<Item[]> => {
  const { data, error } = await from("items").select("*").eq("status", "archived").order("name");
  if (error) throw error;
  return data;
};

export const getAllItems = async (): Promise<Item[]> => {
  const { data, error } = await from("items").select("*").order("name");
  if (error) throw error;
  return data;
};

export const archiveItems = async (ids: string[], email?: string | null) => {
  const { error } = await from("items").update({
    status: "archived",
    archived_at: new Date().toISOString(),
    archived_by_email: email || null,
    updated_at: new Date().toISOString(),
  }).in("id", ids);
  if (error) throw error;
  for (const id of ids) await logActivity("archived_item", "inventory", id);
};

export const unarchiveItems = async (ids: string[]) => {
  const { error } = await from("items").update({
    status: "active",
    archived_at: null,
    archived_by_email: null,
    updated_at: new Date().toISOString(),
  }).in("id", ids);
  if (error) throw error;
  for (const id of ids) await logActivity("unarchived_item", "inventory", id);
};

export const createItem = async (item: Partial<Item>) => {
  const { data, error } = await from("items").insert(item).select().single();
  if (error) throw error;
  const created = data as Item;
  await logActivity("created_item", "inventory", created.id, { name: created.name, sku: created.sku });
  return created;
};

export const updateItem = async (id: string, item: Partial<Item>) => {
  const { data: oldData } = await from("items").select("quantity").eq("id", id).single();
  const oldQty = (oldData as any)?.quantity;
  const { data, error } = await from("items").update({ ...item, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw error;
  const updated = data as Item;
  const details: Record<string, unknown> = { name: updated.name, sku: updated.sku };
  if (item.quantity !== undefined && item.quantity !== oldQty) {
    details.quantity_from = oldQty;
    details.quantity_to = item.quantity;
  }
  await logActivity("updated_item", "inventory", id, details);
  return updated;
};

export const deleteItem = async (id: string) => {
  const { error } = await from("items").delete().eq("id", id);
  if (error) throw error;
  await logActivity("deleted_item", "inventory", id);
};

// Suppliers
export const getSuppliers = async (): Promise<Supplier[]> => {
  const { data, error } = await from("suppliers").select("*").order("name");
  if (error) throw error;
  return data;
};

export const createSupplier = async (s: Partial<Supplier>) => {
  const { data, error } = await from("suppliers").insert(s).select().single();
  if (error) throw error;
  return data as Supplier;
};

export const updateSupplier = async (id: string, s: Partial<Supplier>) => {
  const { data, error } = await from("suppliers").update(s).eq("id", id).select().single();
  if (error) throw error;
  return data as Supplier;
};

export const deleteSupplier = async (id: string) => {
  const { error } = await from("suppliers").delete().eq("id", id);
  if (error) throw error;
};

// Overseas Suppliers
export const getOverseasSuppliers = async (): Promise<OverseasSupplier[]> => {
  const { data, error } = await from("overseas_suppliers").select("*").order("name");
  if (error) throw error;
  return data;
};

export const createOverseasSupplier = async (s: Partial<OverseasSupplier>) => {
  const { data, error } = await from("overseas_suppliers").insert(s).select().single();
  if (error) throw error;
  return data as OverseasSupplier;
};

export const updateOverseasSupplier = async (id: string, s: Partial<OverseasSupplier>) => {
  const { data, error } = await from("overseas_suppliers").update({ ...s, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw error;
  return data as OverseasSupplier;
};

export const deleteOverseasSupplier = async (id: string) => {
  const { error } = await from("overseas_suppliers").delete().eq("id", id);
  if (error) throw error;
};

// Customers
export const getCustomers = async (): Promise<Customer[]> => {
  const { data, error } = await from("customers").select("*").order("name");
  if (error) throw error;
  return data;
};

export const createCustomer = async (c: Partial<Customer>) => {
  const { data, error } = await from("customers").insert(c).select().single();
  if (error) throw error;
  return data as Customer;
};

export const updateCustomer = async (id: string, c: Partial<Customer>) => {
  const { data, error } = await from("customers").update(c).eq("id", id).select().single();
  if (error) throw error;
  return data as Customer;
};

export const deleteCustomer = async (id: string) => {
  const { error } = await from("customers").delete().eq("id", id);
  if (error) throw error;
};

// Purchase Orders
export const getPurchaseOrders = async (): Promise<PurchaseOrder[]> => {
  const { data, error } = await from("purchase_orders").select("*, suppliers(*)").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
};

export const createPurchaseOrder = async (po: Partial<PurchaseOrder>) => {
  const { data, error } = await from("purchase_orders").insert(po).select().single();
  if (error) throw error;
  const created = data as PurchaseOrder;
  await logActivity("created_purchase_order", "purchase_order", created.id, { po_number: created.po_number });
  return created;
};

export const updatePurchaseOrder = async (id: string, po: Partial<PurchaseOrder>) => {
  // If the user is moving the PO into "received" status directly (e.g. via the edit form),
  // auto-receive any outstanding quantities so inventory stock is added. Idempotent —
  // already-received quantities are skipped.
  const wantsReceived = (po as any)?.status === "received";
  if (wantsReceived) {
    const { data: lines } = await from("purchase_order_items").select("id, item_id, quantity, received_quantity").eq("po_id", id);
    const toReceive = ((lines as any[]) || [])
      .map((li: any) => ({
        poItemId: li.id,
        itemId: li.item_id ?? null,
        quantity: Math.max(0, Number(li.quantity || 0) - Number(li.received_quantity || 0)),
        location: "warehouse" as const,
      }))
      .filter((li) => li.quantity > 0);
    if (toReceive.length > 0) {
      await receivePO(id, toReceive);
    }
  }

  const { data, error } = await from("purchase_orders").update({ ...po, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw error;
  return data as PurchaseOrder;
};

export const deletePurchaseOrder = async (id: string) => {
  const { error } = await from("purchase_orders").delete().eq("id", id);
  if (error) throw error;
};

export const getPOItems = async (poId: string): Promise<PurchaseOrderItem[]> => {
  const { data, error } = await from("purchase_order_items").select("*, items(*)").eq("po_id", poId);
  if (error) throw error;
  return data;
};

export const createPOItems = async (items: Partial<PurchaseOrderItem>[]) => {
  const { error } = await from("purchase_order_items").insert(items);
  if (error) throw error;
};

export const deletePOItems = async (poId: string) => {
  const { error } = await from("purchase_order_items").delete().eq("po_id", poId);
  if (error) throw error;
};

// Receive PO
export const receivePO = async (
  poId: string,
  itemsToReceive: { poItemId: string; itemId: string | null; quantity: number; location?: "warehouse" | "store" }[],
  receivedDate?: string,
) => {
  const rcvDate = receivedDate || new Date().toISOString().split("T")[0];
  const { data: poRow } = await from("purchase_orders").select("branch_id, status").eq("id", poId).single();
  const poBranchId: string | null = (poRow as any)?.branch_id ?? null;
  if (!poBranchId) throw new Error("This PO has no branch assigned. Edit the PO and set its branch before receiving.");

  for (const item of itemsToReceive) {
    const { data: poItem } = await from("purchase_order_items").select("received_quantity").eq("id", item.poItemId).single();
    const newReceived = ((poItem as any)?.received_quantity || 0) + item.quantity;
    await from("purchase_order_items").update({ received_quantity: newReceived, received_date: rcvDate }).eq("id", item.poItemId);

    // Custom (non-inventory) items: just record the receipt against the PO line, do not touch inventory.
    if (!item.itemId) continue;

    const location: "warehouse" | "store" = item.location || "warehouse";
    const result = await applyBranchStockRpc({
      itemId: item.itemId,
      branchId: poBranchId,
      location,
      deltaStock: item.quantity,
    });
    const before = location === "store" ? result.st_before : result.wh_before;
    const after = location === "store" ? result.store_quantity : result.warehouse_quantity;

    await recordMovement({
      itemId: item.itemId,
      branchId: poBranchId,
      type: "in_po",
      quantity: item.quantity,
      unit: "pcs",
      location,
      referenceId: poId,
      referenceType: "purchase_order",
      notes: `Received from PO on ${rcvDate} → ${location}`,
      balanceBefore: before,
      balanceAfter: after,
    });
  }


  const { data: allItems } = await from("purchase_order_items").select("quantity, received_quantity").eq("po_id", poId);
  const allReceived = (allItems as any[])?.every((i: any) => i.received_quantity >= i.quantity);
  const someReceived = (allItems as any[])?.some((i: any) => i.received_quantity > 0);
  const cur = (poRow as any)?.status;
  let newStatus: string;
  if (cur === "closed") {
    newStatus = cur;
  } else if (allReceived) {
    newStatus = "received";
  } else if (someReceived) {
    newStatus = "partially_received";
  } else {
    newStatus = "draft";
  }
  await from("purchase_orders").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", poId);
  await logActivity("received_purchase_order", "purchase_order", poId, { status: newStatus });
};

// Undo Receive — reverses received quantities for selected PO line items and deducts inventory
export const unreceivePO = async (
  poId: string,
  itemsToUnreceive: { poItemId: string; itemId: string | null; quantity: number }[],
) => {
  for (const item of itemsToUnreceive) {
    if (item.quantity <= 0) continue;
    const { data: poItem } = await from("purchase_order_items").select("received_quantity").eq("id", item.poItemId).single();
    const currentReceived = (poItem as any)?.received_quantity || 0;
    const undoQty = Math.min(item.quantity, currentReceived);
    if (undoQty <= 0) continue;
    const newReceived = currentReceived - undoQty;
    await from("purchase_order_items")
      .update({ received_quantity: newReceived, received_date: newReceived === 0 ? null : undefined })
      .eq("id", item.poItemId);

    if (item.itemId) {
      const { data: currentItem } = await from("items").select("quantity, warehouse_quantity, store_quantity").eq("id", item.itemId).single();
      const prev = Number((currentItem as any)?.quantity || 0);
      const prevWh = Number((currentItem as any)?.warehouse_quantity || 0);
      const newQty = Math.max(0, prev - undoQty);
      const newWh = Math.max(0, prevWh - undoQty);
      await from("items").update({ quantity: newQty, warehouse_quantity: newWh, updated_at: new Date().toISOString() }).eq("id", item.itemId);

      await recordMovement({
        itemId: item.itemId,
        type: "in_po",
        quantity: undoQty,
        unit: "pcs",
        location: "warehouse",
        referenceId: poId,
        referenceType: "purchase_order_undo",
        notes: `Undo receive from PO`,
        balanceBefore: prevWh,
        balanceAfter: newWh,
      });
    }

  }

  const { data: allItems } = await from("purchase_order_items").select("quantity, received_quantity").eq("po_id", poId);
  const allReceived = (allItems as any[])?.every((i: any) => i.received_quantity >= i.quantity);
  const someReceived = (allItems as any[])?.some((i: any) => i.received_quantity > 0);
  const newStatus = allReceived ? "received" : someReceived ? "partially_received" : "draft";
  await from("purchase_orders").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", poId);
  await logActivity("undo_receive_purchase_order", "purchase_order", poId, { status: newStatus });
};

// Quotations
export const getQuotations = async (): Promise<Quotation[]> => {
  const { data, error } = await from("quotations").select("*, customers(*)").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
};

export const createQuotation = async (q: Partial<Quotation>) => {
  const { data, error } = await from("quotations").insert(q).select().single();
  if (error) throw error;
  const created = data as Quotation;
  await logActivity("created_quotation", "quotation", created.id, { quotation_number: created.quotation_number });
  return created;
};

export const updateQuotation = async (id: string, q: Partial<Quotation>) => {
  const { data, error } = await from("quotations").update(q).eq("id", id).select().single();
  if (error) throw error;
  return data as Quotation;
};

export const revertQuotation = async (id: string) => {
  const { error } = await from("quotations").update({ status: "draft" }).eq("id", id);
  if (error) throw error;
  await logActivity("reverted_quotation", "quotation", id);
};

export const deleteQuotation = async (id: string) => {
  const { error } = await from("quotations").delete().eq("id", id);
  if (error) throw error;
};

export const getQuotationItems = async (qId: string): Promise<QuotationItem[]> => {
  const { data, error } = await from("quotation_items").select("*, items(*), item_variations(*)").eq("quotation_id", qId);
  if (error) throw error;
  return data;
};

export const createQuotationItems = async (items: Partial<QuotationItem>[]) => {
  const { error } = await from("quotation_items").insert(items);
  if (error) throw error;
};

export const deleteQuotationItems = async (qId: string) => {
  const { error } = await from("quotation_items").delete().eq("quotation_id", qId);
  if (error) throw error;
};

// Convert Quotation to Invoice
export const convertQuotationToInvoice = async (quotationId: string) => {
  const { data: quotation } = await from("quotations").select("*").eq("id", quotationId).single();
  if (!quotation) throw new Error("Quotation not found");

  const { data: qItems } = await from("quotation_items").select("*").eq("quotation_id", quotationId);
  const q = quotation as any;
  const invNumber = await generateInvoiceNumber();
  const invoiceDate = new Date().toISOString().split("T")[0];

  // Carry over payment terms / due date from the quotation.
  // Priority: explicit payment_due_date > computed from payment_terms (relative to invoice date).
  let dueDate: string | null = q.payment_due_date || null;
  if (!dueDate && q.payment_terms != null) {
    const d = new Date(invoiceDate);
    d.setDate(d.getDate() + Number(q.payment_terms));
    dueDate = d.toISOString().split("T")[0];
  }

  const { data: invoice, error } = await from("invoices").insert({
    invoice_number: invNumber,
    customer_id: q.customer_id,
    quotation_id: quotationId,
    status: "draft",
    invoice_date: invoiceDate,
    due_date: dueDate,
    notes: q.notes,
    total_amount: q.total_amount,
    sales_agent: q.sales_agent || "",
  }).select().single();

  if (error) throw error;

  if (qItems && (qItems as any[]).length > 0) {
    await from("invoice_items").insert(
      (qItems as any[]).map((qi: any) => ({
        invoice_id: (invoice as any).id,
        item_id: qi.item_id,
        item_name: qi.item_name,
        quantity: qi.quantity,
        unit_price: qi.unit_price,
        variation_id: qi.variation_id,
      }))
    );
  }

  await from("quotations").update({ status: "accepted" }).eq("id", quotationId);
  await logActivity("converted_quotation_to_invoice", "invoice", (invoice as any).id, { from_quotation: quotationId });
  return invoice as Invoice;
};

// Invoices
export const getInvoices = async (): Promise<Invoice[]> => {
  const { data, error } = await from("invoices").select("*, customers(*)").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
};

export const createInvoice = async (inv: Partial<Invoice>) => {
  const { data, error } = await from("invoices").insert(inv).select().single();
  if (error) throw error;
  const created = data as Invoice;
  await logActivity("created_invoice", "invoice", created.id, { invoice_number: created.invoice_number });
  return created;
};

export const updateInvoice = async (id: string, inv: Partial<Invoice>) => {
  const { data, error } = await from("invoices").update({ ...inv, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw error;
  return data as Invoice;
};

export const deleteInvoice = async (id: string) => {
  // If this invoice currently has stock deducted, restore inventory before deleting.
  const { data: invRow } = await from("invoices").select("inventory_deducted, branch_id").eq("id", id).maybeSingle();
  const stockCurrentlyDeducted = !!(invRow as any)?.inventory_deducted;
  const branchId: string | null = (invRow as any)?.branch_id ?? null;

  if (stockCurrentlyDeducted && branchId) {
    const { data: invItems } = await from("invoice_items").select("*").eq("invoice_id", id);
    for (const invItem of (invItems as any[]) || []) {
      if (!invItem.item_id) continue;
      await applyStockChange({
        itemId: invItem.item_id,
        variationId: invItem.variation_id || null,
        branchId,
        qty: -invItem.quantity, // restore
        referenceId: id,
        referenceType: "invoice_delete",
        movementType: "in_po",
        notes: "Restored — invoice deleted",
      });
    }
  }

  const { error } = await from("invoices").delete().eq("id", id);
  if (error) throw error;
};

export const getInvoiceItems = async (invId: string): Promise<InvoiceItem[]> => {
  const { data, error } = await from("invoice_items").select("*, items(*), item_variations(*)").eq("invoice_id", invId);
  if (error) throw error;
  return data;
};

export const createInvoiceItems = async (items: Partial<InvoiceItem>[]) => {
  const { error } = await from("invoice_items").insert(items);
  if (error) throw error;
};

export const deleteInvoiceItems = async (invId: string) => {
  const { error } = await from("invoice_items").delete().eq("invoice_id", invId);
  if (error) throw error;
};

// Internal: deduct stock for an invoice exactly once (idempotent via inventory_deducted flag)
const deductInvoiceStockIfNeeded = async (invoiceId: string, notes: string) => {
  const { data: invRow } = await from("invoices").select("inventory_deducted, branch_id").eq("id", invoiceId).maybeSingle();
  if ((invRow as any)?.inventory_deducted) return false;
  const branchId: string | null = (invRow as any)?.branch_id ?? null;
  if (!branchId) throw new Error("This invoice has no branch assigned. Set the invoice branch before deducting stock.");

  const { data: invItems } = await from("invoice_items").select("*").eq("invoice_id", invoiceId);
  if (invItems) {
    for (const invItem of invItems as any[]) {
      if (!invItem.item_id) continue;
      await applyStockChange({
        itemId: invItem.item_id,
        variationId: invItem.variation_id || null,
        branchId,
        qty: invItem.quantity,
        referenceId: invoiceId,
        referenceType: "invoice",
        movementType: "out_invoice",
        notes,
      });
    }
  }
  await from("invoices").update({ inventory_deducted: true, updated_at: new Date().toISOString() }).eq("id", invoiceId);
  return true;
};

// Confirm Invoice (mark shipped - legacy "shipped not paid") - deduct stock once
export const confirmInvoice = async (invoiceId: string) => {
  await deductInvoiceStockIfNeeded(invoiceId, "Deducted from invoice (shipped)");
  await from("invoices").update({ status: "confirmed", updated_at: new Date().toISOString() }).eq("id", invoiceId);
  await logActivity("confirmed_invoice", "invoice", invoiceId);
};

// Reserve invoice: allocate stock immediately, not yet paid, not yet shipped.
export const reserveInvoice = async (invoiceId: string) => {
  await deductInvoiceStockIfNeeded(invoiceId, "Deducted from invoice (reserved)");
  await from("invoices").update({ status: "reserved", updated_at: new Date().toISOString() }).eq("id", invoiceId);
  await logActivity("reserved_invoice", "invoice", invoiceId);
};

// Convert a Reserved order into an open sales order (legacy "confirmed" = shipped-not-paid bucket
// in this codebase represents an open, stock-deducted sale awaiting payment). Stock allocation
// is preserved.
export const convertReservedToSale = async (invoiceId: string) => {
  await from("invoices").update({ status: "confirmed", updated_at: new Date().toISOString() }).eq("id", invoiceId);
  await logActivity("converted_reserved_to_sale", "invoice", invoiceId);
};

// Mark invoice shipped/picked-up. If already paid -> auto-complete.
export const shipInvoice = async (invoiceId: string) => {
  await deductInvoiceStockIfNeeded(invoiceId, "Deducted from invoice (shipped)");
  const { data: invRow } = await from("invoices").select("status").eq("id", invoiceId).maybeSingle();
  const wasPaid = (invRow as any)?.status === "paid";
  await from("invoices").update({
    status: wasPaid ? "completed" : "shipped",
    shipped_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", invoiceId);
  await logActivity(wasPaid ? "completed_invoice" : "shipped_invoice", "invoice", invoiceId);
};

// Cancel a Reserved (or any open) invoice: restore stock if previously deducted.
export const cancelInvoice = async (invoiceId: string) => {
  const { data: invRow } = await from("invoices").select("inventory_deducted").eq("id", invoiceId).maybeSingle();
  const wasDeducted = !!(invRow as any)?.inventory_deducted;
  if (wasDeducted) {
    const { data: invItems } = await from("invoice_items").select("*").eq("invoice_id", invoiceId);
    for (const invItem of (invItems as any[]) || []) {
      if (!invItem.item_id) continue;
      await applyStockChange({
        itemId: invItem.item_id,
        variationId: invItem.variation_id || null,
        qty: -invItem.quantity,
        referenceId: invoiceId,
        referenceType: "invoice_cancel",
        movementType: "in_po",
        notes: "Restored — invoice cancelled",
      });
    }
  }
  await from("invoices").update({
    status: "cancelled",
    inventory_deducted: false,
    cancelled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", invoiceId);
  await logActivity("cancelled_invoice", "invoice", invoiceId);
};

// Mark invoice as paid - also deducts stock if not yet deducted (handles draft → paid path).
// If invoice was already shipped -> auto-complete instead of "paid".
export const markInvoicePaid = async (
  invoiceId: string,
  payment: { payment_method: string; payment_reference?: string | null; payment_reference_url?: string | null },
) => {
  await deductInvoiceStockIfNeeded(invoiceId, "Deducted from invoice (paid)");
  const { data: invRow } = await from("invoices").select("status").eq("id", invoiceId).maybeSingle();
  const wasShipped = (invRow as any)?.status === "shipped";
  await from("invoices").update({
    status: wasShipped ? "completed" : "paid",
    payment_method: payment.payment_method,
    payment_reference: payment.payment_reference || null,
    payment_reference_url: payment.payment_reference_url || null,
    updated_at: new Date().toISOString(),
  }).eq("id", invoiceId);
  await logActivity(wasShipped ? "completed_invoice" : "marked_invoice_paid", "invoice", invoiceId);
};

// Revert invoice to draft - restore stock only if it was previously deducted
export const revertInvoice = async (invoiceId: string) => {
  const { data: invRow } = await from("invoices").select("inventory_deducted").eq("id", invoiceId).maybeSingle();
  const wasDeducted = !!(invRow as any)?.inventory_deducted;

  if (wasDeducted) {
    const { data: invItems } = await from("invoice_items").select("*").eq("invoice_id", invoiceId);
    if (invItems) {
      for (const invItem of invItems as any[]) {
        if (!invItem.item_id) continue;
        await applyStockChange({
          itemId: invItem.item_id,
          variationId: invItem.variation_id || null,
          qty: -invItem.quantity,
          referenceId: invoiceId,
          referenceType: "invoice_revert",
          movementType: "in_po",
          notes: "Reverted from invoice — stock restored",
        });
      }
    }
  }

  await from("invoices").update({
    status: "draft",
    inventory_deducted: false,
    shipped_at: null,
    cancelled_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", invoiceId);
  await logActivity("reverted_invoice", "invoice", invoiceId);
};


// Inventory Movements
export const getInventoryMovements = async (itemId?: string): Promise<InventoryMovement[]> => {
  let query = from("inventory_movements").select("*, items(*)").order("created_at", { ascending: false });
  if (itemId) query = query.eq("item_id", itemId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

// Dashboard stats
export const getDashboardStats = async () => {
  const { data: items } = await from("items").select("*");
  const { data: recentPOs } = await from("purchase_orders").select("*, suppliers(*)").order("created_at", { ascending: false }).limit(5);
  const { data: recentInvoices } = await from("invoices").select("*, customers(*)").order("created_at", { ascending: false }).limit(5);

  // Outstanding (not fully received) line items from local + overseas POs
  const { data: openPOItems } = await from("purchase_order_items")
    .select("item_id, quantity, received_quantity, unit_cost, purchase_orders!inner(po_number, status)")
    .neq("purchase_orders.status", "received");
  const { data: openOverseasItems } = await from("overseas_purchase_order_items")
    .select("item_id, quantity, received_quantity, unit_cost, overseas_purchase_orders!inner(po_number, status, exchange_rate)")
    .neq("overseas_purchase_orders.status", "received");

  const onOrder: Record<string, { localQty: number; overseasQty: number; localPOs: string[]; overseasPOs: string[] }> = {};
  let incomingAssetsValue = 0;   // Paid (or local) goods in transit
  let payableAssetsValue = 0;    // Overseas goods shipped but not yet paid
  // Local POs: treat all open remaining as Incoming Assets (paid on receipt model)
  for (const li of (openPOItems as any[]) || []) {
    const remaining = (li.quantity || 0) - (li.received_quantity || 0);
    if (remaining <= 0) continue;
    incomingAssetsValue += remaining * Number(li.unit_cost || 0);
    if (!li.item_id) continue;
    const e = onOrder[li.item_id] ||= { localQty: 0, overseasQty: 0, localPOs: [], overseasPOs: [] };
    e.localQty += remaining;
    const num = li.purchase_orders?.po_number;
    if (num && !e.localPOs.includes(num)) e.localPOs.push(num);
  }
  // Overseas POs: classify by status into Payable vs Incoming
  const PAYABLE_STATUSES = new Set(["shipped_not_paid", "sent"]);
  const INCOMING_STATUSES = new Set(["shipped", "partially_received"]);
  for (const li of (openOverseasItems as any[]) || []) {
    const remaining = (li.quantity || 0) - (li.received_quantity || 0);
    if (remaining <= 0) continue;
    const rate = Number(li.overseas_purchase_orders?.exchange_rate || 1);
    const status = li.overseas_purchase_orders?.status;
    const value = remaining * Number(li.unit_cost || 0) * rate;
    if (PAYABLE_STATUSES.has(status)) {
      payableAssetsValue += value;
    } else if (INCOMING_STATUSES.has(status)) {
      incomingAssetsValue += value;
    }
    // 'draft'/'unpaid'/'paid_not_shipped'/'pending_cargo_adjustment'/'cargo_adjusted' contribute $0
    if (!li.item_id) continue;
    const e = onOrder[li.item_id] ||= { localQty: 0, overseasQty: 0, localPOs: [], overseasPOs: [] };
    e.overseasQty += remaining;
    const num = li.overseas_purchase_orders?.po_number;
    if (num && !e.overseasPOs.includes(num)) e.overseasPOs.push(num);
  }

  // Accounts Payable for overseas = the Payable Assets amount (what we owe suppliers for shipped goods)
  const accountsPayableValue = payableAssetsValue;
  // Keep legacy combined "incoming stock" for backward compatibility with the existing chart/UI
  const incomingStockValue = incomingAssetsValue + payableAssetsValue;

  const itemsList = (items as any[]) || [];
  const totalValue = itemsList.reduce((sum: number, i: any) => sum + (i.quantity * i.cost_price), 0);
  const lowStockItems = itemsList
    .filter((i: any) => (i.low_stock_threshold ?? 0) > 0 && i.quantity <= i.low_stock_threshold)
    .map((i: any) => ({ ...i, on_order: onOrder[i.id] || { localQty: 0, overseasQty: 0, localPOs: [], overseasPOs: [] } }));

  return {
    totalItems: itemsList.length,
    totalValue,
    incomingStockValue,
    incomingAssetsValue,
    payableAssetsValue,
    accountsPayableValue,
    totalAssetValue: totalValue + incomingAssetsValue + payableAssetsValue,
    lowStockItems: lowStockItems as (Item & { on_order: { localQty: number; overseasQty: number; localPOs: string[]; overseasPOs: string[] } })[],
    recentPOs: (recentPOs || []) as PurchaseOrder[],
    recentInvoices: (recentInvoices || []) as Invoice[],
  };
};


// Document sequences
export const getDocumentSequences = async () => {
  const { data, error } = await from("document_sequences").select("*");
  if (error) throw error;
  return data as { id: string; prefix: string; next_number: number; padding: number }[];
};

export const updateDocumentSequence = async (id: string, updates: { prefix?: string; next_number?: number }) => {
  const { error } = await from("document_sequences").update(updates).eq("id", id);
  if (error) throw error;
};

const generateNextNumber = async (seqId: string): Promise<string> => {
  const { data, error } = await from("document_sequences").select("*").eq("id", seqId).single();
  if (error) throw error;
  const seq = data as { prefix: string; next_number: number; padding: number };
  const num = String(seq.next_number).padStart(seq.padding, "0");
  await from("document_sequences").update({ next_number: seq.next_number + 1 }).eq("id", seqId);
  return `${seq.prefix}-${num}`;
};

export const generatePONumber = () => generateNextNumber("purchase_order");
export const generateQuotationNumber = () => generateNextNumber("quotation");
export const generateInvoiceNumber = () => generateNextNumber("invoice");
export const generateOverseasPONumber = () => generateNextNumber("overseas_purchase_order");
export const generateShopeeOrderNumber = () => generateNextNumber("shopee_order");
export const generateLazadaOrderNumber = () => generateNextNumber("lazada_order");

// Online Sales
export const getOnlineSales = async (): Promise<OnlineSale[]> => {
  const pageSize = 1000;
  const all: any[] = [];
  for (let page = 0; ; page++) {
    const fromIdx = page * pageSize;
    const toIdx = fromIdx + pageSize - 1;
    const { data, error } = await from("online_sales")
      .select("*, items(*), item_variations(*)")
      .order("created_at", { ascending: false })
      .range(fromIdx, toIdx);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all as OnlineSale[];
};

export const createOnlineSale = async (sale: Partial<OnlineSale>) => {
  const { data, error } = await from("online_sales").insert(sale).select().single();
  if (error) throw error;
  const created = data as OnlineSale;

  // Deduct inventory if linked to an item (variation-aware)
  if (created.item_id) {
    await applyStockChange({
      itemId: created.item_id,
      variationId: (created as any).variation_id || null,
      qty: created.quantity || 1,
      referenceId: created.id,
      referenceType: "online_sale",
      movementType: "out_online_sale",
      notes: `Sold via ${created.sales_channel} - ${created.order_number}`,
    });
  }
  await logActivity("created_online_sale", "online_sale", created.id, { order_number: created.order_number, channel: created.sales_channel });
  return created;
};

export const updateOnlineSale = async (id: string, sale: Partial<OnlineSale>) => {
  const { data, error } = await from("online_sales").update({ ...sale, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw error;
  return data as OnlineSale;
};

export const returnOnlineSale = async (id: string, status: 'returned' | 'cancelled') => {
  const { data: sale } = await from("online_sales").select("item_id, variation_id, order_number, sales_channel, quantity, status").eq("id", id).single();
  if (!sale) throw new Error("Sale not found");
  const s = sale as any;
  if (s.status === 'returned' || s.status === 'cancelled') throw new Error("Sale already returned/cancelled");

  // Restore inventory if linked to an item (variation-aware)
  if (s.item_id) {
    await applyStockChange({
      itemId: s.item_id,
      variationId: s.variation_id || null,
      qty: -(s.quantity || 1),
      referenceId: id,
      referenceType: `online_sale_${status}`,
      movementType: "in_po",
      notes: `${status === 'returned' ? 'Returned' : 'Cancelled'} order ${s.order_number} — inventory restored`,
    });
  }

  const { data, error } = await from("online_sales").update({ status, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw error;
  await logActivity(`${status}_online_sale`, "online_sale", id, { order_number: s.order_number });
  return data as OnlineSale;
};

export const deleteOnlineSale = async (id: string) => {
  // Note: deleting an online sale does NOT restore inventory.
  // Use the Return action if stock needs to be replenished.
  const { error } = await from("online_sales").delete().eq("id", id);
  if (error) throw error;
};

// Overseas Purchase Orders
export const getOverseasPurchaseOrders = async (): Promise<OverseasPurchaseOrder[]> => {
  const { data, error } = await from("overseas_purchase_orders").select("*, overseas_suppliers(*)").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
};

export const createOverseasPurchaseOrder = async (po: Partial<OverseasPurchaseOrder>) => {
  const { data, error } = await from("overseas_purchase_orders").insert(po).select().single();
  if (error) throw error;
  return data as OverseasPurchaseOrder;
};

export const updateOverseasPurchaseOrder = async (id: string, po: Partial<OverseasPurchaseOrder>) => {
  // Detect a status transition into a "shipped" state so we can auto-create a shipment.
  const shippedStatuses = new Set(["shipped", "shipped_not_paid", "sent"]);
  let prevStatus: string | null = null;
  if (po.status && shippedStatuses.has(po.status as string)) {
    const { data: prev } = await from("overseas_purchase_orders").select("status").eq("id", id).single();
    prevStatus = (prev as any)?.status ?? null;
  }

  const { data, error } = await from("overseas_purchase_orders").update({ ...po, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw error;

  const updatedPo = data as OverseasPurchaseOrder;

  // When a PO transitions into a shipped state for the first time, ensure a shipment row exists.
  const becameShipped = po.status && shippedStatuses.has(po.status as string) && !shippedStatuses.has(prevStatus || "");
  if (becameShipped) {
    const { data: existing } = await from("shipment_tracking").select("id").eq("po_id", id).limit(1);
    if (!existing || (existing as any[]).length === 0) {
      await from("shipment_tracking").insert({
        po_id: id,
        status: "in_transit",
        ship_date: new Date().toISOString().slice(0, 10),
        estimated_arrival: (updatedPo as any).expected_delivery || null,
        notes: "Auto-created when PO marked as shipped",
      });
      await logActivity("created_shipment_tracking", "shipment_tracking", id, { auto: true, po_id: id });
    }
  }

  // Keep shipment ETA in sync when the PO's estimated arrival changes.
  if (Object.prototype.hasOwnProperty.call(po, "expected_delivery")) {
    await from("shipment_tracking")
      .update({ estimated_arrival: (po as any).expected_delivery || null, updated_at: new Date().toISOString() })
      .eq("po_id", id);
  }

  return updatedPo;
};

export const deleteOverseasPurchaseOrder = async (id: string) => {
  const { error } = await from("overseas_purchase_orders").delete().eq("id", id);
  if (error) throw error;
};

export const getOverseasPOItems = async (poId: string): Promise<OverseasPurchaseOrderItem[]> => {
  const { data, error } = await from("overseas_purchase_order_items").select("*, items(*)").eq("po_id", poId);
  if (error) throw error;
  return data;
};

export const getAllOverseasPOItems = async (): Promise<OverseasPurchaseOrderItem[]> => {
  const { data, error } = await from("overseas_purchase_order_items").select("*");
  if (error) throw error;
  return data as any;
};

export const createOverseasPOItems = async (items: Partial<OverseasPurchaseOrderItem>[]) => {
  const { error } = await from("overseas_purchase_order_items").insert(items);
  if (error) throw error;
};

export const deleteOverseasPOItems = async (poId: string) => {
  const { error } = await from("overseas_purchase_order_items").delete().eq("po_id", poId);
  if (error) throw error;
};

// Receive an Overseas PO partially: only the line items + quantities specified are added to stock.
// itemsToReceive: list of { poItemId, itemId (nullable for custom), quantity }
// Custom (non-inventory) lines can also be marked received but won't touch stock.
export const receiveOverseasPO = async (
  poId: string,
  itemsToReceive: { poItemId: string; itemId: string | null; quantity: number; location?: "warehouse" | "store" }[],
  receivedDate?: string,
) => {
  const rcvDate = receivedDate || new Date().toISOString().split("T")[0];
  for (const item of itemsToReceive) {
    if (item.quantity <= 0) continue;

    const { data: poItem } = await from("overseas_purchase_order_items")
      .select("received_quantity, quantity")
      .eq("id", item.poItemId)
      .single();
    const prevReceived = ((poItem as any)?.received_quantity || 0);
    const ordered = ((poItem as any)?.quantity || 0);
    const newReceived = Math.min(prevReceived + item.quantity, ordered);
    await from("overseas_purchase_order_items")
      .update({ received_quantity: newReceived, received_date: rcvDate })
      .eq("id", item.poItemId);

    if (item.itemId) {
      const location = item.location || "warehouse";
      const { data: currentItem } = await from("items")
        .select("warehouse_quantity, store_quantity")
        .eq("id", item.itemId)
        .single();
      const curWh = Number((currentItem as any)?.warehouse_quantity || 0);
      const curSt = Number((currentItem as any)?.store_quantity || 0);
      const updates: any = { updated_at: new Date().toISOString() };
      if (location === "store") {
        updates.store_quantity = curSt + item.quantity;
      } else {
        updates.warehouse_quantity = curWh + item.quantity;
      }
      await from("items").update(updates).eq("id", item.itemId);

      await recordMovement({
        itemId: item.itemId,
        type: "in_po",
        quantity: item.quantity,
        unit: "pcs",
        location,
        referenceId: poId,
        referenceType: "overseas_purchase_order",
        notes: `Received from overseas PO on ${rcvDate} → ${location}`,
        balanceBefore: location === "store" ? curSt : curWh,
        balanceAfter: location === "store" ? curSt + item.quantity : curWh + item.quantity,
      });

    }
  }

  const { data: allItems } = await from("overseas_purchase_order_items")
    .select("quantity, received_quantity")
    .eq("po_id", poId);
  const list = (allItems as any[]) || [];
  const allReceived = list.length > 0 && list.every((i) => (i.received_quantity || 0) >= i.quantity);
  const someReceived = list.some((i) => (i.received_quantity || 0) > 0);

  const { data: prevPo } = await from("overseas_purchase_orders").select("status").eq("id", poId).single();
  const prevStatus = (prevPo as any)?.status || "unpaid";
  const preserved = prevStatus === "received";
  const newStatus = preserved
    ? prevStatus
    : allReceived
      ? "received"
      : someReceived
        ? "partially_received"
        : (prevStatus === "partially_received" ? "shipped" : prevStatus);

  await from("overseas_purchase_orders")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", poId);

  if (allReceived) {
    await from("shipment_tracking")
      .update({ status: "delivered", actual_arrival: rcvDate, updated_at: new Date().toISOString() })
      .eq("po_id", poId);
  }

  await logActivity("received_overseas_purchase_order", "overseas_purchase_order", poId, { status: newStatus, received_date: rcvDate });
};

// Undo Receive for Overseas PO — reverses received quantities per line item and deducts inventory.
// Throws if the reversal would exceed current on-hand inventory.
export const unreceiveOverseasPO = async (
  poId: string,
  itemsToUnreceive: { poItemId: string; itemId: string | null; quantity: number }[],
) => {
  for (const item of itemsToUnreceive) {
    if (item.quantity <= 0) continue;
    const { data: poItem } = await from("overseas_purchase_order_items")
      .select("received_quantity")
      .eq("id", item.poItemId)
      .single();
    const currentReceived = Number((poItem as any)?.received_quantity || 0);
    const undoQty = Math.min(item.quantity, currentReceived);
    if (undoQty <= 0) continue;

    if (item.itemId) {
      const { data: currentItem } = await from("items")
        .select("warehouse_quantity, store_quantity, name")
        .eq("id", item.itemId)
        .single();
      const curWh = Number((currentItem as any)?.warehouse_quantity || 0);
      const curSt = Number((currentItem as any)?.store_quantity || 0);
      const onHand = curWh + curSt;
      if (onHand < undoQty) {
        throw new Error(
          `Cannot undo this receipt for "${(currentItem as any)?.name || "item"}" because the inventory has already been consumed (on hand: ${onHand}, needed: ${undoQty}). Please perform a manual inventory adjustment instead.`,
        );
      }
      // Deduct from warehouse first, then store
      const fromWh = Math.min(curWh, undoQty);
      const fromSt = undoQty - fromWh;
      await from("items").update({
        warehouse_quantity: curWh - fromWh,
        store_quantity: curSt - fromSt,
        updated_at: new Date().toISOString(),
      }).eq("id", item.itemId);

      await recordMovement({
        itemId: item.itemId,
        type: "in_po",
        quantity: undoQty,
        unit: "pcs",
        location: fromWh > 0 ? "warehouse" : "store",
        referenceId: poId,
        referenceType: "overseas_purchase_order_undo",
        notes: `Undo receive from overseas PO`,
        balanceBefore: fromWh > 0 ? curWh : curSt,
        balanceAfter: fromWh > 0 ? curWh - fromWh : curSt - fromSt,
      });

    }

    const newReceived = currentReceived - undoQty;
    await from("overseas_purchase_order_items")
      .update({ received_quantity: newReceived, received_date: newReceived === 0 ? null : undefined })
      .eq("id", item.poItemId);
  }

  const { data: allItems } = await from("overseas_purchase_order_items")
    .select("quantity, received_quantity")
    .eq("po_id", poId);
  const list = (allItems as any[]) || [];
  const allReceived = list.length > 0 && list.every((i) => (i.received_quantity || 0) >= i.quantity);
  const someReceived = list.some((i) => (i.received_quantity || 0) > 0);
  const newStatus = allReceived ? "received" : someReceived ? "partially_received" : "shipped";
  await from("overseas_purchase_orders")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", poId);
  await logActivity("undo_receive_overseas_purchase_order", "overseas_purchase_order", poId, { status: newStatus });
};

// Shipment Tracking
export const getShipments = async (): Promise<ShipmentTracking[]> => {
  const { data, error } = await from("shipment_tracking").select("*, overseas_purchase_orders(*, overseas_suppliers(*))").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
};

export const createShipment = async (s: Partial<ShipmentTracking>) => {
  const { data, error } = await from("shipment_tracking").insert(s).select().single();
  if (error) throw error;
  return data as ShipmentTracking;
};

export const updateShipment = async (id: string, s: Partial<ShipmentTracking>) => {
  const { data, error } = await from("shipment_tracking").update({ ...s, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw error;
  return data as ShipmentTracking;
};

export const deleteShipment = async (id: string) => {
  const { error } = await from("shipment_tracking").delete().eq("id", id);
  if (error) throw error;
};

// Sales Agents
export const getSalesAgents = async (): Promise<{ id: string; name: string }[]> => {
  const { data, error } = await from("sales_agents").select("*").order("name");
  if (error) throw error;
  return data;
};

export const createSalesAgent = async (name: string) => {
  const { data, error } = await from("sales_agents").insert({ name }).select().single();
  if (error) throw error;
  return data;
};

/** Returns last sales agent + last order date for each given customer. */
export const getCustomerSalesActivity = async (
  customerIds: string[],
): Promise<Record<string, { lastAgent: string | null; lastDate: string | null }>> => {
  const out: Record<string, { lastAgent: string | null; lastDate: string | null }> = {};
  if (!customerIds.length) return out;
  const apply = (cid: string, agent: string | null, date: string | null) => {
    const cur = out[cid];
    if (!cur || (date && (!cur.lastDate || date > cur.lastDate))) {
      out[cid] = { lastAgent: agent || cur?.lastAgent || null, lastDate: date || cur?.lastDate || null };
    }
  };
  const { data: invs } = await from("invoices")
    .select("customer_id, sales_agent, invoice_date")
    .in("customer_id", customerIds)
    .in("status", ["confirmed", "paid", "unpaid"])
    .order("invoice_date", { ascending: false });
  for (const r of (invs as any[]) || []) if (r.customer_id) apply(r.customer_id, r.sales_agent || null, r.invoice_date || null);
  const { data: quotes } = await from("quotations")
    .select("customer_id, sales_agent, quotation_date")
    .in("customer_id", customerIds)
    .order("quotation_date", { ascending: false });
  for (const r of (quotes as any[]) || []) if (r.customer_id) apply(r.customer_id, r.sales_agent || null, r.quotation_date || null);
  return out;
};

/** Returns the most-recently-used sales agent for a single customer. */
export const getLastSalesAgentForCustomer = async (customerId: string): Promise<string | null> => {
  if (!customerId) return null;
  const map = await getCustomerSalesActivity([customerId]);
  return map[customerId]?.lastAgent || null;
};

/** Aggregates accounts receivable (unpaid invoices + manual receivables). */
export const getAccountsReceivable = async (): Promise<number> => {
  const { data: invs } = await from("invoices")
    .select("total_amount, status")
    .in("status", ["confirmed", "unpaid"]);
  const invTotal = ((invs as any[]) || []).reduce((s, r) => s + Number(r.total_amount || 0), 0);
  const { data: mr } = await from("manual_receivables").select("amount, status").neq("status", "paid");
  const mrTotal = ((mr as any[]) || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  return invTotal + mrTotal;
};

/** Daily series of sales totals (online + invoice) between two ISO dates. */
export const getSalesTrend = async (
  fromIso: string,
  toIso: string,
): Promise<{ date: string; online: number; invoice: number; total: number }[]> => {
  const { data: online } = await from("online_sales")
    .select("order_date, posted_price, quantity")
    .gte("order_date", fromIso)
    .lte("order_date", toIso)
    .eq("status", "completed");
  const { data: invs } = await from("invoices")
    .select("invoice_date, total_amount, status")
    .gte("invoice_date", fromIso)
    .lte("invoice_date", toIso)
    .in("status", ["confirmed", "paid"]);
  const map: Record<string, { online: number; invoice: number }> = {};
  for (const r of (online as any[]) || []) {
    const k = r.order_date;
    if (!k) continue;
    (map[k] ||= { online: 0, invoice: 0 }).online += Number(r.posted_price || 0) * (r.quantity || 1);
  }
  for (const r of (invs as any[]) || []) {
    const k = r.invoice_date;
    if (!k) continue;
    (map[k] ||= { online: 0, invoice: 0 }).invoice += Number(r.total_amount || 0);
  }
  return Object.entries(map)
    .map(([date, v]) => ({ date, online: v.online, invoice: v.invoice, total: v.online + v.invoice }))
    .sort((a, b) => a.date.localeCompare(b.date));
};

// ==============================
// Admin-only invoice financials
// ==============================
// These reads are gated by RLS on the server — non-admins get an empty
// array back from Supabase and never see cost or profit values.

export interface InvoiceItemFinancial {
  id: string;
  invoice_id: string;
  item_id: string;
  variation_id: string | null;
  cost_snapshot: number;
  quantity: number;
  unit_price: number;
  line_total_cost: number;
  line_profit: number;
}

export interface InvoiceFinancial {
  id: string;
  invoice_id: string;
  total_sales: number;
  total_cost: number;
  total_profit: number;
  profit_margin: number;
  paid_at: string | null;
}

export const getInvoiceItemFinancials = async (invoiceId: string): Promise<InvoiceItemFinancial[]> => {
  const { data, error } = await (supabase as any)
    .from("invoice_item_financials")
    .select("*")
    .eq("invoice_id", invoiceId);
  if (error) return [];
  return (data as InvoiceItemFinancial[]) || [];
};

export const getInvoiceFinancial = async (invoiceId: string): Promise<InvoiceFinancial | null> => {
  const { data, error } = await (supabase as any)
    .from("invoice_financials")
    .select("*")
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  if (error) return null;
  return (data as InvoiceFinancial) || null;
};

