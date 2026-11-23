import { daysUntil, fromDateString } from '@/utils/due-dates';

export type DueItem = { title: string; due_date: string; board_id: string; board_name: string };

export type PlannedReminder = {
  date: Date;
  title: string;
  body: string;
  /** Set when every item is on one board, so tapping opens it. */
  boardId: string | null;
};

/**
 * One notification per day that has open items due, at the chosen time:
 *   "Due today: Milk"            body "Market"
 *   "3 items due today"          body "Market: Milk, Eggs · Together: Fix sink"
 * Times already past are skipped. iOS keeps at most 64 scheduled
 * notifications per app, so only the next `maxDays` days are planned.
 */
export function planReminders(
  items: readonly DueItem[],
  options: { hour: number; minute: number; now?: Date; maxDays?: number }
): PlannedReminder[] {
  const { hour, minute, now = new Date(), maxDays = 60 } = options;

  const byDay = new Map<string, DueItem[]>();
  for (const item of items) {
    const days = daysUntil(item.due_date, now);
    if (days < 0 || days > maxDays) continue;
    byDay.set(item.due_date, [...(byDay.get(item.due_date) ?? []), item]);
  }

  const plans: PlannedReminder[] = [];
  for (const [day, dayItems] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const date = fromDateString(day);
    date.setHours(hour, minute, 0, 0);
    if (date.getTime() <= now.getTime()) continue;

    const boards = new Map<string, { name: string; titles: string[] }>();
    for (const item of dayItems) {
      const entry = boards.get(item.board_id) ?? { name: item.board_name, titles: [] };
      entry.titles.push(item.title);
      boards.set(item.board_id, entry);
    }

    const title =
      dayItems.length === 1 ? `Due today: ${dayItems[0].title}` : `${dayItems.length} items due today`;
    const body =
      dayItems.length === 1
        ? dayItems[0].board_name
        : [...boards.values()].map((b) => `${b.name}: ${b.titles.join(', ')}`).join(' · ');

    plans.push({
      date,
      title,
      body: body.length > 180 ? `${body.slice(0, 177)}…` : body,
      boardId: boards.size === 1 ? dayItems[0].board_id : null,
    });
  }
  return plans;
}
