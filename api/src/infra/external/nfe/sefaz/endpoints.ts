import type {
  AuthorityEndpoint,
  AuthorityEndpointResolver,
  AuthorityId,
  AuthorityTarget,
  SefazService,
  TpEmis,
} from '@/modules/fiscal-core/domain/ports/authority.port';
import { UF_TABLE } from './uf';

export interface EndpointRow {
  authority: AuthorityId;
  tpAmb: 1 | 2;
  model: 55;
  tpEmis: TpEmis;
  service: SefazService;
  url: string;
  version: '4.00' | '1.00';
  soapAction: string;
}

export class AuthorityNotConfiguredError extends Error {
  constructor(
    readonly uf: string,
    readonly service: string,
    readonly tpAmb: number,
  ) {
    super(
      `No SEFAZ endpoint configured for uf=${uf} service=${service} tpAmb=${tpAmb}`,
    );
    this.name = 'AuthorityNotConfiguredError';
  }
}

export const WSDL_NAMESPACE = 'http://www.portalfiscal.inf.br/nfe/wsdl';

function row(
  authority: AuthorityId,
  tpAmb: 1 | 2,
  service: SefazService,
  url: string,
  version: '4.00' | '1.00',
  operation: string,
  method: string,
): EndpointRow {
  return {
    authority,
    tpAmb,
    model: 55,
    tpEmis: 1,
    service,
    url,
    version,
    soapAction: `${WSDL_NAMESPACE}/${operation}/${method}`,
  };
}

/**
 * Only SP and SVRS (the UFs of the phase 1 spike). Every URL comes from the sped-nfe mirror
 * (`storage/wsnfe_4.00_mod55.xml`, 2026-11-23) and is not yet proven against the live service:
 * [verificar no spike]. See docs/fiscal/nfe-spike.md.
 */
/* prettier-ignore */
export const ENDPOINTS: EndpointRow[] = [
  // SP homologação [verificar no spike]
  row('SP', 2, 'NfeStatusServico', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('SP', 2, 'NfeAutorizacao', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('SP', 2, 'NfeRetAutorizacao', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('SP', 2, 'NfeConsultaProtocolo', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('SP', 2, 'NfeInutilizacao', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('SP', 2, 'RecepcaoEvento', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // SP produção (bloqueada por NFE_PRODUCTION_ENABLED) [verificar no spike]
  row('SP', 1, 'NfeStatusServico', 'https://nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('SP', 1, 'NfeAutorizacao', 'https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('SP', 1, 'NfeRetAutorizacao', 'https://nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('SP', 1, 'NfeConsultaProtocolo', 'https://nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('SP', 1, 'NfeInutilizacao', 'https://nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('SP', 1, 'RecepcaoEvento', 'https://nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // SVRS homologação [verificar no spike]
  row('SVRS', 2, 'NfeStatusServico', 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('SVRS', 2, 'NfeAutorizacao', 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('SVRS', 2, 'NfeRetAutorizacao', 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('SVRS', 2, 'NfeConsultaProtocolo', 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('SVRS', 2, 'NfeInutilizacao', 'https://nfe-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('SVRS', 2, 'RecepcaoEvento', 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // SVRS produção (bloqueada por NFE_PRODUCTION_ENABLED) [verificar no spike]
  row('SVRS', 1, 'NfeStatusServico', 'https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('SVRS', 1, 'NfeAutorizacao', 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('SVRS', 1, 'NfeRetAutorizacao', 'https://nfe.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('SVRS', 1, 'NfeConsultaProtocolo', 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('SVRS', 1, 'NfeInutilizacao', 'https://nfe.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('SVRS', 1, 'RecepcaoEvento', 'https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
];

export class TableAuthorityEndpointResolver implements AuthorityEndpointResolver {
  constructor(private readonly rows: EndpointRow[] = ENDPOINTS) {}

  resolve(q: AuthorityTarget & { service: SefazService }): AuthorityEndpoint {
    const info = UF_TABLE[q.uf];
    const found =
      q.model === 55 && info
        ? this.rows.find(
            (r) =>
              r.authority === info.authorizer55 &&
              r.tpAmb === q.tpAmb &&
              r.model === q.model &&
              r.tpEmis === q.tpEmis &&
              r.service === q.service,
          )
        : undefined;
    if (!found) throw new AuthorityNotConfiguredError(q.uf, q.service, q.tpAmb);
    return {
      authority: found.authority,
      url: found.url,
      soapAction: found.soapAction,
      version: found.version,
    };
  }
}
