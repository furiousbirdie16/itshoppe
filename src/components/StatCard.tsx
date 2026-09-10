import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LucideIcon, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  variant?: "default" | "warning" | "success";
  /** Colours the figure: green for what we own, red for what we owe. */
  tone?: "asset" | "liability";
  /**
   * How this figure is arrived at, shown on hover.
   *
   * A card that only states a number invites the question of where it came
   * from, and answering that meant reading the source. Cards carrying one get a
   * small marker so the explanation is discoverable rather than hidden.
   */
  formula?: ReactNode;
}

export function StatCard({ title, value, icon: Icon, description, variant = "default", tone, formula }: StatCardProps) {
  const card = (
    <div className={cn("stat-card", formula && "cursor-help")}>
      <div className="flex items-center justify-between gap-2 mb-2 sm:mb-3">
        <span className="text-[10px] sm:text-xs font-medium uppercase tracking-wider text-muted-foreground leading-tight inline-flex items-center gap-1 min-w-0">
          <span className="truncate">{title}</span>
          {formula && <Info className="h-3 w-3 shrink-0 opacity-50" />}
        </span>
        <div className={cn(
          "h-7 w-7 sm:h-8 sm:w-8 rounded-lg flex items-center justify-center shrink-0",
          variant === "warning" && "bg-warning/10 text-warning",
          variant === "success" && "bg-success/10 text-success",
          variant === "default" && "bg-primary/10 text-primary"
        )}>
          <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </div>
      </div>
      <div className={cn(
        "text-lg sm:text-2xl font-semibold tracking-tight truncate",
        tone === "asset" && "text-emerald-600 dark:text-emerald-500",
        tone === "liability" && "text-red-600 dark:text-red-500",
      )}>{value}</div>
      {description && <p className="text-[11px] sm:text-xs text-muted-foreground mt-1 truncate">{description}</p>}
    </div>
  );

  if (!formula) return card;

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>{card}</TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        collisionPadding={12}
        className="max-w-[min(22rem,calc(100vw-1.5rem))] whitespace-normal text-xs leading-relaxed"
      >
        {formula}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * A line inside a card's explanation: a label on the left, its figure on the
 * right. Kept here so every card's breakdown lines up the same way.
 */
export function FormulaRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-6", muted && "text-muted-foreground")}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
