import { describe, it, expect } from "vitest";
import { ordersMissingSerials, nextLineNeedingSerial, serialProgress, serialsNeeded } from "./online-serials";

const tracked = { track_serials: true };
const line = (id: string, order_number: string, quantity: number, extra: Record<string, unknown> = {}) => ({
  id, order_number, quantity, status: "completed", created_at: "2026-11-05T02:00:00Z", items: tracked, ...extra,
});

describe("online serials", () => {
  it("needs nothing for a product that does not track serials, or a cancelled line", () => {
    expect(serialsNeeded(line("a", "1", 2, { items: { track_serials: false } }))).toBe(0);
    expect(serialsNeeded(line("a", "1", 2, { status: "cancelled" }))).toBe(0);
    expect(serialsNeeded(line("a", "1", 2, { items: null }))).toBe(0);
    expect(serialsNeeded(line("a", "1", 2))).toBe(2);
  });

  it("counts what is missing per order, ignoring orders recorded before the feature", () => {
    const lines = [
      line("a", "ORD1", 2),
      line("b", "ORD1", 1),
      line("c", "ORD2", 1),
      line("d", "OLD", 3, { created_at: "2026-10-01T00:00:00Z" }),
    ];
    expect(ordersMissingSerials(lines, { a: 1, c: 1 })).toEqual({ ORD1: 2 });
  });

  it("does not let extra serials on one line cover another", () => {
    const lines = [line("a", "ORD1", 1), line("b", "ORD1", 1)];
    expect(serialProgress(lines, { a: 2 })).toEqual({ recorded: 1, needed: 2 });
    expect(ordersMissingSerials(lines, { a: 2 })).toEqual({ ORD1: 1 });
  });

  it("sends the next scan to the first line still short, and to nothing when complete", () => {
    const lines = [line("a", "ORD1", 1), line("x", "ORD1", 5, { items: { track_serials: false } }), line("b", "ORD1", 2)];
    expect(nextLineNeedingSerial(lines, {})?.id).toBe("a");
    expect(nextLineNeedingSerial(lines, { a: 1 })?.id).toBe("b");
    expect(nextLineNeedingSerial(lines, { a: 1, b: 1 })?.id).toBe("b");
    expect(nextLineNeedingSerial(lines, { a: 1, b: 2 })).toBeNull();
  });
});
