// Database types for our ERP system
export interface Item {
  id: string;
  name: string;
  sku: string;
  description: string;
  quantity: number;
  warehouse_quantity: number;
  store_quantity: number;
  cost_price: number;
  cost_price_rmb?: number;
  selling_price: number;
  low_stock_threshold: number;
  source: 'local' | 'import';
  base_unit: string;
  units_per_stock: number;
  open_roll_remaining: number;
  category?: string | null;
  brand?: string | null;
  barcode?: string | null;
  supplier_sku?: string | null;
  status?: 'active' | 'inactive' | 'discontinued' | 'archived';
  archived_at?: string | null;
  archived_by_email?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemVariation {
  id: string;
  item_id: string;
  name: string;
  sku: string | null;
  type: 'pack' | 'cut';
  /** For pack: pieces per pack. For cut: meters per cut. */
  factor: number;
  selling_price: number;
  /** Cost. Auto-computed from parent (cost_price × factor / units_per_stock) unless cost_is_manual. */
  cost_price: number | null;
  /** True when a user typed an explicit cost that must not be auto-recalculated. */
  cost_is_manual?: boolean;
  created_at: string;
  updated_at: string;
  items?: Item;
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

export interface Loan {
  id: string;
  lender: string;
  principal_amount: number;
  interest_rate: number;
  monthly_payment: number;
  due_date: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  country?: string | null;
  province_state?: string | null;
  city_municipality?: string | null;
  district_area?: string | null;
  barangay_village?: string | null;
  full_address?: string | null;
  postal_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  classification?: "retail" | "wholesale" | "recurring" | null;
  last_follow_up_at?: string | null;
  tags?: string[] | null;
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
  received_date: string | null;
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
  payment_terms: number | null;
  payment_due_date: string | null;
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
  variation_id: string | null;
  items?: Item;
  item_variations?: ItemVariation;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  customer_id: string | null;
  quotation_id: string | null;
  status: 'draft' | 'confirmed' | 'paid' | 'unpaid' | 'reserved' | 'shipped' | 'completed' | 'cancelled';
  invoice_date: string;
  due_date: string | null;
  notes: string;
  total_amount: number;
  sales_agent: string;
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
  variation_id: string | null;
  items?: Item;
  item_variations?: ItemVariation;
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
  status: 'unpaid' | 'paid_not_shipped' | 'shipped_not_paid' | 'shipped' | 'partially_received' | 'pending_cargo_adjustment' | 'cargo_adjusted' | 'received' | 'draft' | 'sent';
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
  received_quantity: number;
  received_date: string | null;
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
  /** Received at the China warehouse, before onward shipping. */
  warehouse_received_date: string | null;
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
  variation_id: string | null;
  status: 'completed' | 'returned' | 'cancelled';
  amount_paid: number;
  payment_status: 'paid' | 'unpaid';
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  items?: Item;
  item_variations?: ItemVariation;
}

export interface InventoryMovement {
  id: string;
  item_id: string;
  type: 'in_po' | 'out_invoice' | 'out_online_sale' | 'transfer_w2s' | 'transfer_s2w';
  quantity: number;
  reference_id: string | null;
  reference_type: string | null;
  notes: string;
  created_at: string;
  items?: Item;
}

export type CashAccountType = 'petty_cash' | 'bank';

export interface CashAccount {
  id: string;
  name: string;
  account_type: CashAccountType;
  currency: string;
  account_number: string;
  opening_balance: number;
  is_active: boolean;
  sort_order: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface CashTransaction {
  id: string;
  account_id: string;
  txn_date: string;
  direction: 'in' | 'out';
  amount: number;
  category: string;
  payee: string;
  reference: string;
  notes: string;
  transfer_group_id: string | null;
  fx_rate: number | null;
  source_invoice_id: string | null;
  created_by: string | null;
  created_by_email: string;
  updated_by: string | null;
  updated_by_email: string;
  created_at: string;
  updated_at: string;
  /** Joined for display only — the query selects the name alone. */
  cash_accounts?: Pick<CashAccount, "name">;
}

export interface OwnerTransaction {
  id: string;
  txn_date: string;
  txn_type: 'owner_paid' | 'company_repaid';
  amount: number;
  method: 'credit_card' | 'cash' | 'bank_transfer' | 'other';
  description: string;
  category: string;
  reference: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Payable {
  id: string;
  payee: string;
  supplier_id: string | null;
  amount: number;
  amount_paid: number;
  due_date: string | null;
  status: 'unpaid' | 'partial' | 'paid' | 'cleared' | 'bounced' | 'cancelled';
  is_check: boolean;
  check_number: string;
  /** The bank as written on the check face. Display only — the link is cash_account_id. */
  check_bank: string;
  /** Account the payable is settled from; marking it Paid withdraws from here. */
  cash_account_id: string | null;
  date_written: string | null;
  category: string;
  notes: string;
  created_at: string;
  updated_at: string;
  suppliers?: Supplier;
}
