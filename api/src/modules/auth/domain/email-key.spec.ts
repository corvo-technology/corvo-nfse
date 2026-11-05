import { normalizeEmailKey } from './email-key';

describe('normalizeEmailKey', () => {
  it.each([
    ['Owner@Example.com', 'owner@example.com'],
    ['a+1@x.com', 'a@x.com'],
    ['a+promo+2@x.com', 'a@x.com'],
    ['a.b@corp.com', 'a.b@corp.com'],
    ['a.b+tag@corp.com', 'a.b@corp.com'],
    ['a.b@gmail.com', 'ab@gmail.com'],
    ['A.B+x@Googlemail.com', 'ab@gmail.com'],
    ['  spaced@x.com ', 'spaced@x.com'],
  ])('maps %s to %s', (input, expected) => {
    expect(normalizeEmailKey(input)).toBe(expected);
  });
  it('treats a+1@x.com and a@x.com as the same person', () => {
    expect(normalizeEmailKey('a+1@x.com')).toBe(normalizeEmailKey('a@x.com'));
  });
});
