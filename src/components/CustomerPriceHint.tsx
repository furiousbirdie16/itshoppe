import { useEffect, useState } from "react";
import { getCustomerPrice, type CustomerPriceInfo } from "@/lib/customerPricing";
import { peso } from "@/lib/currency";
import { format } from "date-fns";
import { AlertTriangle, Star } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  customerId: string | null | undefined;
  itemId: string | null | undefined;
  variationId: string | null | undefined;
  standardPrice: number;
  costPrice?: number;
  currentPrice?: number;
  onSuggested?: (suggested: number, info: CustomerPriceInfo) => void;
}

/**
 * Inline hint shown under the price input. Auto-fetches customer pricing
 * info and (once per customer/item change) calls onSuggested with the
 * suggested price so the parent can auto-fill the input.
 */
export function CustomerPriceHint({
  customerId,
  itemId,
  variationId,
  standardPrice,
  costPrice,
  currentPrice,
  onSuggested,
}: Props) {
  const [info, setInfo] = useState<CustomerPriceInfo | null>(null);
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const key = `${customerId || ""}|${itemId || ""}|${variationId || ""}|${standardPrice}`;

  useEffect(() => {
    let cancelled = false;
    if (!customerId || !itemId) {
      setInfo(null);
      return;
    }
    getCustomerPrice(customerId, itemId, variationId ?? null, standardPrice).then((res) => {
      if (cancelled) return;
      setInfo(res);
      onSuggested?.(res.suggested, res);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!customerId || !itemId) return null;

  const belowCost = isAdmin && costPrice != null && currentPrice != null && currentPrice > 0 && currentPrice < costPrice;
  const lastSoldPrice = info?.lastSold?.price;
  const muchLower =
    !belowCost &&
    lastSoldPrice &&
    currentPrice != null &&
    currentPrice > 0 &&
    currentPrice < lastSoldPrice * 0.85;

  return (
    <div className="text-[11px] text-muted-foreground mt-0.5 ml-1 flex flex-wrap gap-x-2 gap-y-0.5">
      <span>Std {peso(standardPrice)}</span>
      {info?.fixed != null && (
        <span className="text-primary font-medium inline-flex items-center gap-0.5">
          <Star className="h-2.5 w-2.5 fill-current" /> Fixed {peso(info.fixed)}
        </span>
      )}
      {info?.lastSold && (
        <span>
          Last {peso(info.lastSold.price)} · {format(new Date(info.lastSold.date), "MMM d, yyyy")}
        </span>
      )}
      {belowCost && (
        <span className="text-destructive font-medium inline-flex items-center gap-0.5">
          <AlertTriangle className="h-2.5 w-2.5" /> Below cost {peso(costPrice!)}
        </span>
      )}
      {muchLower && (
        <span className="text-amber-600 font-medium inline-flex items-center gap-0.5">
          <AlertTriangle className="h-2.5 w-2.5" /> &gt;15% under last sold
        </span>
      )}
    </div>
  );
}

export default CustomerPriceHint;
