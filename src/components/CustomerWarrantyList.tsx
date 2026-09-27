import { useQuery } from "@tanstack/react-query";
import { getSoldUnitsForCustomer } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { warrantyStatus } from "@/lib/warranty";
import { cn } from "@/lib/utils";

/**
 * The serialised units a customer holds, with how long each is covered.
 *
 * Answers the question from the other direction to the lookup page: not "whose
 * is this unit" but "what does this customer still have cover on" — which is
 * what you want when they phone rather than walk in.
 */
export function CustomerWarrantyList({ customerId }: { customerId: string }) {
  const { data: units = [] } = useQuery({
    queryKey: ["customer-sold-units", customerId],
    queryFn: () => getSoldUnitsForCustomer(customerId),
  });

  if (units.length === 0) return null;

  return (
    <div className="mt-4 border-t pt-3 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Serialised units · {units.length}
      </p>
      {units.map((u) => {
        const { state, expiresAt, daysLeft } = warrantyStatus(u);
        const label =
          state === "covered" ? `${daysLeft}d left`
          : state === "expired" ? "Expired"
          : state === "not_started" ? "Not collected"
          : "No warranty";
        return (
          <div key={u.id} className="flex items-center justify-between gap-2 text-xs">
            <div className="min-w-0">
              <span className="font-mono">{u.serial}</span>
              <span className="text-muted-foreground"> · {u.items?.name || "Item"}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {expiresAt && (
                <span className="text-muted-foreground">{format(expiresAt, "MMM d, yyyy")}</span>
              )}
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-medium whitespace-nowrap",
                  state === "covered" && "bg-success/15 text-success border-success/30",
                  state === "expired" && "bg-destructive/15 text-destructive border-destructive/30",
                  state === "not_started" && "bg-warning/15 text-warning border-warning/30",
                )}
              >
                {label}
              </Badge>
            </div>
          </div>
        );
      })}
    </div>
  );
}
