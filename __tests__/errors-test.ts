import { friendlyError } from '@/utils/errors';

describe('friendlyError', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows messages raised by our own database code as-is', () => {
    const message = 'Custom boards are part of Nolista Premium.';
    expect(friendlyError({ code: 'P0001', message })).toBe(message);
  });

  it('does not log our own raised messages', () => {
    friendlyError({ code: 'P0001', message: 'You can have up to 5 people in your sharing circle.' });
    expect(console.log).not.toHaveBeenCalled();
  });

  it('explains a duplicate invite', () => {
    expect(
      friendlyError({ code: '23505', message: 'duplicate key value violates unique constraint' }, 'invite')
    ).toBe('That person already has a pending invite to this board.');
  });

  it('explains an RLS rejection on an invite', () => {
    expect(
      friendlyError({ code: '42501', message: 'new row violates row-level security policy' }, 'invite')
    ).toMatch(/Only the board's owner can invite/);
  });

  it('gives a generic permission message outside invites', () => {
    expect(friendlyError({ code: '42501', message: 'permission denied for table tasks' })).toBe(
      "You don't have permission to do that."
    );
  });

  it('never shows raw database text for unknown errors, but logs it', () => {
    const raw = 'relation "public.secret_table" does not exist';
    const result = friendlyError({ code: '42P01', message: raw });
    expect(result).toBe('Something went wrong. Please try again.');
    expect(result).not.toContain('secret_table');
    expect(console.log).toHaveBeenCalledWith('Supabase error:', '42P01', raw);
  });

  it('handles errors without a code (e.g. network failures)', () => {
    expect(friendlyError({ message: 'TypeError: Network request failed' })).toBe(
      'Something went wrong. Please try again.'
    );
  });
});
