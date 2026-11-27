import type {
  AuthorityId,
  Uf,
} from '@/modules/fiscal-core/domain/ports/authority.port';

export type UtcOffset = '-02:00' | '-03:00' | '-04:00' | '-05:00';

export interface UfInfo {
  /** IBGE code of the UF (cUF). */
  cUF: string;
  /** Authority that serves model 55 for this UF. */
  authorizer55: AuthorityId;
  /**
   * Authority that serves model 65 (NFC-e) for this UF. Only SP is verified (its own NFC-e
   * services, https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/WebServices.aspx). The other
   * UFs say SVRS **[não verificado]**; no SVRS model 65 endpoint exists yet, so they fail with
   * `AuthorityNotConfiguredError` until a UF is added with its own homologation.
   */
  authorizer65: AuthorityId;
  /** Civil offset of the UF (Brazil has no DST since 2019). */
  utcOffset: UtcOffset;
  /**
   * Contingency authority of the UF for the NF-e (`tpEmis` 6 = SVCAN, 7 = SVCRS), per the Ato COTEPE
   * 39/2012 as listed in the Portal NF-e "Relação de Serviços Web" (last verified 2026-11-26).
   */
  svc: 'SVCAN' | 'SVCRS';
}

/**
 * Source of the authorizers: sped-nfe `storage/autorizadores.json` (mirror, 2026-11-23) and design
 * spec section 4 [verificado só no espelho]. IBGE codes are the official table.
 */
export const UF_TABLE: Record<Uf, UfInfo> = {
  AC: {
    cUF: '12',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-05:00',
    svc: 'SVCAN',
  },
  AL: {
    cUF: '27',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCAN',
  },
  AM: {
    cUF: '13',
    authorizer55: 'AM',
    authorizer65: 'SVRS',
    utcOffset: '-04:00',
    svc: 'SVCRS',
  },
  AP: {
    cUF: '16',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCAN',
  },
  BA: {
    cUF: '29',
    authorizer55: 'BA',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCRS',
  },
  CE: {
    cUF: '23',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCAN',
  },
  DF: {
    cUF: '53',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCAN',
  },
  ES: {
    cUF: '32',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCAN',
  },
  GO: {
    cUF: '52',
    authorizer55: 'GO',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCRS',
  },
  MA: {
    cUF: '21',
    authorizer55: 'SVAN',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCRS',
  },
  MG: {
    cUF: '31',
    authorizer55: 'MG',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCAN',
  },
  MS: {
    cUF: '50',
    authorizer55: 'MS',
    authorizer65: 'SVRS',
    utcOffset: '-04:00',
    svc: 'SVCRS',
  },
  MT: {
    cUF: '51',
    authorizer55: 'MT',
    authorizer65: 'SVRS',
    utcOffset: '-04:00',
    svc: 'SVCRS',
  },
  PA: {
    cUF: '15',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCAN',
  },
  PB: {
    cUF: '25',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCAN',
  },
  PE: {
    cUF: '26',
    authorizer55: 'PE',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCRS',
  },
  PI: {
    cUF: '22',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCAN',
  },
  PR: {
    cUF: '41',
    authorizer55: 'PR',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCRS',
  },
  RJ: {
    cUF: '33',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCAN',
  },
  RN: {
    cUF: '24',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCAN',
  },
  RO: {
    cUF: '11',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-04:00',
    svc: 'SVCAN',
  },
  RR: {
    cUF: '14',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-04:00',
    svc: 'SVCAN',
  },
  RS: {
    cUF: '43',
    authorizer55: 'RS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCAN',
  },
  SC: {
    cUF: '42',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCAN',
  },
  SE: {
    cUF: '28',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCAN',
  },
  SP: {
    cUF: '35',
    authorizer55: 'SP',
    authorizer65: 'SP',
    utcOffset: '-03:00',
    svc: 'SVCAN',
  },
  TO: {
    cUF: '17',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
    svc: 'SVCAN',
  },
};

export function isUf(value: string): value is Uf {
  return value in UF_TABLE;
}

/** dhEmi in the issuer UF's civil time: ISO with offset, no milliseconds. */
export function dhEmiFor(uf: Uf, now: Date): string {
  const offset = UF_TABLE[uf].utcOffset;
  const hours = Number(offset.slice(0, 3));
  const shifted = new Date(now.getTime() + hours * 3_600_000);
  return `${shifted.toISOString().slice(0, 19)}${offset}`;
}
