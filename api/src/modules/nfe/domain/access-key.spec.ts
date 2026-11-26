import {
  AccessKeyError,
  accessKeyDv,
  buildAccessKey,
  randomCnf,
} from './access-key';

/**
 * Known keys:
 *  - the first two come from the sample NF-e `fake/nfe.xml` of nfephp-org/sped-nfe (master,
 *    2026-11-23);
 *  - the third is the MOC example for the DV calculation (CNPJ 99999090910270).
 */
const KNOWN = [
  '35210452567322000119550010000000224922299865',
  '35210458716523000119550010000000221922299869',
  '35080599999090910270550010000000015180051273',
];

describe('accessKeyDv', () => {
  it.each(KNOWN)('matches the published DV of %s', (key) => {
    expect(accessKeyDv(key.slice(0, 43))).toBe(Number(key[43]));
  });

  it('gives DV 0 when the remainder is 0 or 1 and 11 - remainder otherwise', () => {
    const zeros = '0'.repeat(42);
    expect(accessKeyDv(`${zeros}0`)).toBe(0); // sum 0 -> remainder 0
    expect(accessKeyDv(`${zeros}6`)).toBe(0); // 6*2 = 12 -> remainder 1
    expect(accessKeyDv(`${zeros}5`)).toBe(1); // 5*2 = 10 -> remainder 10
    expect(accessKeyDv(`${zeros}1`)).toBe(9); // 1*2 = 2 -> remainder 2
  });

  it('rejects anything that is not 43 characters of [0-9A-Z]', () => {
    expect(() => accessKeyDv('123')).toThrow(AccessKeyError);
    expect(() => accessKeyDv('a'.repeat(43))).toThrow(AccessKeyError);
  });
});

describe('buildAccessKey', () => {
  const base = {
    cUF: '35',
    issuedAt: '2021-04-10T09:00:00-03:00',
    cnpj: '58716523000119',
    model: 55 as const,
    series: 1,
    number: 22,
    tpEmis: 1 as const,
    cNF: '92229986',
  };

  it('rebuilds a published key from its parts', () => {
    expect(buildAccessKey(base)).toBe(KNOWN[1]);
  });

  it('has 44 characters', () => {
    expect(buildAccessKey(base)).toHaveLength(44);
  });

  it('takes AAMM from the dhEmi text (UF civil time), not from UTC', () => {
    // 23:30 on 30/11 in Manaus is already 01/12 in UTC.
    const key = buildAccessKey({
      ...base,
      cUF: '13',
      issuedAt: '2026-11-30T23:30:00-04:00',
    });
    expect(key.slice(2, 6)).toBe('2611');
  });

  it('accepts an alphanumeric CNPJ and computes the DV with ASCII-48 values', () => {
    // [verificar no spike] the DV rule for letters is unconfirmed by the SEFAZ.
    const key = buildAccessKey({ ...base, cnpj: '12ABC34501DE35' });
    expect(key).toHaveLength(44);
    expect(key.slice(6, 20)).toBe('12ABC34501DE35');
    // Independent hand check of the weights for the first 43 characters.
    const first43 = key.slice(0, 43);
    let sum = 0;
    let weight = 2;
    for (const ch of [...first43].reverse()) {
      sum += (ch.charCodeAt(0) - 48) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    const expected = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    expect(Number(key[43])).toBe(expected);
  });

  it('rejects malformed parts', () => {
    expect(() => buildAccessKey({ ...base, cnpj: '123' })).toThrow(
      AccessKeyError,
    );
    expect(() => buildAccessKey({ ...base, cNF: '1' })).toThrow(AccessKeyError);
    expect(() => buildAccessKey({ ...base, number: 1_000_000_000 })).toThrow(
      AccessKeyError,
    );
    expect(() => buildAccessKey({ ...base, issuedAt: 'yesterday' })).toThrow(
      AccessKeyError,
    );
  });
});

describe('randomCnf', () => {
  it('never returns the nNF', () => {
    const values = [12345678, 1];
    const rnd = () => values.shift() as number;
    expect(randomCnf(12345678, rnd)).toBe('00000001');
  });

  it('skips lazy patterns', () => {
    const values = [11111111, 12345678, 42];
    expect(randomCnf(7, () => values.shift() as number)).toBe('00000042');
  });

  it('returns 8 digits and uses the injected source with the 1e8 bound', () => {
    const max: number[] = [];
    const cNF = randomCnf(1, (m) => {
      max.push(m);
      return 4242;
    });
    expect(cNF).toBe('00004242');
    expect(max).toEqual([100_000_000]);
  });

  it('works with the real CSPRNG', () => {
    for (let i = 0; i < 50; i++) expect(randomCnf(99)).toMatch(/^\d{8}$/);
  });
});
