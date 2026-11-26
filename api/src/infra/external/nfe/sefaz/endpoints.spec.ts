import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import {
  AuthorityNotConfiguredError,
  ENDPOINTS,
  TableAuthorityEndpointResolver,
} from './endpoints';
import { dhEmiFor, UF_TABLE } from './uf';

describe('UF_TABLE', () => {
  it('has the 27 UFs with unique IBGE codes', () => {
    const ufs = Object.keys(UF_TABLE);
    expect(ufs).toHaveLength(27);
    expect(new Set(ufs.map((u) => UF_TABLE[u as Uf].cUF)).size).toBe(27);
  });

  it('maps the authorizers of the spec', () => {
    expect(UF_TABLE.SP.authorizer55).toBe('SP');
    expect(UF_TABLE.RJ.authorizer55).toBe('SVRS');
    expect(UF_TABLE.MA.authorizer55).toBe('SVAN');
    expect(UF_TABLE.SP.cUF).toBe('35');
  });
});

describe('ENDPOINTS', () => {
  it('uses https everywhere and only SP and SVRS', () => {
    for (const e of ENDPOINTS) expect(e.url.startsWith('https://')).toBe(true);
    expect(new Set(ENDPOINTS.map((e) => e.authority))).toEqual(
      new Set(['SP', 'SVRS']),
    );
  });

  it('has the six services for each environment', () => {
    for (const authority of ['SP', 'SVRS'])
      for (const tpAmb of [1, 2])
        expect(
          ENDPOINTS.filter(
            (e) => e.authority === authority && e.tpAmb === tpAmb,
          ),
        ).toHaveLength(6);
  });
});

describe('TableAuthorityEndpointResolver', () => {
  const resolver = new TableAuthorityEndpointResolver();
  const base = { tpAmb: 2 as const, model: 55 as const, tpEmis: 1 as const };

  it('resolves SP to its own authority', () => {
    const r = resolver.resolve({
      ...base,
      uf: 'SP',
      service: 'NfeStatusServico',
    });
    expect(r.authority).toBe('SP');
    expect(r.version).toBe('4.00');
    expect(r.soapAction).toBe(
      'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
    );
  });

  it('resolves RJ to SVRS', () => {
    const r = resolver.resolve({
      ...base,
      uf: 'RJ',
      service: 'NfeAutorizacao',
    });
    expect(r.authority).toBe('SVRS');
  });

  it('throws for a UF without a row', () => {
    expect(() =>
      resolver.resolve({ ...base, uf: 'MG', service: 'NfeStatusServico' }),
    ).toThrow(AuthorityNotConfiguredError);
  });

  it('throws for model 65', () => {
    expect(() =>
      resolver.resolve({
        ...base,
        model: 65,
        uf: 'SP',
        service: 'NfeStatusServico',
      }),
    ).toThrow(AuthorityNotConfiguredError);
  });
});

describe('dhEmiFor', () => {
  it('uses the UF civil time, not UTC', () => {
    expect(dhEmiFor('AM', new Date('2026-12-01T03:30:00Z'))).toBe(
      '2026-11-30T23:30:00-04:00',
    );
    expect(dhEmiFor('SP', new Date('2026-12-01T03:30:00.789Z'))).toBe(
      '2026-12-01T00:30:00-03:00',
    );
    expect(dhEmiFor('AC', new Date('2026-12-01T03:30:00Z'))).toBe(
      '2026-11-30T22:30:00-05:00',
    );
  });
});
