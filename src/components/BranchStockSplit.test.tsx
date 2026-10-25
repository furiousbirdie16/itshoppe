import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { BranchStockSplit } from "./BranchStockSplit";

describe("BranchStockSplit", () => {
  it("lists each branch holding the item", () => {
    const { container } = render(<BranchStockSplit split={[{ code: "GSN", qty: 10 }, { code: "MNL", qty: 10 }]} />);
    expect(container.textContent).toBe("GSN 10 · MNL 10");
  });
  it("says when it is all in one branch, and leaves out empty ones", () => {
    const { container } = render(<BranchStockSplit split={[{ code: "GSN", qty: 0 }, { code: "MNL", qty: 12 }]} />);
    expect(container.textContent).toBe("all in MNL");
  });
  it("shows nothing when no branch has any", () => {
    const { container } = render(<BranchStockSplit split={[{ code: "GSN", qty: 0 }]} />);
    expect(container.textContent).toBe("");
  });
});
