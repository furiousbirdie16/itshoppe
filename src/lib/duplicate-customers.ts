/**
 * Spotting a customer who is already on file.
 *
 * Nothing stops two customers having the same name, and the same buyer does
 * get entered twice — once hurriedly, once properly — which splits their
 * orders and their lifetime total across two rows. Cleaning that up afterwards
 * means merging; warning at the point of typing avoids it.
 */

/** A name reduced to what matters for comparing two of them. */
export function normalizeCustomerName(name: string): string {
  return (name || "")
    .toLowerCase()
    // Corp./Corp, "Bros," — punctuation is noise between two spellings.
    .replace(/[.,''`"()\-_/&+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type DuplicateMatch<T> = {
  customer: T;
  /** Same name bar case and punctuation, versus merely overlapping. */
  kind: "same" | "similar";
};

/**
 * Customers whose name looks like the one being typed.
 *
 * "Same" is an exact match once case and punctuation are set aside — that is
 * the NRC builders case. "Similar" is one name containing the other, which
 * catches "NRC" against "NRC Builders"; it needs four characters, so a short
 * name does not flag half the list.
 */
export function findDuplicateCustomers<T extends { id: string; name: string }>(
  name: string,
  customers: T[],
  excludeId?: string,
): DuplicateMatch<T>[] {
  const needle = normalizeCustomerName(name);
  if (needle.length < 2) return [];

  const out: DuplicateMatch<T>[] = [];
  for (const c of customers) {
    if (excludeId && c.id === excludeId) continue;
    const other = normalizeCustomerName(c.name);
    if (!other) continue;
    if (other === needle) out.push({ customer: c, kind: "same" });
    else if (
      needle.length >= 4 &&
      other.length >= 4 &&
      (other.includes(needle) || needle.includes(other))
    ) {
      out.push({ customer: c, kind: "similar" });
    }
  }

  // Exact matches are the ones worth reading first.
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "same" ? -1 : 1));
}
