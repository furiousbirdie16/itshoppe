import { describe, it, expect } from "vitest";
import { moveItem } from "./reorder";

describe("moveItem", () => {
  it("moves an entry later", () => {
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("moves an entry earlier", () => {
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
  });

  // The buttons sit at the ends of a list, so pressing up on the first row has
  // to be harmless rather than an error or a wrap-around.
  it("leaves the list alone when the move runs off either end", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 2, 3)).toBe(list);
    expect(moveItem(list, 1, 1)).toBe(list);
  });

  it("does not mutate the original", () => {
    const list = ["a", "b", "c"];
    moveItem(list, 0, 2);
    expect(list).toEqual(["a", "b", "c"]);
  });
});
