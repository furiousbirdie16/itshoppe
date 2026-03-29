import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

const statusColors: Record<string, string> = {
  draft: "bg-secondary text-secondary-foreground",
  sent: "bg-primary/10 text-primary",
  partially_received: "bg-warning/10 text-warning",
  received: "bg-success/10 text-success",
  accepted: "bg-success/10 text-success",
  rejected: "bg-destructive/10 text-destructive",
  confirmed: "bg-success/10 text-success",
  paid: "bg-success/10 text-success",
  unpaid: "bg-warning/10 text-warning",
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize",
        statusColors[status] || "bg-secondary text-secondary-foreground",
        className
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
