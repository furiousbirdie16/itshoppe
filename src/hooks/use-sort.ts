import { useState, useMemo } from "react";

export type SortDir = "asc" | "desc";

export interface SortState {
  key: string | null;
  dir: SortDir;
}

export type SortAccessors<T> = Record<string, (row: T) => any>;

export function useSort<T>(rows: T[], accessors: SortAccessors<T>, initial?: SortState) {
  const [sort, setSort] = useState<SortState>(initial ?? { key: null, dir: "asc" });

  const toggle = (key: string) => {
    setSort((s) => {
      if (s.key !== key) return { key, dir: "asc" };
      if (s.dir === "asc") return { key, dir: "desc" };
      return { key: null, dir: "asc" };
    });
  };

  const sorted = useMemo(() => {
    if (!sort.key || !accessors[sort.key]) return rows;
    const acc = accessors[sort.key];
    const copy = [...rows];
    // Direction is applied to the comparison rather than by reversing the
    // result, so blanks stay at the bottom both ways. Reversing sent them to
    // the top of a descending sort, burying the rows with real values.
    const flip = sort.dir === "desc" ? -1 : 1;
    copy.sort((a, b) => {
      const va = acc(a);
      const vb = acc(b);
      const aN = va == null || va === "";
      const bN = vb == null || vb === "";
      if (aN && bN) return 0;
      if (aN) return 1; // blanks last
      if (bN) return -1;
      if (typeof va === "number" && typeof vb === "number") return flip * (va - vb);
      const sa = String(va).toLowerCase();
      const sb = String(vb).toLowerCase();
      if (sa < sb) return -flip;
      if (sa > sb) return flip;
      return 0;
    });
    return copy;
  }, [rows, sort, accessors]);

  // setSort is exposed for pickers (e.g. the mobile sort dropdown) that need to
  // select a key/direction directly rather than cycle through toggle's states.
  return { sort, setSort, toggle, sorted };
}
