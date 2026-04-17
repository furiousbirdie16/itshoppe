import { supabase } from "@/integrations/supabase/client";
import type { Item, Supplier, Customer, PurchaseOrder, PurchaseOrderItem, Quotation, QuotationItem, Invoice, InvoiceItem, InventoryMovement, OverseasSupplier, OverseasPurchaseOrder, OverseasPurchaseOrderItem, ShipmentTracking, OnlineSale } from "@/types/database";
import { logActivity } from "@/lib/activity-log";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (supabase as any);
const from = (table: string) => db.from(table);

// Items
export const getItems = async (): Promise<Item[]> => {
  const { data, error } = await from("items").select("*").order("name");
  if (error) throw error;
  return data;
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
export const receivePO = async (poId: string, itemsToReceive: { poItemId: string; itemId: string; quantity: number }[]) => {
  for (const item of itemsToReceive) {
    const { data: poItem } = await from("purchase_order_items").select("received_quantity").eq("id", item.poItemId).single();
    const newReceived = ((poItem as any)?.received_quantity || 0) + item.quantity;
    await from("purchase_order_items").update({ received_quantity: newReceived }).eq("id", item.poItemId);

    const { data: currentItem } = await from("items").select("quantity").eq("id", item.itemId).single();
    await from("items").update({
      quantity: ((currentItem as any)?.quantity || 0) + item.quantity,
      updated_at: new Date().toISOString()
    }).eq("id", item.itemId);

    await from("inventory_movements").insert({
      item_id: item.itemId,
      type: "in_po",
      quantity: item.quantity,
      reference_id: poId,
      reference_type: "purchase_order",
      notes: "Received from PO"
    });
  }

  const { data: allItems } = await from("purchase_order_items").select("quantity, received_quantity").eq("po_id", poId);
  const allReceived = (allItems as any[])?.every((i: any) => i.received_quantity >= i.quantity);
  const someReceived = (allItems as any[])?.some((i: any) => i.received_quantity > 0);
  const newStatus = allReceived ? "received" : someReceived ? "partially_received" : "draft";
  await from("purchase_orders").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", poId);
  await logActivity("received_purchase_order", "purchase_order", poId, { status: newStatus });
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

export const deleteQuotation = async (id: string) => {
  const { error } = await from("quotations").delete().eq("id", id);
  if (error) throw error;
};

export const getQuotationItems = async (qId: string): Promise<QuotationItem[]> => {
  const { data, error } = await from("quotation_items").select("*, items(*)").eq("quotation_id", qId);
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
        quantity: qi.quantity,
        unit_price: qi.unit_price,
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
  const { error } = await from("invoices").delete().eq("id", id);
  if (error) throw error;
};

export const getInvoiceItems = async (invId: string): Promise<InvoiceItem[]> => {
  const { data, error } = await from("invoice_items").select("*, items(*)").eq("invoice_id", invId);
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

// Confirm Invoice - deduct stock
export const confirmInvoice = async (invoiceId: string) => {
  const { data: invItems } = await from("invoice_items").select("*").eq("invoice_id", invoiceId);

  if (invItems) {
    for (const invItem of invItems as any[]) {
      const { data: currentItem } = await from("items").select("quantity").eq("id", invItem.item_id).single();
      await from("items").update({
        quantity: Math.max(0, ((currentItem as any)?.quantity || 0) - invItem.quantity),
        updated_at: new Date().toISOString()
      }).eq("id", invItem.item_id);

      await from("inventory_movements").insert({
        item_id: invItem.item_id,
        type: "out_invoice",
        quantity: invItem.quantity,
        reference_id: invoiceId,
        reference_type: "invoice",
        notes: "Deducted from invoice"
      });
    }
  }

  await from("invoices").update({ status: "confirmed", updated_at: new Date().toISOString() }).eq("id", invoiceId);
  await logActivity("confirmed_invoice", "invoice", invoiceId);
};

// Revert confirmed invoice - restore stock
export const revertInvoice = async (invoiceId: string) => {
  const { data: invItems } = await from("invoice_items").select("*").eq("invoice_id", invoiceId);

  if (invItems) {
    for (const invItem of invItems as any[]) {
      const { data: currentItem } = await from("items").select("quantity").eq("id", invItem.item_id).single();
      await from("items").update({
        quantity: ((currentItem as any)?.quantity || 0) + invItem.quantity,
        updated_at: new Date().toISOString()
      }).eq("id", invItem.item_id);

      await from("inventory_movements").insert({
        item_id: invItem.item_id,
        type: "in_po",
        quantity: invItem.quantity,
        reference_id: invoiceId,
        reference_type: "invoice_revert",
        notes: "Reverted from confirmed invoice"
      });
    }
  }

  await from("invoices").update({ status: "draft", updated_at: new Date().toISOString() }).eq("id", invoiceId);
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
    .select("item_id, quantity, received_quantity, purchase_orders!inner(po_number, status)")
    .neq("purchase_orders.status", "received");
  const { data: openOverseasItems } = await from("overseas_purchase_order_items")
    .select("item_id, quantity, received_quantity, overseas_purchase_orders!inner(po_number, status)")
    .neq("overseas_purchase_orders.status", "received");

  const onOrder: Record<string, { localQty: number; overseasQty: number; localPOs: string[]; overseasPOs: string[] }> = {};
  for (const li of (openPOItems as any[]) || []) {
    if (!li.item_id) continue;
    const remaining = (li.quantity || 0) - (li.received_quantity || 0);
    if (remaining <= 0) continue;
    const e = onOrder[li.item_id] ||= { localQty: 0, overseasQty: 0, localPOs: [], overseasPOs: [] };
    e.localQty += remaining;
    const num = li.purchase_orders?.po_number;
    if (num && !e.localPOs.includes(num)) e.localPOs.push(num);
  }
  for (const li of (openOverseasItems as any[]) || []) {
    if (!li.item_id) continue;
    const remaining = (li.quantity || 0) - (li.received_quantity || 0);
    if (remaining <= 0) continue;
    const e = onOrder[li.item_id] ||= { localQty: 0, overseasQty: 0, localPOs: [], overseasPOs: [] };
    e.overseasQty += remaining;
    const num = li.overseas_purchase_orders?.po_number;
    if (num && !e.overseasPOs.includes(num)) e.overseasPOs.push(num);
  }

  const itemsList = (items as any[]) || [];
  const totalValue = itemsList.reduce((sum: number, i: any) => sum + (i.quantity * i.cost_price), 0);
  const lowStockItems = itemsList
    .filter((i: any) => (i.low_stock_threshold ?? 0) > 0 && i.quantity <= i.low_stock_threshold)
    .map((i: any) => ({ ...i, on_order: onOrder[i.id] || { localQty: 0, overseasQty: 0, localPOs: [], overseasPOs: [] } }));

  return {
    totalItems: itemsList.length,
    totalValue,
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
  const { data, error } = await from("online_sales").select("*, items(*)").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
};

export const createOnlineSale = async (sale: Partial<OnlineSale>) => {
  const { data, error } = await from("online_sales").insert(sale).select().single();
  if (error) throw error;
  const created = data as OnlineSale;

  // Deduct inventory if linked to an item
  if (created.item_id) {
    const qty = created.quantity || 1;
    const { data: currentItem } = await from("items").select("quantity").eq("id", created.item_id).single();
    await from("items").update({
      quantity: Math.max(0, ((currentItem as any)?.quantity || 0) - qty),
      updated_at: new Date().toISOString()
    }).eq("id", created.item_id);

    await from("inventory_movements").insert({
      item_id: created.item_id,
      type: "out_online_sale",
      quantity: qty,
      reference_id: created.id,
      reference_type: "online_sale",
      notes: `Sold via ${created.sales_channel} - ${created.order_number}`
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
  const { data: sale } = await from("online_sales").select("item_id, order_number, sales_channel, quantity, status").eq("id", id).single();
  if (!sale) throw new Error("Sale not found");
  const s = sale as any;
  if (s.status === 'returned' || s.status === 'cancelled') throw new Error("Sale already returned/cancelled");

  // Restore inventory if linked to an item
  if (s.item_id) {
    const qty = s.quantity || 1;
    const { data: currentItem } = await from("items").select("quantity").eq("id", s.item_id).single();
    await from("items").update({
      quantity: ((currentItem as any)?.quantity || 0) + qty,
      updated_at: new Date().toISOString()
    }).eq("id", s.item_id);

    await from("inventory_movements").insert({
      item_id: s.item_id,
      type: "in_po",
      quantity: qty,
      reference_id: id,
      reference_type: `online_sale_${status}`,
      notes: `${status === 'returned' ? 'Returned' : 'Cancelled'} order ${s.order_number} — inventory restored`
    });
  }

  const { data, error } = await from("online_sales").update({ status, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw error;
  await logActivity(`${status}_online_sale`, "online_sale", id, { order_number: s.order_number });
  return data as OnlineSale;
};

export const deleteOnlineSale = async (id: string) => {
  // Restore inventory if linked to an item
  const { data: sale } = await from("online_sales").select("item_id, order_number, sales_channel, quantity, status").eq("id", id).single();
  if (sale && (sale as any).item_id && (sale as any).status === 'completed') {
    const itemId = (sale as any).item_id;
    const qty = (sale as any).quantity || 1;
    const { data: currentItem } = await from("items").select("quantity").eq("id", itemId).single();
    await from("items").update({
      quantity: ((currentItem as any)?.quantity || 0) + qty,
      updated_at: new Date().toISOString()
    }).eq("id", itemId);

    await from("inventory_movements").insert({
      item_id: itemId,
      type: "in_po",
      quantity: qty,
      reference_id: id,
      reference_type: "online_sale_delete",
      notes: `Restored from deleted online sale`
    });
  }

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
  const { data, error } = await from("overseas_purchase_orders").update({ ...po, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw error;
  return data as OverseasPurchaseOrder;
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
  itemsToReceive: { poItemId: string; itemId: string | null; quantity: number }[],
) => {
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
      .update({ received_quantity: newReceived })
      .eq("id", item.poItemId);

    if (item.itemId) {
      const { data: currentItem } = await from("items").select("quantity").eq("id", item.itemId).single();
      await from("items").update({
        quantity: ((currentItem as any)?.quantity || 0) + item.quantity,
        updated_at: new Date().toISOString(),
      }).eq("id", item.itemId);

      await from("inventory_movements").insert({
        item_id: item.itemId,
        type: "in_po",
        quantity: item.quantity,
        reference_id: poId,
        reference_type: "overseas_purchase_order",
        notes: "Received from overseas PO",
      });
    }
  }

  // Recompute PO status based on all line items
  const { data: allItems } = await from("overseas_purchase_order_items")
    .select("quantity, received_quantity")
    .eq("po_id", poId);
  const list = (allItems as any[]) || [];
  const allReceived = list.length > 0 && list.every((i) => (i.received_quantity || 0) >= i.quantity);
  const someReceived = list.some((i) => (i.received_quantity || 0) > 0);
  const newStatus = allReceived ? "received" : someReceived ? "partially_received" : "draft";

  await from("overseas_purchase_orders")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", poId);
  await logActivity("received_overseas_purchase_order", "overseas_purchase_order", poId, { status: newStatus });
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
