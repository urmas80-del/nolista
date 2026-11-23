// Due dates are stored as 'YYYY-MM-DD' (Postgres `date`) with no time zone.
// Everything here works in the phone's local time, never UTC, so an item due
// "today" doesn't flip to yesterday/tomorrow near midnight.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type DueStatus = 'overdue' | 'today' | 'soon' | 'later';

/** Local date -> 'YYYY-MM-DD'. */
export function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD' -> local midnight. */
export function fromDateString(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Whole days from today to the date (negative = past). */
export function daysUntil(value: string, today = new Date()): number {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // Round: a DST change makes some days 23 or 25 hours long.
  return Math.round((fromDateString(value).getTime() - start.getTime()) / 86_400_000);
}

export function dueStatus(value: string, today = new Date()): DueStatus {
  const days = daysUntil(value, today);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 2) return 'soon';
  return 'later';
}

/** "Today", "Tomorrow", "Yesterday", "Fri" (within a week), "Nov 28", or "Jan 3, 2028". */
export function dueLabel(value: string, today = new Date()): string {
  const days = daysUntil(value, today);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  const date = fromDateString(value);
  if (days > 1 && days < 7) return DAYS[date.getDay()];
  const short = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === today.getFullYear() ? short : `${short}, ${date.getFullYear()}`;
}
