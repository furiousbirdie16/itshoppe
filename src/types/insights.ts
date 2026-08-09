// Shared types for Business Insights. Kept out of the page module so the
// mobile card component can import them without a circular dependency.

export interface SaleTxn {
  date: string;
  customer: string;
  agent: string;
  source: "online" | "invoice";
  reference: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  invoiceId?: string | null;
  itemId?: string | null;
  variationId?: string | null;
  variationName?: string | null;
  cost?: number;
  profit?: number;
  paymentStatus?: "paid" | "unpaid";
}

export type ProductAction = "Buy" | "Maintain" | "Reduce" | "Dead" | "Overstock";

/** One row per parent product OR per variation — variations are never rolled up. */
export interface ProductMetric {
  key: string;
  itemId: string;
  variationId: string | null;
  kind: "parent" | "variation";
  /** Parent name, or "parent — variation" for variation rows. */
  name: string;
  sku: string;
  variationLabel: string | null;
  source: string;
  stock: number;
  cost: number;
  sellingPrice: number;
  threshold: number;
  qtySold: number;
  revenue: number;
  totalCost: number;
  grossProfit: number;
  margin: number;
  dailySales: number;
  daysRemaining: number;
  gmroi: number | null;
  avgInventoryValue: number | null;
  action: ProductAction;
}
