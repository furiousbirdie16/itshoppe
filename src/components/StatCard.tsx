import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  variant?: "default" | "warning" | "success";
}

export function StatCard({ title, value, icon: Icon, description, variant = "default" }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between gap-2 mb-2 sm:mb-3">
        <span className="text-[10px] sm:text-xs font-medium uppercase tracking-wider text-muted-foreground leading-tight">{title}</span>
        <div className={cn(
          "h-7 w-7 sm:h-8 sm:w-8 rounded-lg flex items-center justify-center shrink-0",
          variant === "warning" && "bg-warning/10 text-warning",
          variant === "success" && "bg-success/10 text-success",
          variant === "default" && "bg-primary/10 text-primary"
        )}>
          <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </div>
      </div>
      <div className="text-lg sm:text-2xl font-semibold tracking-tight truncate">{value}</div>
      {description && <p className="text-[11px] sm:text-xs text-muted-foreground mt-1 truncate">{description}</p>}
    </div>
  );
}
