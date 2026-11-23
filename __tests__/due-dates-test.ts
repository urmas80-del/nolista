import { daysUntil, dueLabel, dueStatus, fromDateString, toDateString } from '@/utils/due-dates';

// Thursday 20 Nov 2026, late evening (local time) to catch UTC slips.
const today = new Date(2026, 10, 20, 23, 30);

describe('toDateString / fromDateString', () => {
  it('round-trips in local time', () => {
    expect(toDateString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(toDateString(fromDateString('2026-12-31'))).toBe('2026-12-31');
  });
});

describe('daysUntil', () => {
  it('counts whole days from today', () => {
    expect(daysUntil('2026-11-20', today)).toBe(0);
    expect(daysUntil('2026-11-21', today)).toBe(1);
    expect(daysUntil('2026-11-18', today)).toBe(-2);
  });
  it('is not thrown off by month and year ends', () => {
    expect(daysUntil('2027-01-01', new Date(2026, 11, 31))).toBe(1);
  });
});

describe('dueStatus', () => {
  it('classifies dates', () => {
    expect(dueStatus('2026-11-19', today)).toBe('overdue');
    expect(dueStatus('2026-11-20', today)).toBe('today');
    expect(dueStatus('2026-11-22', today)).toBe('soon');
    expect(dueStatus('2026-11-30', today)).toBe('later');
  });
});

describe('dueLabel', () => {
  it('uses words for nearby days', () => {
    expect(dueLabel('2026-11-20', today)).toBe('Today');
    expect(dueLabel('2026-11-21', today)).toBe('Tomorrow');
    expect(dueLabel('2026-11-19', today)).toBe('Yesterday');
  });
  it('uses the weekday within a week', () => {
    expect(dueLabel('2026-11-23', today)).toBe('Mon');
  });
  it('uses the date further out, with the year if different', () => {
    expect(dueLabel('2026-11-28', today)).toBe('Nov 28');
    expect(dueLabel('2026-11-10', today)).toBe('Nov 10');
    expect(dueLabel('2027-01-03', today)).toBe('Jan 3, 2027');
  });
});
