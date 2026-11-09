import { describe, it, expect } from "vitest";
import { formatShortageMessage } from "./stockCheck";

describe("formatShortageMessage", () => {
  it("speaks in metres for a cut item and shows the rolls behind it", () => {
    const msg = formatShortageMessage([{
      itemId: "x", name: "CAT6 Pure Copper Indoor roll",
      available: -1194, needed: 10, shortBy: 1204, unit: "m",
      rolls: { whole: -4, open: 26 },
    }]);
    expect(msg).toBe("• CAT6 Pure Copper Indoor roll: store has -1194 m (-4 rolls + 26 m open), need 10 m (short by 1204 m)");
  });

  it("leaves whole-unit items as they were", () => {
    const msg = formatShortageMessage([{ itemId: "y", name: "RJ45", available: 2, needed: 5, shortBy: 3, unit: "pcs" }]);
    expect(msg).toBe("• RJ45: store has 2 pcs, need 5 pcs (short by 3 pcs)");
  });
});
