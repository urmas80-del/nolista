import { planReminders, type DueItem } from '@/utils/reminder-plan';

// Thursday 20 Nov 2026, 10:00 local.
const now = new Date(2026, 10, 20, 10, 0);
const item = (title: string, due_date: string, board = 'm', board_name = 'Market'): DueItem => ({
  title,
  due_date,
  board_id: board,
  board_name,
});

describe('planReminders', () => {
  it('makes one reminder per day at the chosen time', () => {
    const plans = planReminders([item('Milk', '2026-11-21'), item('Eggs', '2026-11-21')], {
      hour: 9,
      minute: 30,
      now,
    });
    expect(plans).toHaveLength(1);
    expect(plans[0].date).toEqual(new Date(2026, 10, 21, 9, 30));
    expect(plans[0].title).toBe('2 items due today');
    expect(plans[0].body).toBe('Market: Milk, Eggs');
    expect(plans[0].boardId).toBe('m');
  });

  it('names a single item and its board', () => {
    const [plan] = planReminders([item('Fix sink', '2026-11-22', 't', 'Together')], { hour: 9, minute: 0, now });
    expect(plan.title).toBe('Due today: Fix sink');
    expect(plan.body).toBe('Together');
  });

  it('groups several boards and does not pick one to open', () => {
    const [plan] = planReminders(
      [item('Milk', '2026-11-21'), item('Fix sink', '2026-11-21', 't', 'Together')],
      { hour: 9, minute: 0, now }
    );
    expect(plan.body).toBe('Market: Milk · Together: Fix sink');
    expect(plan.boardId).toBeNull();
  });

  it('skips past times, overdue items and days too far out, in date order', () => {
    const plans = planReminders(
      [
        item('Later', '2026-11-25'),
        item('Today, already 10:00', '2026-11-20'),
        item('Overdue', '2026-11-18'),
        item('Far', '2027-06-01'),
        item('Soon', '2026-11-21'),
      ],
      { hour: 9, minute: 0, now }
    );
    expect(plans.map((p) => p.title)).toEqual(['Due today: Soon', 'Due today: Later']);
  });

  it('keeps today when the time is still ahead', () => {
    expect(planReminders([item('Milk', '2026-11-20')], { hour: 18, minute: 0, now })).toHaveLength(1);
  });
});
