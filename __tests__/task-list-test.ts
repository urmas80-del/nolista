import { moveItem, removeById, sortByPosition, upsertById } from '@/utils/task-list';

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

describe('ordering', () => {
  const list = [
    { id: 'a', position: 1024 },
    { id: 'b', position: 2048 },
    { id: 'c', position: 3072 },
  ];

  it('sorts by position, then id', () => {
    expect(sortByPosition([list[2], { id: 'x', position: 1024 }, list[0]]).map((t) => t.id)).toEqual([
      'a',
      'x',
      'c',
    ]);
  });

  it('moves down between neighbours, changing only that item', () => {
    const r = moveItem(list, 0, 1);
    expect(r.items.map((t) => t.id)).toEqual(['b', 'a', 'c']);
    expect(r.moved).toEqual({ id: 'a', position: 2560 });
    expect(r.renumber).toBe(false);
  });

  it('moves to the top and the bottom', () => {
    expect(moveItem(list, 2, 0).moved.position).toBe(0);
    expect(moveItem(list, 0, 2).moved.position).toBe(4096);
  });

  it('renumbers when there is no room left between neighbours', () => {
    const tight = [
      { id: 'a', position: 1 },
      { id: 'b', position: 1 + Number.EPSILON },
      { id: 'c', position: 5 },
    ];
    const r = moveItem(tight, 2, 1);
    expect(r.renumber).toBe(true);
    expect(r.items).toEqual([
      { id: 'a', position: 1024 },
      { id: 'c', position: 2048 },
      { id: 'b', position: 3072 },
    ]);
  });
});
