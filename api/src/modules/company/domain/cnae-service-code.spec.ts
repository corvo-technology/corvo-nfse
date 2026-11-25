import { loadCtribnacCatalogFile } from '@/modules/invoice/infra/fiscal/ctribnac-catalog.provider';
import { CNAE_SERVICE_CODES, suggestServiceCode } from './cnae-service-code';

describe('suggestServiceCode', () => {
  it('suggests the code of a CNAE with a sure match, ignoring punctuation', () => {
    expect(suggestServiceCode('9602501')).toBe('060101');
    expect(suggestServiceCode('9602-5/01')).toBe('060101');
    expect(suggestServiceCode('6911701')).toBe('171401');
  });

  it('gives no suggestion for a CNAE that fits more than one item or is unknown', () => {
    expect(suggestServiceCode('6201501')).toBeNull();
    expect(suggestServiceCode('0000000')).toBeNull();
    expect(suggestServiceCode('')).toBeNull();
  });

  it('only points to codes that exist in the national catalog, and CNAEs have 7 digits', () => {
    const catalog = new Set(
      loadCtribnacCatalogFile().entries.map((e) => e.code),
    );
    for (const [cnae, code] of Object.entries(CNAE_SERVICE_CODES)) {
      expect(cnae).toMatch(/^\d{7}$/);
      expect(catalog.has(code)).toBe(true);
    }
  });
});
