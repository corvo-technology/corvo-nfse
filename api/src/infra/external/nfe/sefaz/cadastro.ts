import { XMLParser } from 'fast-xml-parser';
import type {
  AuthorityId,
  Uf,
} from '@/modules/fiscal-core/domain/ports/authority.port';
import type { LoadedCertificate } from '@/modules/fiscal-core/domain/ports/xml.port';
import { WSDL_NAMESPACE } from './endpoints';
import type { SefazSoapClient } from './soap-client';
import { UF_TABLE } from './uf';

/**
 * "Consulta Cadastro" (`CadConsultaCadastro4`, layout consCad 2.00): the SEFAZ answers which state
 * registrations (IE) a CNPJ has in the UF and whether each one is enabled (`cSit`). Only the SEFAZs
 * of BA, GO, MG, MS, MT, PE, PR, RS, SP and SVRS offer it; the other UFs (AM, MA, and the UFs the SVRS
 * does not answer for) have no row, so the caller says "consulta indisponível".
 *
 * Production URLs only, on purpose: the homologação SEFAZ validates the issuer against the same
 * production cadastro (the 245 "CNPJ Emitente não cadastrado" comes from it) and the homologação
 * consulta hosts are not kept in sync, so even a test company asks the production one (read-only,
 * needs only the company certificate). Source (2026-11-27): sped-nfe `storage/wsnfe_4.00_mod55.xml`
 * (`NfeConsultaCadastro`) and the Portal Nacional da NF-e. Not yet proven against the live services.
 */
export interface CadastroEndpoint {
  authority: AuthorityId;
  url: string;
  soapAction: string;
}

const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const CADASTRO_NAMESPACE = `${WSDL_NAMESPACE}/CadConsultaCadastro4`;

function cadastro(
  authority: AuthorityId,
  url: string,
  method: 'consultaCadastro' | 'consultaCadastro4',
): CadastroEndpoint {
  return { authority, url, soapAction: `${CADASTRO_NAMESPACE}/${method}` };
}

const SVRS_CADASTRO =
  'https://cad.svrs.rs.gov.br/ws/cadconsultacadastro/cadconsultacadastro4.asmx';

/* prettier-ignore */
export const ENDPOINTS_CADASTRO: CadastroEndpoint[] = [
  cadastro('BA', 'https://nfe.sefaz.ba.gov.br/webservices/CadConsultaCadastro4/CadConsultaCadastro4.asmx', 'consultaCadastro'),
  cadastro('GO', 'https://nfe.sefaz.go.gov.br/nfe/services/CadConsultaCadastro4', 'consultaCadastro'),
  cadastro('MG', 'https://nfe.fazenda.mg.gov.br/nfe2/services/CadConsultaCadastro4', 'consultaCadastro4'),
  cadastro('MS', 'https://nfe.sefaz.ms.gov.br/ws/CadConsultaCadastro4', 'consultaCadastro'),
  cadastro('MT', 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/CadConsultaCadastro4', 'consultaCadastro'),
  cadastro('PE', 'https://nfe.sefaz.pe.gov.br/nfe-service/services/CadConsultaCadastro4', 'consultaCadastro4'),
  cadastro('PR', 'https://nfe.sefa.pr.gov.br/nfe/CadConsultaCadastro4', 'consultaCadastro4'),
  cadastro('RS', SVRS_CADASTRO, 'consultaCadastro4'),
  cadastro('SP', 'https://nfe.fazenda.sp.gov.br/ws/cadconsultacadastro4.asmx', 'consultaCadastro'),
  cadastro('SVRS', SVRS_CADASTRO, 'consultaCadastro4'),
];

/** The consulta endpoint of the UF, or `undefined` when its SEFAZ does not offer the service. */
export function cadastroEndpointFor(uf: Uf): CadastroEndpoint | undefined {
  const authority = UF_TABLE[uf]?.authorizer55;
  return ENDPOINTS_CADASTRO.find((row) => row.authority === authority);
}

/** The UFs whose consulta we know how to ask. */
export function cadastroUfs(): Uf[] {
  return (Object.keys(UF_TABLE) as Uf[]).filter(
    (uf) => cadastroEndpointFor(uf) !== undefined,
  );
}

export function consCadXml(uf: Uf, cnpj: string): string {
  return (
    `<ConsCad xmlns="${NFE_NS}" versao="2.00"><infCons>` +
    `<xServ>CONS-CAD</xServ><UF>${uf}</UF><CNPJ>${cnpj}</CNPJ>` +
    '</infCons></ConsCad>'
  );
}

export interface CadastroRegistration {
  /** Digits only. */
  stateRegistration: string;
  /** `cSit` 1: enabled to issue. */
  enabled: boolean;
  /** `indCredNFe`: 0 not credentialed, 1 to 3 credentialed, 4 or absent: the SEFAZ does not say. */
  nfeCredential: 'yes' | 'no' | 'unknown';
}

export type CadastroAnswer =
  /** cStat 111 / 112: one or more IE found. */
  | { kind: 'found'; registrations: CadastroRegistration[] }
  /** cStat 259: the CNPJ is not a contributor in the UF (no IE at all). */
  | { kind: 'not_found' }
  /** Anything else: the service is off, the UF is not served, the answer is not understood. */
  | { kind: 'unavailable' };

const parser = new XMLParser({
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreAttributes: true,
  isArray: (name) => name === 'infCad',
});

type Tree = Record<string, unknown>;
const asTree = (value: unknown): Tree | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Tree)
    : undefined;
const text = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : undefined;

function credential(
  value: string | undefined,
): CadastroRegistration['nfeCredential'] {
  if (value === '0') return 'no';
  if (value === '1' || value === '2' || value === '3') return 'yes';
  return 'unknown';
}

/** Reads `retConsCad`. Never throws: an answer it does not understand is `unavailable`. */
export function parseRetConsCad(answerXml: string): CadastroAnswer {
  let ret: Tree | undefined;
  try {
    ret = asTree(asTree(parser.parse(answerXml))?.retConsCad);
  } catch {
    return { kind: 'unavailable' };
  }
  const info = asTree(ret?.infCons);
  const cStat = text(info?.cStat);
  if (!info || !cStat) return { kind: 'unavailable' };
  if (cStat === '259') return { kind: 'not_found' };
  if (cStat !== '111' && cStat !== '112') return { kind: 'unavailable' };
  const entries = Array.isArray(info.infCad) ? info.infCad : [];
  const registrations: CadastroRegistration[] = [];
  for (const entry of entries) {
    const cad = asTree(entry);
    const digits = (text(cad?.IE) ?? '').replace(/\D/g, '');
    if (!cad || digits === '') continue;
    registrations.push({
      stateRegistration: digits,
      enabled: text(cad.cSit) === '1',
      nfeCredential: credential(text(cad.indCredNFe)),
    });
  }
  return registrations.length > 0
    ? { kind: 'found', registrations }
    : { kind: 'unavailable' };
}

/** Asks the SEFAZ of the UF for the registrations of a CNPJ, with the A1 certificate of the company. */
export async function lookupCadastro(
  soap: Pick<SefazSoapClient, 'call'>,
  timeoutMs: number,
  uf: Uf,
  cnpj: string,
  certificate: LoadedCertificate,
): Promise<CadastroAnswer> {
  const endpoint = cadastroEndpointFor(uf);
  if (!endpoint || !/^\d{14}$/.test(cnpj)) return { kind: 'unavailable' };
  const result = await soap.call({
    endpoint: { ...endpoint, version: '4.00' },
    bodyXml: consCadXml(uf, cnpj),
    certificate,
    timeoutMs,
  });
  return result.kind === 'ok'
    ? parseRetConsCad(result.bodyXml)
    : { kind: 'unavailable' };
}
