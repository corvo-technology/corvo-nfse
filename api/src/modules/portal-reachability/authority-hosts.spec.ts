import {
  ENDPOINTS,
  ENDPOINTS_65,
  ENDPOINTS_SVC,
} from '@/infra/external/nfe/sefaz/endpoints';
import { authorityHosts } from './authority-hosts';

const rows = [...ENDPOINTS, ...ENDPOINTS_65, ...ENDPOINTS_SVC];

describe('authorityHosts', () => {
  it('gives one distinct host per model for SP in homologação', () => {
    const found = authorityHosts(rows, [
      { uf: 'SP', model: 55, tpAmb: 2 },
      { uf: 'SP', model: 65, tpAmb: 2 },
    ]);
    const sp = found.filter((f) => f.authority.includes('-sp-'));
    expect(sp.map((f) => f.authority).sort()).toEqual([
      'nfce-sp-2',
      'nfe-sp-2',
    ]);
    expect(new Set(sp.map((f) => f.host)).size).toBe(2);
    expect(sp.find((f) => f.authority === 'nfce-sp-2')?.host).toBe(
      'homologacao.nfce.fazenda.sp.gov.br',
    );
  });

  it('adds the SVC target of an enabled NF-e UF', () => {
    const found = authorityHosts(rows, [{ uf: 'SP', model: 55, tpAmb: 2 }]);
    expect(found.map((f) => f.authority)).toContain('nfe-svcan-2');
    expect(found.find((f) => f.authority === 'nfe-svcan-2')?.host).toBe(
      'hom.svc.fazenda.gov.br',
    );
    const am = authorityHosts(rows, [{ uf: 'AM', model: 55, tpAmb: 1 }]);
    expect(am.map((f) => f.authority)).toContain('nfe-svcrs-1');
  });

  it('does not add an SVC target for the NFC-e', () => {
    const found = authorityHosts(rows, [{ uf: 'SP', model: 65, tpAmb: 2 }]);
    expect(found.map((f) => f.authority)).toEqual(['nfce-sp-2']);
  });

  it('has no duplicates and nothing when no UF is enabled', () => {
    const found = authorityHosts(rows, [
      { uf: 'SP', model: 55, tpAmb: 2 },
      { uf: 'SP', model: 55, tpAmb: 2 },
      { uf: 'RJ', model: 55, tpAmb: 2 },
      { uf: 'MG', model: 55, tpAmb: 2 },
    ]);
    const names = found.map((f) => f.authority);
    expect(new Set(names).size).toBe(names.length);
    expect(authorityHosts(rows, [])).toEqual([]);
  });

  it('skips a combination with no status row (NFC-e of a UF not wired yet)', () => {
    expect(authorityHosts(rows, [{ uf: 'RJ', model: 65, tpAmb: 2 }])).toEqual(
      [],
    );
  });
});
