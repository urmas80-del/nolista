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
