/**
 * Move one entry of a list to another position, returning a new list.
 *
 * Out-of-range moves return the list unchanged rather than throwing: the
 * callers are arrow buttons at the ends of a list, and "nothing happens" is the
 * right answer for pressing up on the first row.
 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list;
  if (from < 0 || from >= list.length) return list;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
