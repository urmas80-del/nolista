export const MAX_NAME_LENGTH = 40;

/** What to call someone: their display name, else the part of the email before the @. */
export function personName(person: { display_name?: string | null; email?: string | null }): string {
  const name = person.display_name?.trim();
  if (name) return name;
  const email = person.email?.trim();
  if (email) return email.split('@')[0];
  return 'Someone';
}

/**
 * "Shared with Juliet, Itay +2" for the other people on a board.
 * Returns null for a board only you use.
 */
export function sharedWithLabel(names: readonly string[] | null | undefined, shown = 2): string | null {
  const list = (names ?? []).filter((n) => n && n.trim());
  if (list.length === 0) return null;
  const head = list.slice(0, shown).join(', ');
  const rest = list.length - shown;
  return rest > 0 ? `Shared with ${head} +${rest}` : `Shared with ${head}`;
}

/** Trimmed name if it's valid, otherwise null. */
export function cleanName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return null;
  return name;
}
