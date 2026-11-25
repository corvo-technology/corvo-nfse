import { sanitizeAuditMetadata } from './sanitize-audit-metadata';

describe('sanitizeAuditMetadata', () => {
  it('drops secret-looking keys and keeps safe primitives', () =>
    expect(
      sanitizeAuditMetadata({
        password: 'x',
        pfx_base64: 'y',
        apiKey: 'k',
        token: 't',
        certificate_file: 'f',
        units: 50,
        method: 'pix',
      }),
    ).toEqual({ units: 50, method: 'pix' }));

  it('drops objects and arrays, keeps null and booleans', () =>
    expect(
      sanitizeAuditMetadata({
        nested: { a: 1 },
        list: [1],
        replaced: true,
        number: null,
      }),
    ).toEqual({ replaced: true, number: null }));

  it('cuts strings to 200 characters and keeps at most 20 keys', () => {
    expect(
      (sanitizeAuditMetadata({ a: 'a'.repeat(500) }).a as string).length,
    ).toBe(200);
    const many = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`k${i}`, i]),
    );
    expect(Object.keys(sanitizeAuditMetadata(many))).toHaveLength(20);
  });

  it('returns an empty object for non-objects and non-finite numbers', () => {
    expect(sanitizeAuditMetadata(undefined)).toEqual({});
    expect(sanitizeAuditMetadata('x')).toEqual({});
    expect(sanitizeAuditMetadata([1])).toEqual({});
    expect(sanitizeAuditMetadata({ n: Infinity })).toEqual({});
  });
});
