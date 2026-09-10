import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Wallet } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StatCard, FormulaRow } from "./StatCard";

const renderCard = (props: Partial<React.ComponentProps<typeof StatCard>> = {}) =>
  render(
    <TooltipProvider>
      <StatCard title="Cash" value="₱100" icon={Wallet} {...props} />
    </TooltipProvider>,
  );

describe("StatCard", () => {
  it("shows how the figure is worked out when hovered", async () => {
    const { container } = renderCard({ formula: <FormulaRow label="Bank accounts" value="₱100" /> });
    expect(screen.queryByText("Bank accounts")).not.toBeInTheDocument();
    // Radix opens a tooltip on pointermove from a mouse, not on pointerenter.
    fireEvent.pointerMove(container.querySelector(".cursor-help")!, { pointerType: "mouse" });
    expect(await screen.findAllByText("Bank accounts")).not.toHaveLength(0);
  });

  // A card with nothing to explain must not grow a marker or a hover target.
  it("stays a plain card when no formula is given", () => {
    const { container } = renderCard();
    expect(container.querySelector("svg.lucide-info")).toBeNull();
    expect(container.querySelector(".cursor-help")).toBeNull();
  });
});
