import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LucideIcon, Info, ArrowUp, ArrowDown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  variant?: "default" | "warning" | "success";
  /**
   * What the figure is. Assets and liabilities stay in ink — owning and owing
   * are not good or bad news by themselves, and colouring every card left the
   * one figure that needed attention looking like all the others. "negative"
   * is that figure: a shortfall, an overrun, a loss.
   */
  tone?: "asset" | "liability" | "negative";
  /**
   * How this figure is arrived at, shown on hover.
   *
   * A card that only states a number invites the question of where it came
   * from, and answering that meant reading the source. Cards carrying one get a
   * small marker so the explanation is discoverable rather than hidden.
   */
  formula?: ReactNode;
  /**
   * Change against a comparison period, as a fraction (0.12 = +12%), shown as
   * a coloured chip beside the description. Null hides it — there was nothing
   * to compare against.
   */
  delta?: number | null;
  /** Set when a rise is bad news (e.g. outstanding balances), flipping the colours. */
  deltaInverse?: boolean;
}

export function StatCard({ title, value, icon: Icon, description, variant = "default", tone, formula, delta, deltaInverse }: StatCardProps) {
  const hasDelta = delta != null && Number.isFinite(delta);
  // Under half a percent reads as "0%" — colour and arrow it as flat, not a rise.
  if (hasDelta && Math.abs(delta!) < 0.005) delta = 0;
  const good = hasDelta && (deltaInverse ? delta! < 0 : delta! > 0);
  const bad = hasDelta && (deltaInverse ? delta! > 0 : delta! < 0);
  const card = (
    <div className={cn("stat-card", formula && "cursor-help")}>
      <div className="flex items-center justify-between gap-2 mb-1.5 sm:mb-2">
        <span className="text-xs sm:text-[13px] font-medium text-muted-foreground leading-tight inline-flex items-center gap-1 min-w-0">
          <span className="truncate">{title}</span>
          {formula && <Info className="h-3 w-3 shrink-0 opacity-60" />}
        </span>
        <Icon
          className={cn(
            "hidden sm:block h-4 w-4 shrink-0 text-muted-foreground/70",
            variant === "warning" && "text-warning",
          )}
          strokeWidth={1.75}
          aria-hidden
        />
      </div>
      <div className={cn(
        "text-lg sm:text-2xl font-semibold tracking-tight tabular-nums truncate",
        tone === "negative" && "text-destructive",
      )}>{value}</div>
      {(description || hasDelta) && (
        <div className="mt-1 flex items-center gap-1.5 min-w-0">
          {hasDelta && (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[10px] sm:text-[11px] font-medium tabular-nums",
                good && "bg-success/10 text-success",
                bad && "bg-destructive/10 text-destructive",
                !good && !bad && "bg-muted text-muted-foreground",
              )}
            >
              {delta! > 0 ? <ArrowUp className="h-2.5 w-2.5" /> : delta! < 0 ? <ArrowDown className="h-2.5 w-2.5" /> : null}
              {Math.abs(delta! * 100) >= 1000 ? ">999" : Math.abs(delta! * 100).toFixed(0)}%
            </span>
          )}
          {description && <p className="text-[11px] sm:text-xs text-muted-foreground truncate">{description}</p>}
        </div>
      )}
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
