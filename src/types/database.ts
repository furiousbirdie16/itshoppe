// Database types for our ERP system
export interface Item {
  id: string;
  name: string;
  sku: string;
  description: string;
  quantity: number;
  cost_price: number;
  selling_price: number;
  low_stock_threshold: number;
  created_at: string;
  updated_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  created_at: string;
}

export interface Customer {
  id: string;
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  created_at: string;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string | null;
  status: 'draft' | 'sent' | 'partially_received' | 'received';
  order_date: string;
  expected_delivery: string | null;
  notes: string;
  total_amount: number;
  created_at: string;
  updated_at: string;
  suppliers?: Supplier;
}

export interface PurchaseOrderItem {
  id: string;
  po_id: string;
  item_id: string;
  quantity: number;
  received_quantity: number;
  unit_cost: number;
  items?: Item;
}

export interface Quotation {
  id: string;
  quotation_number: string;
  customer_id: string | null;
  status: 'draft' | 'sent' | 'accepted' | 'rejected';
  quotation_date: string;
  valid_until: string | null;
  notes: string;
  total_amount: number;
  sales_agent: string;
  created_at: string;
  customers?: Customer;
}

export interface QuotationItem {
  id: string;
  quotation_id: string;
  item_id: string | null;
  item_name: string | null;
  quantity: number;
  unit_price: number;
  items?: Item;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  customer_id: string | null;
  quotation_id: string | null;
  status: 'draft' | 'confirmed' | 'paid' | 'unpaid';
  invoice_date: string;
  due_date: string | null;
  notes: string;
  total_amount: number;
  created_at: string;
  updated_at: string;
  customers?: Customer;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  item_id: string | null;
  item_name: string | null;
  quantity: number;
  unit_price: number;
  items?: Item;
}

export interface OverseasSupplier {
  id: string;
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  country: string;
  currency: 'USD' | 'RMB';
  exchange_rate: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface OverseasPurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string | null;
  status: 'draft' | 'sent' | 'received';
  order_date: string;
  expected_delivery: string | null;
  notes: string;
  total_amount: number;
  currency: 'USD' | 'RMB';
  exchange_rate: number;
  created_at: string;
  updated_at: string;
  overseas_suppliers?: OverseasSupplier;
}

export interface OverseasPurchaseOrderItem {
  id: string;
  po_id: string;
  item_name: string;
  description: string;
  quantity: number;
  unit_cost: number;
  item_id: string | null;
  created_at: string;
  items?: Item;
}

export interface ShipmentTracking {
  id: string;
  po_id: string | null;
  tracking_number: string;
  shipping_method: string;
  ship_date: string | null;
  estimated_arrival: string | null;
  actual_arrival: string | null;
  status: 'in_transit' | 'customs' | 'delivered';
  notes: string;
  created_at: string;
  updated_at: string;
  overseas_purchase_orders?: OverseasPurchaseOrder;
}

export interface OnlineSale {
  id: string;
  order_number: string;
  order_date: string;
  product_name: string;
  quantity: number;
  sales_channel: 'shopee' | 'lazada' | 'others';
  posted_price: number;
  deal_price: number;
  notes: string;
  item_id: string | null;
  status: 'completed' | 'returned' | 'cancelled';
  created_at: string;
  updated_at: string;
  items?: Item;
}

export interface InventoryMovement {
  id: string;
  item_id: string;
  type: 'in_po' | 'out_invoice' | 'out_online_sale';
  quantity: number;
  reference_id: string | null;
  reference_type: string | null;
  notes: string;
  created_at: string;
  items?: Item;
}
