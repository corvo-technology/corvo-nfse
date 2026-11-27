import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import { AuthorityNotConfiguredError, ENDPOINTS_65 } from './endpoints';
import { NFCE_URLS, nfceUrlsFor } from './nfce-urls';
import { UF_TABLE } from './uf';

const ufsOf65 = (): Array<{ uf: Uf; tpAmb: 1 | 2 }> => {
  const found: Array<{ uf: Uf; tpAmb: 1 | 2 }> = [];
  for (const row of ENDPOINTS_65)
    for (const [uf, info] of Object.entries(UF_TABLE) as Array<
      [Uf, (typeof UF_TABLE)[Uf]]
    >)
      if (
        info.authorizer65 === row.authority &&
        !found.some((f) => f.uf === uf && f.tpAmb === row.tpAmb)
      )
        found.push({ uf, tpAmb: row.tpAmb });
  return found;
};

describe('NFC-e URLs per UF', () => {
  it('SP has its two URLs in both environments', () => {
    expect(nfceUrlsFor('SP', 2).qrCode).toBe(
      'https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode',
    );
    expect(nfceUrlsFor('SP', 1).qrCode).toBe(
      'https://www.nfce.fazenda.sp.gov.br/qrcode',
    );
  });

  it('every UF with a model 65 endpoint has the two URLs', () => {
    const wanted = ufsOf65();
    expect(wanted.length).toBeGreaterThan(0);
    for (const { uf, tpAmb } of wanted)
      expect(() => nfceUrlsFor(uf, tpAmb)).not.toThrow();
  });

  it('urlChave fits the XSD (21 to 85) and every host is a .gov.br https', () => {
    for (const byEnv of Object.values(NFCE_URLS))
      for (const urls of Object.values(byEnv)) {
        expect(urls.urlChave.length).toBeGreaterThanOrEqual(21);
        expect(urls.urlChave.length).toBeLessThanOrEqual(85);
        for (const text of [urls.qrCode, urls.urlChave]) {
          const url = new URL(text);
          expect(url.protocol).toBe('https:');
          expect(url.hostname.endsWith('.gov.br')).toBe(true);
          expect(text.includes('?')).toBe(false);
        }
      }
  });

  it('a UF without a line fails', () => {
    expect(() => nfceUrlsFor('AC', 2)).toThrow(AuthorityNotConfiguredError);
  });
});
