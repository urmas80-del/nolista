import { sortBoards } from '@/constants/boards';

describe('sortBoards', () => {
  const me = 'me';
  it('puts built-in boards first, own before shared, then keeps order', () => {
    const boards = [
      { id: 'c1', type: 'custom', owner_id: me },
      { id: 'mShared', type: 'market', owner_id: 'juliet' },
      { id: 'focus', type: 'focus', owner_id: me },
      { id: 'together', type: 'together', owner_id: me },
      { id: 'mMine', type: 'market', owner_id: me },
      { id: 'c2', type: 'custom', owner_id: me },
    ];
    expect(sortBoards(boards, me).map((b) => b.id)).toEqual([
      'mMine',
      'mShared',
      'together',
      'focus',
      'c1',
      'c2',
    ]);
  });
});
