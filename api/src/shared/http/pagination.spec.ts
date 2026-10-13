import {
  normalizeLimit,
  encodeCursor,
  decodeCursor,
  paginateItems,
} from './pagination';

describe('cursor pagination contract', () => {
  it('defaults to 50 and allows 1000', () => {
    expect(normalizeLimit(undefined)).toBe(50);
    expect(normalizeLimit('1000')).toBe(1000);
  });
  it.each([0, -1, 1001, 1.5, '', 'abc', '2x', ['2']])(
    'rejects invalid limit %p',
    (value) => {
      expect(() => normalizeLimit(value)).toThrow();
    },
  );
  it('rejects malformed cursors instead of restarting the list', () => {
    expect(() => decodeCursor('not-json')).toThrow();
    expect(decodeCursor()).toBeNull();
    expect(decodeCursor(encodeCursor({ id: 'a' }))).toEqual({ id: 'a' });
  });
  it('hides the extra record and only emits a cursor when there is more', () => {
    const page = paginateItems(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      2,
      (item) => item,
    );
    expect(page.data).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(page.pagination).toEqual({
      limit: 2,
      hasMore: true,
      nextCursor: encodeCursor({ id: 'b' }),
    });
    expect(paginateItems([], 2, (item) => item).pagination).toEqual({
      limit: 2,
      hasMore: false,
      nextCursor: null,
    });
  });
});
