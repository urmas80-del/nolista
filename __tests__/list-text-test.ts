import { listAsText } from '@/utils/list-text';

const board = { name: 'Market', type: 'market' };

describe('listAsText', () => {
  it('lists open items, then done ones', () => {
    const text = listAsText(board, [
      { title: 'Milk', is_done: false },
      { title: 'Bread', is_done: true },
      { title: 'Eggs', is_done: false },
    ]);
    expect(text).toBe('🛒 *Market*\n▫️ Milk\n▫️ Eggs\n\nDone:\n✅ Bread');
  });

  it('can leave done items out', () => {
    const text = listAsText(board, [{ title: 'Bread', is_done: true }], { includeDone: false });
    expect(text).toBe('🛒 *Market*\nAll done!');
  });

  it('adds due dates to open items', () => {
    const text = listAsText(board, [{ title: 'Milk', is_done: false, due_date: '2026-11-21' }], {
      today: new Date(2026, 10, 20),
    });
    expect(text).toBe('🛒 *Market*\n▫️ Milk · Tomorrow');
  });

  it('uses a generic emoji for unknown types', () => {
    expect(listAsText({ name: 'Trip', type: 'other' }, [])).toBe('📝 *Trip*\nAll done!');
  });
});
