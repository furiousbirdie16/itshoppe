import { peso } from "@/lib/currency";
import { paymentVariance } from "@/lib/payment-variance";
import { cn } from "@/lib/utils";

interface Props {
  total: number | null | undefined;
  received: number | null | undefined;
  className?: string;
}

/**
 * "+₱200.00" or "−₱150.00" beside an invoice total.
 *
 * Small enough to sit under a figure in a list, so a payment that did not match
 * its invoice is visible while scanning rather than something to be found by
 * opening each one.
 */
export function PaymentVarianceChip({ total, received, className }: Props) {
  const diff = paymentVariance(total, received);
  if (diff == null) return null;

  const over = diff > 0;
  return (
    <span
      className={cn(
        "inline-block rounded px-1 py-px text-[10px] font-semibold tabular-nums",
        over
          ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
          : "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
        className,
      )}
      title={`Received ${peso(Number(received || 0))} against an invoice of ${peso(Number(total || 0))} — ${peso(Math.abs(diff))} ${over ? "over" : "short"}`}
    >
      {over ? "+" : "−"}{peso(Math.abs(diff))}
    </span>
  );
}
