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
  paid_not_shipped: "bg-blue-500/10 text-blue-600",
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
};

const invoiceLabels: Record<string, string> = {
  draft: "not shipped",
  confirmed: "shipped",
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
          : status;
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider",
        statusStyles[styleKey] || "bg-muted text-muted-foreground",
        className
      )}
    >
      {label}
    </span>
  );
}
