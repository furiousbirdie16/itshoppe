import { describe, it, expect } from "vitest";
import { createScanGate } from "./scanning";

/** Feeds one reading repeatedly, a frame every 100ms, returning what it accepted. */
function hold(
  gate: (v: string | null, now: number) => string | null,
  value: string | null,
  frames: number,
  startAt = 0,
) {
  const out: string[] = [];
  for (let i = 0; i < frames; i++) {
    const got = gate(value, startAt + i * 100);
    if (got) out.push(got);
  }
  return out;
}

describe("createScanGate", () => {
  it("waits for a reading to hold steady before accepting it", () => {
    const gate = createScanGate();
    // Three frames is not yet enough to be sure of it.
    expect(hold(gate, "SN-12345678", 3)).toEqual([]);
    expect(hold(gate, "SN-12345678", 2, 300)).toEqual(["SN-12345678"]);
  });

  // The failure that prompted this: a code half in frame decodes short, and
  // firing on it recorded a serial missing its last characters.
  it("does not accept a partial reading that changes as the label arrives", () => {
    const gate = createScanGate();
    const accepted: string[] = [];
    for (const [i, v] of ["SN-123", "SN-1234", "SN-12345", "SN-123456"].entries()) {
      const got = gate(v, i * 100);
      if (got) accepted.push(got);
    }
    expect(accepted).toEqual([]);
    // Once the whole label is in view it settles and is taken, in full.
    expect(hold(gate, "SN-123456", 4, 400)).toEqual(["SN-123456"]);
  });

  it("accepts a label once, however long it sits in front of the lens", () => {
    const gate = createScanGate();
    expect(hold(gate, "SN-AAA", 20)).toEqual(["SN-AAA"]);
  });

  it("takes the next unit straight away", () => {
    const gate = createScanGate();
    hold(gate, "SN-AAA", 5);
    expect(hold(gate, "SN-BBB", 5, 1000)).toEqual(["SN-BBB"]);
  });

  // Holding the same unit up again on purpose has to work, so blank frames
  // clear the memory rather than making the operator wait out the cooldown.
  it("allows the same label again once it has left the view", () => {
    const gate = createScanGate();
    expect(hold(gate, "SN-AAA", 5)).toEqual(["SN-AAA"]);
    hold(gate, null, 6, 500);
    expect(hold(gate, "SN-AAA", 5, 1100)).toEqual(["SN-AAA"]);
  });

  it("ignores a re-read of the label still in view", () => {
    const gate = createScanGate();
    expect(hold(gate, "SN-AAA", 5)).toEqual(["SN-AAA"]);
    // Two blank frames is a flicker, not the label leaving.
    hold(gate, null, 2, 400);
    expect(hold(gate, "SN-AAA", 10, 600)).toEqual([]);
  });
});
