import type {
  AuthorityId,
  SefazService,
  Uf,
} from '@/modules/fiscal-core/domain/ports/authority.port';
import {
  AuthorityNotConfiguredError,
  ENDPOINTS,
  ENDPOINTS_65,
  ENDPOINTS_SVC,
  endpointTpEmis,
  TableAuthorityEndpointResolver,
  WSDL_NAMESPACE,
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
    expect(UF_TABLE.SP.authorizer65).toBe('SP');
  });
});

const SERVICES: SefazService[] = [
  'NfeAutorizacao',
  'NfeRetAutorizacao',
  'NfeConsultaProtocolo',
  'NfeStatusServico',
  'RecepcaoEvento',
  'NfeInutilizacao',
];
const OWN: AuthorityId[] = [
  'AM',
  'BA',
  'GO',
  'MG',
  'MS',
  'MT',
  'PE',
  'PR',
  'RS',
  'SP',
];

describe('ENDPOINTS', () => {
  it('uses https everywhere, with well-formed URLs and no unexpected authority', () => {
    for (const e of ENDPOINTS) {
      expect(e.url).toMatch(/^https:\/\/[a-z0-9.-]+\/\S+$/i);
      expect(() => new URL(e.url)).not.toThrow();
    }
    expect(new Set(ENDPOINTS.map((e) => e.authority))).toEqual(
      new Set([...OWN, 'SVAN', 'SVRS']),
    );
  });

  it('has the six services for each authority and environment, once each', () => {
    const authorities = new Set(ENDPOINTS.map((e) => e.authority));
    for (const authority of authorities)
      for (const tpAmb of [1, 2])
        expect(
          ENDPOINTS.filter(
            (e) => e.authority === authority && e.tpAmb === tpAmb,
          )
            .map((e) => e.service)
            .sort(),
        ).toEqual([...SERVICES].sort());
  });

  it('has no duplicate URL inside an environment', () => {
    for (const tpAmb of [1, 2]) {
      const urls = ENDPOINTS.filter((e) => e.tpAmb === tpAmb).map((e) => e.url);
      expect(new Set(urls).size).toBe(urls.length);
    }
  });

  it('keeps homologação and produção on different URLs', () => {
    const hom = new Set(
      ENDPOINTS.filter((e) => e.tpAmb === 2).map((e) => e.url),
    );
    for (const e of ENDPOINTS.filter((e) => e.tpAmb === 1))
      expect(hom.has(e.url)).toBe(false);
  });
});

describe('ENDPOINTS_65', () => {
  it('has the six services for SP in both environments, all model 65, on .gov.br hosts', () => {
    for (const tpAmb of [1, 2])
      expect(
        ENDPOINTS_65.filter((e) => e.tpAmb === tpAmb && e.authority === 'SP')
          .map((e) => e.service)
          .sort(),
      ).toEqual([...SERVICES].sort());
    for (const e of ENDPOINTS_65) {
      expect(e.model).toBe(65);
      expect(new URL(e.url).hostname.endsWith('.gov.br')).toBe(true);
      expect(e.soapAction.startsWith(`${WSDL_NAMESPACE}/`)).toBe(true);
    }
  });

  it('has no model 55 row mixed in ENDPOINTS', () => {
    expect(ENDPOINTS.every((e) => e.model === 55)).toBe(true);
  });
});

describe('every UF', () => {
  const resolver = new TableAuthorityEndpointResolver();
  it.each(Object.keys(UF_TABLE) as Uf[])(
    '%s resolves all services in both environments',
    (uf) => {
      for (const tpAmb of [1, 2] as const)
        for (const service of SERVICES) {
          const r = resolver.resolve({
            uf,
            tpAmb,
            model: 55,
            tpEmis: 1,
            service,
          });
          expect(r.authority).toBe(UF_TABLE[uf].authorizer55);
          expect(r.url.startsWith('https://')).toBe(true);
          expect(r.soapAction).toContain('/wsdl/');
        }
    },
  );

  it('maps own-SEFAZ, SVAN and SVRS UFs', () => {
    for (const uf of OWN as string[])
      expect(UF_TABLE[uf as Uf].authorizer55).toBe(uf);
    expect(
      Object.keys(UF_TABLE).filter(
        (u) => UF_TABLE[u as Uf].authorizer55 === 'SVAN',
      ),
    ).toEqual(['MA']);
    expect(
      Object.keys(UF_TABLE).filter(
        (u) => UF_TABLE[u as Uf].authorizer55 === 'SVRS',
      ),
    ).toHaveLength(16);
  });

  it('has a contingency authority for every UF (Ato COTEPE 39/2012)', () => {
    const an = [
      'AC',
      'AL',
      'AP',
      'CE',
      'DF',
      'ES',
      'MG',
      'PA',
      'PB',
      'PI',
      'RJ',
      'RN',
      'RO',
      'RR',
      'RS',
      'SC',
      'SE',
      'SP',
      'TO',
    ];
    const rs = ['AM', 'BA', 'GO', 'MA', 'MT', 'MS', 'PE', 'PR'];
    for (const uf of an) expect(UF_TABLE[uf as Uf].svc).toBe('SVCAN');
    for (const uf of rs) expect(UF_TABLE[uf as Uf].svc).toBe('SVCRS');
    expect(an.length + rs.length).toBe(27);
    expect(Object.keys(UF_TABLE)).toHaveLength(27);
  });
});

describe('ENDPOINTS_SVC', () => {
  it('has five services (no inutilização) per authority and environment, model 55 only', () => {
    for (const [authority, tpEmis] of [
      ['SVCAN', 6],
      ['SVCRS', 7],
    ] as const)
      for (const tpAmb of [1, 2])
        expect(
          ENDPOINTS_SVC.filter(
            (e) => e.authority === authority && e.tpAmb === tpAmb,
          )
            .map((e) => e.service)
            .sort(),
        ).toEqual(SERVICES.filter((s) => s !== 'NfeInutilizacao').sort());
    expect(ENDPOINTS_SVC.every((e) => e.model === 55)).toBe(true);
    expect(
      ENDPOINTS_SVC.every(
        (e) => e.tpEmis === (e.authority === 'SVCAN' ? 6 : 7),
      ),
    ).toBe(true);
  });

  it('uses the SVC hosts', () => {
    const host = (authority: string, tpAmb: number) =>
      new URL(
        ENDPOINTS_SVC.find(
          (e) =>
            e.authority === authority &&
            e.tpAmb === tpAmb &&
            e.service === 'NfeAutorizacao',
        )!.url,
      ).hostname;
    expect(host('SVCAN', 2)).toBe('hom.svc.fazenda.gov.br');
    expect(host('SVCAN', 1)).toBe('www.svc.fazenda.gov.br');
    expect(host('SVCRS', 2)).toBe('nfe-homologacao.svrs.rs.gov.br');
    expect(host('SVCRS', 1)).toBe('nfe.svrs.rs.gov.br');
  });
});

describe('endpointTpEmis', () => {
  const key = (tpEmis: string) =>
    `3526110000000000000055001000000001${tpEmis}123456780`;
  it('sends 6 and 7 to the SVC and everything else to the origin', () => {
    expect(key('6').charAt(34)).toBe('6');
    expect(endpointTpEmis(key('6'))).toBe(6);
    expect(endpointTpEmis(key('7'))).toBe(7);
    expect(endpointTpEmis(key('1'))).toBe(1);
    expect(endpointTpEmis(key('9'))).toBe(1);
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

  it('throws when the table has no row', () => {
    expect(() =>
      new TableAuthorityEndpointResolver([]).resolve({
        ...base,
        uf: 'MG',
        service: 'NfeStatusServico',
      }),
    ).toThrow(AuthorityNotConfiguredError);
  });

  // Changed by the NFC-e (model 65 now has the SP rows): the old case fixed SP as "not configured".
  it('throws for model 65 in a UF with no NFC-e row', () => {
    expect(() =>
      resolver.resolve({
        ...base,
        model: 65,
        uf: 'RJ',
        service: 'NfeStatusServico',
      }),
    ).toThrow(AuthorityNotConfiguredError);
  });

  it('resolves SP model 65 to the NFC-e hosts, in both environments', () => {
    const hom = resolver.resolve({
      ...base,
      model: 65,
      uf: 'SP',
      service: 'NfeAutorizacao',
    });
    expect(hom.url).toBe(
      'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx',
    );
    const prod = resolver.resolve({
      ...base,
      tpAmb: 1,
      model: 65,
      uf: 'SP',
      service: 'NfeAutorizacao',
    });
    expect(prod.url).toBe(
      'https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx',
    );
    expect(hom.soapAction).toBe(
      'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote',
    );
  });

  it('keeps model 55 for SP on the NF-e hosts', () => {
    expect(
      resolver.resolve({ ...base, uf: 'SP', service: 'NfeAutorizacao' }).url,
    ).toContain('.nfe.fazenda.sp.gov.br');
  });

  it('resolves tpEmis 6 and 7 to the SVC of the UF', () => {
    const r6 = resolver.resolve({
      ...base,
      uf: 'SP',
      tpEmis: 6,
      service: 'NfeAutorizacao',
    });
    expect(r6.authority).toBe('SVCAN');
    expect(new URL(r6.url).hostname).toBe('hom.svc.fazenda.gov.br');
    const r7 = resolver.resolve({
      ...base,
      uf: 'AM',
      tpEmis: 7,
      service: 'NfeAutorizacao',
    });
    expect(r7.authority).toBe('SVCRS');
  });

  it('refuses the SVC the UF does not belong to, the inutilização and the NFC-e', () => {
    expect(() =>
      resolver.resolve({
        ...base,
        uf: 'SP',
        tpEmis: 7,
        service: 'NfeAutorizacao',
      }),
    ).toThrow(AuthorityNotConfiguredError);
    expect(() =>
      resolver.resolve({
        ...base,
        uf: 'AM',
        tpEmis: 6,
        service: 'NfeAutorizacao',
      }),
    ).toThrow(AuthorityNotConfiguredError);
    expect(() =>
      resolver.resolve({
        ...base,
        uf: 'SP',
        tpEmis: 6,
        service: 'NfeInutilizacao',
      }),
    ).toThrow(AuthorityNotConfiguredError);
    expect(() =>
      resolver.resolve({
        ...base,
        uf: 'SP',
        model: 65,
        tpEmis: 6,
        service: 'NfeAutorizacao',
      }),
    ).toThrow(AuthorityNotConfiguredError);
  });

  it('sends the off-line NFC-e (tpEmis 9) to the normal authorizer', () => {
    const normal = resolver.resolve({
      ...base,
      model: 65,
      uf: 'SP',
      tpEmis: 1,
      service: 'NfeAutorizacao',
    });
    const offline = resolver.resolve({
      ...base,
      model: 65,
      uf: 'SP',
      tpEmis: 9,
      service: 'NfeAutorizacao',
    });
    expect(offline.url).toBe(normal.url);
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
