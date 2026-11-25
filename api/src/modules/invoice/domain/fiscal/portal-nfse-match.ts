import { DateTime } from 'luxon';
import { parseNfseXml } from 'open-nfse';

/** Error code of an invoice whose DPS number the portal already has on ANOTHER NFS-e. */
export const DPS_USED_BY_OTHER_NFSE = 'DPS_NUMBER_USED_BY_OTHER_NFSE';

/** Error code of an invoice whose portal note belongs to the other environment (test note on a live invoice, or the reverse). */
export const PORTAL_NFSE_WRONG_ENVIRONMENT = 'PORTAL_NFSE_WRONG_ENVIRONMENT';

/** The `tpAmb` a note of this environment carries: 1 = Produção, 2 = Produção Restrita (no legal value). */
export const tpAmbOf = (environment: 'test' | 'live'): '1' | '2' =>
  environment === 'live' ? '1' : '2';

/** What our invoice says. The NFS-e the portal returns for its DPS must say the same. */
export interface PortalNfseExpectation {
  /** The invoice's environment: a live invoice only accepts a production note (tpAmb 1). */
  environment: 'test' | 'live';
  providerTaxId: string;
  /** CPF/CNPJ of the customer, digits only; null for a consumer without one or a customer abroad. */
  customerTaxId: string | null;
  amount: number;
  /** Calendar day, YYYY-MM-DD. */
  competenceDate: string;
  series: string;
  number: number;
}

/** The note the portal has, in the few words a person needs to recognize it. */
export interface PortalNfseSummary {
  nfseNumber: string;
  /** Day the DPS was issued (dhEmi) in São Paulo, YYYY-MM-DD. */
  issuedOn: string | null;
  amount: number | null;
}

export type PortalNfseField =
  | 'environment'
  | 'provider'
  | 'customer'
  | 'amount'
  | 'competenceDate'
  | 'dps'
  | 'unreadable';

export type PortalNfseCheck =
  | { matches: true }
  | {
      matches: false;
      differences: PortalNfseField[];
      found: PortalNfseSummary | null;
    };

/** The `tpAmb` written in the note's DPS ('1' production, '2' restricted), or null if unreadable. */
export function noteTpAmb(xml: string): '1' | '2' | null {
  try {
    const value = String(parseNfseXml(xml).infNFSe.DPS?.infDPS?.tpAmb ?? '');
    return value === '1' || value === '2' ? value : null;
  } catch {
    return null;
  }
}

const digits = (value: unknown): string | null =>
  typeof value === 'string' && value.trim()
    ? value.replace(/[./\s-]/g, '').toUpperCase()
    : null;

/** Date-only fields come back as São Paulo midnight; read them back in São Paulo. */
const saoPauloDay = (value: unknown): string | null => {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return DateTime.fromJSDate(date, { zone: 'America/Sao_Paulo' }).toISODate();
};

const cents = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

/**
 * Checks that the authorized NFS-e the portal returned for our DPS is really OUR note. The portal
 * answers by DPS id (CNPJ + series + number), so a number already used by another emission
 * (another system, the Emissor Nacional, a company registered again) returns that other note.
 * Any difference means the note is not ours and must never be attached to this invoice.
 */
export function checkPortalNfse(
  xml: string,
  expected: PortalNfseExpectation,
): PortalNfseCheck {
  let parsed: ReturnType<typeof parseNfseXml>;
  try {
    parsed = parseNfseXml(xml);
  } catch {
    return { matches: false, differences: ['unreadable'], found: null };
  }
  const inf = parsed.infNFSe;
  const dps = inf.DPS?.infDPS;
  if (!dps) return { matches: false, differences: ['unreadable'], found: null };
  const found: PortalNfseSummary = {
    nfseNumber: String(inf.nNFSe),
    issuedOn: saoPauloDay(dps.dhEmi),
    amount: cents(dps.valores?.vServPrest?.vServ),
  };
  const differences: PortalNfseField[] = [];
  if (String(dps.tpAmb) !== tpAmbOf(expected.environment))
    differences.push('environment');
  const provider = dps.prest?.identificador as
    { CNPJ?: string; CPF?: string } | undefined;
  if (
    digits(provider?.CNPJ ?? provider?.CPF) !== digits(expected.providerTaxId)
  )
    differences.push('provider');
  const customer = dps.toma?.identificador as
    { CNPJ?: string; CPF?: string } | undefined;
  if (
    (digits(customer?.CNPJ ?? customer?.CPF) ?? null) !==
    (digits(expected.customerTaxId) ?? null)
  )
    differences.push('customer');
  if (found.amount === null || found.amount !== cents(expected.amount))
    differences.push('amount');
  if (saoPauloDay(dps.dCompet) !== expected.competenceDate)
    differences.push('competenceDate');
  if (
    String(dps.serie).trim() !== String(expected.series).trim() ||
    Number(dps.nDPS) !== Number(expected.number)
  )
    differences.push('dps');
  return differences.length
    ? { matches: false, differences, found }
    : { matches: true };
}

const brl = (amountInCents: number): string =>
  `R$ ${(amountInCents / 100).toFixed(2).replace('.', ',')}`;

const brDate = (day: string): string => day.split('-').reverse().join('/');

/** The sentence shown on an invoice whose portal note belongs to the other environment. */
export function wrongEnvironmentMessage(
  environment: 'test' | 'live',
  found: PortalNfseSummary | null,
): string {
  const note = found ? `A nota nº ${found.nfseNumber}` : 'A nota';
  return environment === 'live'
    ? `${note} que o portal devolveu é de teste (Produção Restrita) e não tem valor fiscal, então não foi aceita. Esta nota não foi emitida. Descarte-a (o crédito volta) e emita a venda de novo.`
    : `${note} que o portal devolveu é de produção, e esta nota é de teste, então não foi aceita. Descarte-a e emita de novo.`;
}

/** The sentence shown on the invoice (pt-BR), with what a person needs to find the other note. */
export function dpsUsedByOtherNfseMessage(
  expected: Pick<PortalNfseExpectation, 'series' | 'number'>,
  found: PortalNfseSummary | null,
  discarded = false,
): string {
  const details = found
    ? [
        `nº ${found.nfseNumber}`,
        ...(found.issuedOn ? [`de ${brDate(found.issuedOn)}`] : []),
        ...(found.amount !== null ? [brl(found.amount)] : []),
      ].join(', ')
    : null;
  const other = details ? `outra nota (${details})` : 'outra nota';
  const used = `O número de DPS ${expected.number} (série ${expected.series}) já foi usado por ${other}.`;
  const reissue =
    'emita a venda de novo, por exemplo com "Duplicar": a nova nota recebe outro número. ' +
    'Antes, confira a numeração das notas na página da empresa.';
  return discarded
    ? `${used} Esta nota foi descartada sem ser emitida e o crédito voltou. Se precisar, ${reissue}`
    : `${used} Esta nota não foi emitida. Descarte-a (o crédito volta) e ${reissue}`;
}
