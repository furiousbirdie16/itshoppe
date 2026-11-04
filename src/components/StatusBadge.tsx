import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
  context?: "invoice" | "overseas_po" | "default";
}

const statusStyles: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-primary/10 text-primary",
  shipped: "bg-primary/10 text-primary",
  paid_not_shipped: "bg-primary/10 text-primary",
  shipped_not_paid: "bg-destructive/10 text-destructive",
  partially_received: "bg-warning/10 text-warning",
  received: "bg-success/10 text-success",
  accepted: "bg-success/10 text-success",
  rejected: "bg-destructive/10 text-destructive",
  confirmed: "bg-success/10 text-success",
  paid: "bg-success/10 text-success",
  unpaid: "bg-warning/10 text-warning",
  pending_cargo_adjustment: "bg-warning/10 text-warning",
  cargo_adjusted: "bg-success/10 text-success",
  closed: "bg-muted text-muted-foreground",
  reserved: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  completed: "bg-success/10 text-success",
  cancelled: "bg-muted text-muted-foreground line-through",
};

const invoiceLabels: Record<string, string> = {
  draft: "not shipped",
  confirmed: "shipped, not paid",
  paid: "paid, not shipped",
  shipped: "shipped, not paid",
  completed: "completed",
  reserved: "reserved",
  cancelled: "cancelled",
  unpaid: "unpaid",
};

const overseasPoLabels: Record<string, string> = {
  draft: "unpaid",
  sent: "shipped",
  paid_not_shipped: "paid, not shipped",
  shipped_not_paid: "shipped, not paid",
  pending_cargo_adjustment: "pending cargo adj.",
  cargo_adjusted: "cargo adjusted",
};


export function StatusBadge({ status, className, context = "default" }: StatusBadgeProps) {
  const label =
    context === "invoice" && invoiceLabels[status]
      ? invoiceLabels[status]
      : context === "overseas_po" && overseasPoLabels[status]
        ? overseasPoLabels[status]
        : status.replace(/_/g, " ");
  const styleKey =
    context === "overseas_po" && status === "draft"
      ? "unpaid"
      : context === "overseas_po" && status === "sent"
        ? "shipped"
        : context === "invoice" && status === "confirmed"
          ? "rejected" // shipped but not paid → red
          : context === "invoice" && status === "shipped"
            ? "rejected" // shipped but not yet paid → red
            : context === "invoice" && status === "paid"
              ? "paid_not_shipped" // paid but pending shipment → blue
              : status;

  // Sentence case: uppercase pills were louder than the invoice numbers beside them.
  const text = label.charAt(0).toUpperCase() + label.slice(1);

  return (
    <span
      className={cn(
        // whitespace-nowrap: the longer labels ("shipped, not paid") were
        // wrapping to three lines in a narrow column and rendering as a blob.
        "inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium",
        statusStyles[styleKey] || "bg-muted text-muted-foreground",
        className
      )}
    >
      {text}
    </span>
  );
}
