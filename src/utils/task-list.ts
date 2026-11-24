/**
 * Pure helpers for merging task changes into a list.
 *
 * The same change can arrive twice (our own optimistic update, then the
 * Realtime echo), so both operations are idempotent.
 */

/** Replace the item with the same id, or append it if it's new. */
export function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some((existing) => existing.id === item.id)
    ? items.map((existing) => (existing.id === item.id ? item : existing))
    : [...items, item];
}

/** Remove the item with this id. Unknown ids leave the list unchanged. */
export function removeById<T extends { id: string }>(items: T[], id: string): T[] {
  return items.some((existing) => existing.id === id)
    ? items.filter((existing) => existing.id !== id)
    : items;
}

/** Gap between items when numbering a list from scratch. */
export const POSITION_STEP = 1024;

type Positioned = { id: string; position: number };

/** Manual order; ties (two people adding at once) fall back to id. */
export function sortByPosition<T extends Positioned>(items: T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Move the item at `from` to `to` and give it a position between its new
 * neighbours, so only that one row has to be saved.
 *
 * `renumber` is true when the neighbours are too close together to fit a
 * value between them (after very many moves to the same spot); the caller
 * then saves every item with fresh, evenly spaced positions.
 */
export function moveItem<T extends Positioned>(
  items: T[],
  from: number,
  to: number
): { items: T[]; moved: T; renumber: boolean } {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);

  const before = next[to - 1]?.position;
  const after = next[to + 1]?.position;
  let position: number;
  if (before === undefined && after === undefined) position = item.position;
  else if (before === undefined) position = after! - POSITION_STEP;
  else if (after === undefined) position = before + POSITION_STEP;
  else position = (before + after) / 2;

  const renumber = before !== undefined && after !== undefined && !(position > before && position < after);
  if (renumber) {
    const renumbered = next.map((t, i) => ({ ...t, position: (i + 1) * POSITION_STEP }));
    return { items: renumbered, moved: renumbered[to], renumber: true };
  }
  const moved = { ...item, position };
  next[to] = moved;
  return { items: next, moved, renumber: false };
}
