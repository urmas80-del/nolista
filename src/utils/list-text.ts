import { dueLabel } from '@/utils/due-dates';

const BOARD_EMOJI: Record<string, string> = {
  market: '🛒',
  together: '🏡',
  focus: '🎯',
  custom: '📝',
};

/**
 * A board as plain text for WhatsApp, SMS or notes:
 *
 *   🛒 *Market*
 *   ▫️ Milk
 *   ▫️ Eggs
 *
 *   Done:
 *   ✅ Bread
 *
 * *…* renders bold in WhatsApp; other apps show the asterisks.
 */
export function listAsText(
  board: { name: string; type: string },
  tasks: readonly { title: string; is_done: boolean; due_date?: string | null }[],
  options: { includeDone?: boolean; today?: Date } = {}
): string {
  const { includeDone = true, today = new Date() } = options;
  const open = tasks.filter((t) => !t.is_done);
  const done = tasks.filter((t) => t.is_done);

  const lines = [`${BOARD_EMOJI[board.type] ?? BOARD_EMOJI.custom} *${board.name}*`];
  if (open.length === 0) lines.push('All done!');
  else
    lines.push(
      ...open.map((t) => `▫️ ${t.title}${t.due_date ? ` · ${dueLabel(t.due_date, today)}` : ''}`)
    );

  if (includeDone && done.length > 0) {
    lines.push('', 'Done:', ...done.map((t) => `✅ ${t.title}`));
  }
  return lines.join('\n');
}
