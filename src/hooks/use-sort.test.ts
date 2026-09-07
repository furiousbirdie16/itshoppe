import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSort } from "./use-sort";

interface Row { name: string; eta: number | null }

const rows: Row[] = [
  { name: "b", eta: 200 },
  { name: "none", eta: null },
  { name: "a", eta: 100 },
];
const accessors = { eta: (r: Row) => r.eta, name: (r: Row) => r.name };

const namesFor = (dir: "asc" | "desc") =>
  renderHook(() => useSort<Row>(rows, accessors, { key: "eta", dir }))
    .result.current.sorted.map((r) => r.name);

describe("useSort", () => {
  it("sorts ascending with blanks at the bottom", () => {
    expect(namesFor("asc")).toEqual(["a", "b", "none"]);
  });

  // Descending used to reverse the sorted array, which floated every blank to
  // the top and pushed the rows that actually had a date out of sight.
  it("keeps blanks at the bottom when descending too", () => {
    expect(namesFor("desc")).toEqual(["b", "a", "none"]);
  });

  it("leaves rows untouched when no key is set", () => {
    const { result } = renderHook(() => useSort<Row>(rows, accessors));
    expect(result.current.sorted.map((r) => r.name)).toEqual(["b", "none", "a"]);
  });
});
