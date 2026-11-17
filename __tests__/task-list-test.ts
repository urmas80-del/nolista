import { removeById, upsertById } from '@/utils/task-list';

type Item = { id: string; title: string; is_done: boolean };

const milk: Item = { id: 'a', title: 'Milk', is_done: false };
const bread: Item = { id: 'b', title: 'Bread', is_done: false };

describe('upsertById', () => {
  it('appends a new item at the end', () => {
    expect(upsertById([milk], bread)).toEqual([milk, bread]);
  });

  it('replaces an existing item in place, keeping order', () => {
    const doneMilk = { ...milk, is_done: true };
    expect(upsertById([milk, bread], doneMilk)).toEqual([doneMilk, bread]);
  });

  it('is idempotent: a Realtime echo of our own insert does not duplicate it', () => {
    const once = upsertById([milk], bread);
    const twice = upsertById(once, bread);
    expect(twice).toEqual([milk, bread]);
  });

  it('does not mutate the input list', () => {
    const list = [milk];
    upsertById(list, bread);
    expect(list).toEqual([milk]);
  });
});

describe('removeById', () => {
  it('removes the matching item', () => {
    expect(removeById([milk, bread], 'a')).toEqual([bread]);
  });

  it('returns the same list for an unknown id (deletes from other boards)', () => {
    const list = [milk, bread];
    expect(removeById(list, 'not-on-this-board')).toBe(list);
  });

  it('is idempotent: removing twice is the same as once', () => {
    expect(removeById(removeById([milk, bread], 'a'), 'a')).toEqual([bread]);
  });
});
