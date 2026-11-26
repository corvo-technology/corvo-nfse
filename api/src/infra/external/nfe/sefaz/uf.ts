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
  },
  AL: {
    cUF: '27',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  AM: {
    cUF: '13',
    authorizer55: 'AM',
    authorizer65: 'SVRS',
    utcOffset: '-04:00',
  },
  AP: {
    cUF: '16',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  BA: {
    cUF: '29',
    authorizer55: 'BA',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  CE: {
    cUF: '23',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  DF: {
    cUF: '53',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  ES: {
    cUF: '32',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  GO: {
    cUF: '52',
    authorizer55: 'GO',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  MA: {
    cUF: '21',
    authorizer55: 'SVAN',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  MG: {
    cUF: '31',
    authorizer55: 'MG',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  MS: {
    cUF: '50',
    authorizer55: 'MS',
    authorizer65: 'SVRS',
    utcOffset: '-04:00',
  },
  MT: {
    cUF: '51',
    authorizer55: 'MT',
    authorizer65: 'SVRS',
    utcOffset: '-04:00',
  },
  PA: {
    cUF: '15',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  PB: {
    cUF: '25',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  PE: {
    cUF: '26',
    authorizer55: 'PE',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  PI: {
    cUF: '22',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  PR: {
    cUF: '41',
    authorizer55: 'PR',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  RJ: {
    cUF: '33',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  RN: {
    cUF: '24',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  RO: {
    cUF: '11',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-04:00',
  },
  RR: {
    cUF: '14',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-04:00',
  },
  RS: {
    cUF: '43',
    authorizer55: 'RS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  SC: {
    cUF: '42',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  SE: {
    cUF: '28',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
  },
  SP: {
    cUF: '35',
    authorizer55: 'SP',
    authorizer65: 'SP',
    utcOffset: '-03:00',
  },
  TO: {
    cUF: '17',
    authorizer55: 'SVRS',
    authorizer65: 'SVRS',
    utcOffset: '-03:00',
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

export type SvcAuthorityId = 'SVC-AN' | 'SVC-RS';

/**
 * Contingency authority (tpEmis 6 = SVC-AN, 7 = SVC-RS) of each UF, per the Portal NF-e "Relação de
 * Serviços Web" (last verified 2026-11-26). Data only for now: nothing emits in contingency yet.
 * The SVC-AN URLs are the SVAN ones and the SVC-RS URLs are the SVRS ones (same hosts and paths),
 * so no extra rows are needed in `ENDPOINTS`.
 */
export const SVC_AUTHORITY_BY_UF: Record<Uf, SvcAuthorityId> = {
  AC: 'SVC-RS',
  AL: 'SVC-RS',
  AM: 'SVC-AN',
  AP: 'SVC-RS',
  BA: 'SVC-AN',
  CE: 'SVC-AN',
  DF: 'SVC-RS',
  ES: 'SVC-RS',
  GO: 'SVC-AN',
  MA: 'SVC-AN',
  MG: 'SVC-RS',
  MS: 'SVC-AN',
  MT: 'SVC-AN',
  PA: 'SVC-AN',
  PB: 'SVC-RS',
  PE: 'SVC-AN',
  PI: 'SVC-AN',
  PR: 'SVC-AN',
  RJ: 'SVC-RS',
  RN: 'SVC-RS',
  RO: 'SVC-RS',
  RR: 'SVC-RS',
  RS: 'SVC-RS',
  SC: 'SVC-RS',
  SE: 'SVC-RS',
  SP: 'SVC-RS',
  TO: 'SVC-RS',
};

/** Authority whose URLs a contingency authority uses. */
export const SVC_URL_AUTHORITY: Record<SvcAuthorityId, AuthorityId> = {
  'SVC-AN': 'SVAN',
  'SVC-RS': 'SVRS',
};
