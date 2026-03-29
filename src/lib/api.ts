import { supabase } from "@/integrations/supabase/client";
import type { Item, Supplier, Customer, PurchaseOrder, PurchaseOrderItem, Quotation, QuotationItem, Invoice, InvoiceItem, InventoryMovement } from "@/types/database";

// Use any-typed client to bypass empty generated types until migration runs
const db = supabase as any;

// Items
export const getItems = async () => {
  const { data, error } = await supabase.from("items").select("*").order("name");
  if (error) throw error;
  return data as Item[];
};

export const createItem = async (item: Partial<Item>) => {
  const { data, error } = await supabase.from("items").insert(item).select().single();
  if (error) throw error;
  return data as Item;
};

export const updateItem = async (id: string, item: Partial<Item>) => {
  const { data, error } = await supabase.from("items").update({ ...item, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw error;
  return data as Item;
};

export const deleteItem = async (id: string) => {
  const { error } = await supabase.from("items").delete().eq("id", id);
  if (error) throw error;
};

// Suppliers
export const getSuppliers = async () => {
  const { data, error } = await supabase.from("suppliers").select("*").order("name");
  if (error) throw error;
  return data as Supplier[];
};

export const createSupplier = async (supplier: Partial<Supplier>) => {
  const { data, error } = await supabase.from("suppliers").insert(supplier).select().single();
  if (error) throw error;
  return data as Supplier;
};

export const updateSupplier = async (id: string, supplier: Partial<Supplier>) => {
  const { data, error } = await supabase.from("suppliers").update(supplier).eq("id", id).select().single();
  if (error) throw error;
  return data as Supplier;
};

export const deleteSupplier = async (id: string) => {
  const { error } = await supabase.from("suppliers").delete().eq("id", id);
  if (error) throw error;
};

// Customers
export const getCustomers = async () => {
  const { data, error } = await supabase.from("customers").select("*").order("name");
  if (error) throw error;
  return data as Customer[];
};

export const createCustomer = async (customer: Partial<Customer>) => {
  const { data, error } = await supabase.from("customers").insert(customer).select().single();
  if (error) throw error;
  return data as Customer;
};

export const updateCustomer = async (id: string, customer: Partial<Customer>) => {
  const { data, error } = await supabase.from("customers").update(customer).eq("id", id).select().single();
  if (error) throw error;
  return data as Customer;
};

export const deleteCustomer = async (id: string) => {
  const { error } = await supabase.from("customers").delete().eq("id", id);
  if (error) throw error;
};

// Purchase Orders
export const getPurchaseOrders = async () => {
  const { data, error } = await supabase.from("purchase_orders").select("*, suppliers(*)").order("created_at", { ascending: false });
  if (error) throw error;
  return data as PurchaseOrder[];
};

export const createPurchaseOrder = async (po: Partial<PurchaseOrder>) => {
  const { data, error } = await supabase.from("purchase_orders").insert(po).select().single();
  if (error) throw error;
  return data as PurchaseOrder;
};

export const updatePurchaseOrder = async (id: string, po: Partial<PurchaseOrder>) => {
  const { data, error } = await supabase.from("purchase_orders").update({ ...po, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw error;
  return data as PurchaseOrder;
};

export const deletePurchaseOrder = async (id: string) => {
  const { error } = await supabase.from("purchase_orders").delete().eq("id", id);
  if (error) throw error;
};

export const getPOItems = async (poId: string) => {
  const { data, error } = await supabase.from("purchase_order_items").select("*, items(*)").eq("po_id", poId);
  if (error) throw error;
  return data as PurchaseOrderItem[];
};

export const createPOItems = async (items: Partial<PurchaseOrderItem>[]) => {
  const { error } = await supabase.from("purchase_order_items").insert(items);
  if (error) throw error;
};

export const deletePOItems = async (poId: string) => {
  const { error } = await supabase.from("purchase_order_items").delete().eq("po_id", poId);
  if (error) throw error;
};

// Receive PO - critical business logic
export const receivePO = async (poId: string, itemsToReceive: { poItemId: string; itemId: string; quantity: number }[]) => {
  for (const item of itemsToReceive) {
    // Update received quantity on PO item
    const { data: poItem } = await supabase
      .from("purchase_order_items")
      .select("received_quantity")
      .eq("id", item.poItemId)
      .single();
    
    const newReceived = (poItem?.received_quantity || 0) + item.quantity;
    await supabase.from("purchase_order_items").update({ received_quantity: newReceived }).eq("id", item.poItemId);

    // Add to inventory
    const { data: currentItem } = await supabase.from("items").select("quantity").eq("id", item.itemId).single();
    await supabase.from("items").update({ 
      quantity: (currentItem?.quantity || 0) + item.quantity,
      updated_at: new Date().toISOString()
    }).eq("id", item.itemId);

    // Log movement
    await supabase.from("inventory_movements").insert({
      item_id: item.itemId,
      type: "in_po",
      quantity: item.quantity,
      reference_id: poId,
      reference_type: "purchase_order",
      notes: `Received from PO`
    });
  }

  // Check if all items fully received
  const { data: allItems } = await supabase.from("purchase_order_items").select("quantity, received_quantity").eq("po_id", poId);
  const allReceived = allItems?.every(i => i.received_quantity >= i.quantity);
  const someReceived = allItems?.some(i => i.received_quantity > 0);
  
  const newStatus = allReceived ? "received" : someReceived ? "partially_received" : "draft";
  await supabase.from("purchase_orders").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", poId);
};

// Quotations
export const getQuotations = async () => {
  const { data, error } = await supabase.from("quotations").select("*, customers(*)").order("created_at", { ascending: false });
  if (error) throw error;
  return data as Quotation[];
};

export const createQuotation = async (q: Partial<Quotation>) => {
  const { data, error } = await supabase.from("quotations").insert(q).select().single();
  if (error) throw error;
  return data as Quotation;
};

export const updateQuotation = async (id: string, q: Partial<Quotation>) => {
  const { data, error } = await supabase.from("quotations").update(q).eq("id", id).select().single();
  if (error) throw error;
  return data as Quotation;
};

export const deleteQuotation = async (id: string) => {
  const { error } = await supabase.from("quotations").delete().eq("id", id);
  if (error) throw error;
};

export const getQuotationItems = async (qId: string) => {
  const { data, error } = await supabase.from("quotation_items").select("*, items(*)").eq("quotation_id", qId);
  if (error) throw error;
  return data as QuotationItem[];
};

export const createQuotationItems = async (items: Partial<QuotationItem>[]) => {
  const { error } = await supabase.from("quotation_items").insert(items);
  if (error) throw error;
};

export const deleteQuotationItems = async (qId: string) => {
  const { error } = await supabase.from("quotation_items").delete().eq("quotation_id", qId);
  if (error) throw error;
};

// Convert Quotation to Invoice
export const convertQuotationToInvoice = async (quotationId: string) => {
  const { data: quotation } = await supabase.from("quotations").select("*").eq("id", quotationId).single();
  if (!quotation) throw new Error("Quotation not found");

  const { data: qItems } = await supabase.from("quotation_items").select("*").eq("quotation_id", quotationId);

  // Generate invoice number
  const invNumber = `INV-${Date.now().toString(36).toUpperCase()}`;

  const { data: invoice, error } = await supabase.from("invoices").insert({
    invoice_number: invNumber,
    customer_id: quotation.customer_id,
    quotation_id: quotationId,
    status: "draft",
    invoice_date: new Date().toISOString().split("T")[0],
    notes: quotation.notes,
    total_amount: quotation.total_amount,
  }).select().single();

  if (error) throw error;

  if (qItems && qItems.length > 0) {
    await supabase.from("invoice_items").insert(
      qItems.map(qi => ({
        invoice_id: invoice.id,
        item_id: qi.item_id,
        quantity: qi.quantity,
        unit_price: qi.unit_price,
      }))
    );
  }

  // Update quotation status
  await supabase.from("quotations").update({ status: "accepted" }).eq("id", quotationId);

  return invoice as Invoice;
};

// Invoices
export const getInvoices = async () => {
  const { data, error } = await supabase.from("invoices").select("*, customers(*)").order("created_at", { ascending: false });
  if (error) throw error;
  return data as Invoice[];
};

export const createInvoice = async (inv: Partial<Invoice>) => {
  const { data, error } = await supabase.from("invoices").insert(inv).select().single();
  if (error) throw error;
  return data as Invoice;
};

export const updateInvoice = async (id: string, inv: Partial<Invoice>) => {
  const { data, error } = await supabase.from("invoices").update({ ...inv, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw error;
  return data as Invoice;
};

export const deleteInvoice = async (id: string) => {
  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) throw error;
};

export const getInvoiceItems = async (invId: string) => {
  const { data, error } = await supabase.from("invoice_items").select("*, items(*)").eq("invoice_id", invId);
  if (error) throw error;
  return data as InvoiceItem[];
};

export const createInvoiceItems = async (items: Partial<InvoiceItem>[]) => {
  const { error } = await supabase.from("invoice_items").insert(items);
  if (error) throw error;
};

export const deleteInvoiceItems = async (invId: string) => {
  const { error } = await supabase.from("invoice_items").delete().eq("invoice_id", invId);
  if (error) throw error;
};

// Confirm Invoice - deduct stock
export const confirmInvoice = async (invoiceId: string) => {
  const { data: invItems } = await supabase.from("invoice_items").select("*").eq("invoice_id", invoiceId);
  
  if (invItems) {
    for (const invItem of invItems) {
      const { data: currentItem } = await supabase.from("items").select("quantity").eq("id", invItem.item_id).single();
      await supabase.from("items").update({
        quantity: Math.max(0, (currentItem?.quantity || 0) - invItem.quantity),
        updated_at: new Date().toISOString()
      }).eq("id", invItem.item_id);

      await supabase.from("inventory_movements").insert({
        item_id: invItem.item_id,
        type: "out_invoice",
        quantity: invItem.quantity,
        reference_id: invoiceId,
        reference_type: "invoice",
        notes: `Deducted from invoice`
      });
    }
  }

  await supabase.from("invoices").update({ status: "confirmed", updated_at: new Date().toISOString() }).eq("id", invoiceId);
};

// Inventory Movements
export const getInventoryMovements = async (itemId?: string) => {
  let query = supabase.from("inventory_movements").select("*, items(*)").order("created_at", { ascending: false });
  if (itemId) query = query.eq("item_id", itemId);
  const { data, error } = await query;
  if (error) throw error;
  return data as InventoryMovement[];
};

// Dashboard stats
export const getDashboardStats = async () => {
  const { data: items } = await supabase.from("items").select("*");
  const { data: recentPOs } = await supabase.from("purchase_orders").select("*, suppliers(*)").order("created_at", { ascending: false }).limit(5);
  const { data: recentInvoices } = await supabase.from("invoices").select("*, customers(*)").order("created_at", { ascending: false }).limit(5);

  const totalValue = items?.reduce((sum, i) => sum + (i.quantity * i.cost_price), 0) || 0;
  const lowStockItems = items?.filter(i => i.quantity <= i.low_stock_threshold) || [];

  return {
    totalItems: items?.length || 0,
    totalValue,
    lowStockItems,
    recentPOs: recentPOs || [],
    recentInvoices: recentInvoices || [],
  };
};

// Generate unique numbers
export const generatePONumber = () => `PO-${Date.now().toString(36).toUpperCase()}`;
export const generateQuotationNumber = () => `QT-${Date.now().toString(36).toUpperCase()}`;
export const generateInvoiceNumber = () => `INV-${Date.now().toString(36).toUpperCase()}`;
