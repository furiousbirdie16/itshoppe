import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
  context?: "invoice" | "default";
}

const statusStyles: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-primary/10 text-primary",
  partially_received: "bg-warning/10 text-warning",
  received: "bg-success/10 text-success",
  accepted: "bg-success/10 text-success",
  rejected: "bg-destructive/10 text-destructive",
  confirmed: "bg-success/10 text-success",
  paid: "bg-success/10 text-success",
  unpaid: "bg-warning/10 text-warning",
};

const invoiceLabels: Record<string, string> = {
  draft: "not shipped",
  confirmed: "shipped",
};

export function StatusBadge({ status, className, context = "default" }: StatusBadgeProps) {
  const label =
    context === "invoice" && invoiceLabels[status]
      ? invoiceLabels[status]
      : status.replace(/_/g, " ");
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider",
        statusStyles[status] || "bg-muted text-muted-foreground",
        className
      )}
    >
      {label}
    </span>
  );
}
