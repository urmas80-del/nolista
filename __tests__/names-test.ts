import { cleanName, personName, sharedWithLabel } from '@/utils/names';

describe('personName', () => {
  it('prefers the display name', () => {
    expect(personName({ display_name: ' Juliet ', email: 'j@x.com' })).toBe('Juliet');
  });
  it('falls back to the email before the @', () => {
    expect(personName({ display_name: '', email: 'itay.k@x.com' })).toBe('itay.k');
  });
  it('has a last-resort label', () => {
    expect(personName({})).toBe('Someone');
  });
});

describe('sharedWithLabel', () => {
  it('is null when nobody else is on the board', () => {
    expect(sharedWithLabel([])).toBeNull();
    expect(sharedWithLabel(null)).toBeNull();
  });
  it('lists one or two people', () => {
    expect(sharedWithLabel(['Juliet'])).toBe('Shared with Juliet');
    expect(sharedWithLabel(['Juliet', 'Itay'])).toBe('Shared with Juliet, Itay');
  });
  it('counts the rest', () => {
    expect(sharedWithLabel(['Juliet', 'Itay', 'Noa', 'Dan'])).toBe('Shared with Juliet, Itay +2');
  });
});

describe('cleanName', () => {
  it('trims and collapses spaces', () => {
    expect(cleanName('  Uri   R  ')).toBe('Uri R');
  });
  it('rejects empty and too-long names', () => {
    expect(cleanName('   ')).toBeNull();
    expect(cleanName('x'.repeat(41))).toBeNull();
  });
});
