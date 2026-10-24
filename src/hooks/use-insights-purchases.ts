import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/paginate";
import { median, type SupplierLeadStats } from "@/lib/restock";

export interface PoLine {
  itemId: string | null;
  name: string;
  qty: number;
  received: number;
  /** Unit cost in pesos (overseas lines converted at the PO's rate). */
  unitCostPhp: number;
  receivedDate: string | null;
}

export interface PoRow {
  id: string;
  kind: "local" | "overseas";
  number: string;
  supplierId: string | null;
  supplier: string;
  orderDate: string | null;
  expected: string | null;
  /** Overseas only: when the supplier shipped it. */
  shippedAt: string | null;
  dueDate: string | null;
  status: string;
  /** Goods total in pesos. */
  goodsPhp: number;
  /** Shipping, customs, delivery and other charges recorded on the PO, in pesos. */
  chargesPhp: number;
  lines: PoLine[];
  /** Units ordered but not yet received. */
  remainingUnits: number;
  /** Peso value of those units. */
  remainingPhp: number;
  /** What is still owed on the PO — the same rule as the Financial Dashboard's payables. */
  owedPhp: number;
}

// Overseas statuses that mean the supplier has not been paid in full. Mirrors
// the payables rule in src/lib/api.ts so the two pages agree.
const OVERSEAS_UNPAID = new Set(["unpaid", "draft", "sent", "shipped_not_paid"]);

export const PO_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  unpaid: "Unpaid",
  paid_not_shipped: "Paid, not shipped",
  shipped_not_paid: "Shipped, not paid",
  shipped: "Shipped",
  partially_received: "Partly received",
  received: "Received",
  pending_cargo_adjustment: "Awaiting cargo bill",
  cargo_adjusted: "Cargo adjusted",
  closed: "Closed",
};

/**
 * Every local and overseas purchase order with its lines, in pesos. Shared by
 * the Purchases and Forecast tabs (same query key, fetched once).
 */
export function useInsightsPurchases(branchId: string | null) {
  const query = useQuery({
    queryKey: ["bi_purchases", branchId],
    queryFn: async () => {
      const [local, localItems, overseas, overseasItems, deposits, suppliers, overseasSuppliers] = await Promise.all([
        fetchAllRows<any>(() => {
          let q = supabase
            .from("purchase_orders")
            .select("id, po_number, order_date, expected_delivery, payment_due_date, status, supplier_id, total_amount, total_additional_charges, branch_id")
            .order("id", { ascending: true });
          if (branchId) q = q.eq("branch_id", branchId);
          return q;
        }),
        fetchAllRows<any>(() =>
          supabase.from("purchase_order_items").select("id, po_id, item_id, item_name, quantity, received_quantity, unit_cost, received_date").order("id", { ascending: true })
        ),
        fetchAllRows<any>(() => {
          let q = supabase
            .from("overseas_purchase_orders")
            .select("id, po_number, order_date, expected_delivery, shipped_at, payment_due_date, status, supplier_id, total_amount, total_additional_charges, exchange_rate, branch_id")
            .order("id", { ascending: true });
          if (branchId) q = q.eq("branch_id", branchId);
          return q;
        }),
        fetchAllRows<any>(() =>
          supabase.from("overseas_purchase_order_items").select("id, po_id, item_id, item_name, quantity, received_quantity, unit_cost, received_date").order("id", { ascending: true })
        ),
        // Deposits are not fatal: without them the balance owed reads high, not wrong elsewhere.
        fetchAllRows<any>(() => supabase.from("overseas_po_payments").select("id, po_id, php_amount").order("id", { ascending: true })).catch(() => []),
        fetchAllRows<any>(() => supabase.from("suppliers").select("id, name").order("id", { ascending: true })),
        fetchAllRows<any>(() => supabase.from("overseas_suppliers").select("id, name").order("id", { ascending: true })),
      ]);
      return { local, localItems, overseas, overseasItems, deposits, suppliers, overseasSuppliers };
    },
  });

  const orders = useMemo<PoRow[]>(() => {
    const d = query.data;
    if (!d) return [];
    const names = new Map<string, string>();
    for (const s of d.suppliers) names.set(s.id, s.name);
    for (const s of d.overseasSuppliers) names.set(s.id, s.name);
    const group = (rows: any[]) => {
      const m = new Map<string, any[]>();
      for (const r of rows) {
        const arr = m.get(r.po_id) || [];
        arr.push(r);
        m.set(r.po_id, arr);
      }
      return m;
    };
    const localLines = group(d.localItems);
    const overseasLines = group(d.overseasItems);
    const depositsByPo = new Map<string, number>();
    for (const p of d.deposits) depositsByPo.set(p.po_id, (depositsByPo.get(p.po_id) || 0) + Number(p.php_amount || 0));

    const build = (po: any, kind: PoRow["kind"], rawLines: any[], rate: number): PoRow => {
      const lines: PoLine[] = rawLines.map((l) => ({
        itemId: l.item_id || null,
        name: l.item_name || "—",
        qty: Number(l.quantity || 0),
        received: Number(l.received_quantity || 0),
        unitCostPhp: Number(l.unit_cost || 0) * rate,
        receivedDate: l.received_date || null,
      }));
      const open = po.status !== "received";
      let remainingUnits = 0;
      let remainingPhp = 0;
      if (open) {
        for (const l of lines) {
          const rem = l.qty - l.received;
          if (rem <= 0) continue;
          remainingUnits += rem;
          remainingPhp += rem * l.unitCostPhp;
        }
      }
      // Local POs are paid on receipt, so whatever has not arrived is still owed.
      // Overseas POs are owed while unpaid, less any deposits already sent.
      const owedPhp =
        kind === "local"
          ? remainingPhp
          : OVERSEAS_UNPAID.has(po.status)
            ? Math.max(remainingPhp - (depositsByPo.get(po.id) || 0), 0)
            : 0;
      return {
        id: po.id,
        kind,
        number: po.po_number || "—",
        supplierId: po.supplier_id || null,
        supplier: names.get(po.supplier_id) || "No supplier",
        orderDate: po.order_date || null,
        expected: po.expected_delivery || null,
        shippedAt: po.shipped_at ? String(po.shipped_at).slice(0, 10) : null,
        dueDate: po.payment_due_date || null,
        status: po.status || "",
        goodsPhp: Number(po.total_amount || 0) * rate,
        chargesPhp: Number(po.total_additional_charges || 0),
        lines,
        remainingUnits,
        remainingPhp,
        owedPhp,
      };
    };

    return [
      ...d.local.map((po) => build(po, "local", localLines.get(po.id) || [], 1)),
      ...d.overseas.map((po) => build(po, "overseas", overseasLines.get(po.id) || [], Number(po.exchange_rate || 1))),
    ];
  }, [query.data]);

  /** Units on order per item, across every open PO. */
  const onOrderByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const po of orders) {
      if (po.status === "received") continue;
      for (const l of po.lines) {
        const rem = l.qty - l.received;
        if (l.itemId && rem > 0) m.set(l.itemId, (m.get(l.itemId) || 0) + rem);
      }
    }
    return m;
  }, [orders]);

  /**
   * What past deliveries say about each supplier: median days from order to
   * the goods arriving, and for overseas orders with a ship date, how that
   * splits into production (order → shipped) and transit (shipped → received).
   * One figure per PO — the day its first goods were received — so a PO with
   * many lines does not count many times.
   */
  const leadTimeBySupplier = useMemo(() => {
    const acc = new Map<string, { total: number[]; production: number[]; transit: number[]; onTime: number; withExpected: number }>();
    const days = (from: string, to: string) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
    for (const po of orders) {
      if (!po.supplierId || !po.orderDate) continue;
      const received = po.lines.map((l) => l.receivedDate).filter((d): d is string => !!d).sort()[0];
      if (!received) continue;
      const total = days(po.orderDate, received);
      if (total < 0) continue;
      const e = acc.get(po.supplierId) || { total: [], production: [], transit: [], onTime: 0, withExpected: 0 };
      e.total.push(total);
      if (po.shippedAt) {
        const prod = days(po.orderDate, po.shippedAt);
        const trans = days(po.shippedAt, received);
        if (prod >= 0 && trans >= 0) {
          e.production.push(prod);
          e.transit.push(trans);
        }
      }
      if (po.expected) {
        e.withExpected += 1;
        if (received <= po.expected) e.onTime += 1;
      }
      acc.set(po.supplierId, e);
    }
    const out = new Map<string, SupplierLeadStats>();
    for (const [k, e] of acc) {
      out.set(k, {
        days: median(e.total)!,
        deliveries: e.total.length,
        productionDays: median(e.production),
        transitDays: median(e.transit),
        onTimePct: e.withExpected ? (e.onTime / e.withExpected) * 100 : null,
      });
    }
    return out;
  }, [orders]);

  return { orders, onOrderByItem, leadTimeBySupplier, isLoading: query.isLoading };
}
