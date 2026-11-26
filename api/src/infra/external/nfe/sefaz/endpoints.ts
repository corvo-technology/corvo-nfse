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
  model: 55 | 65;
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

function rowOfModel(
  model: 55 | 65,
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
    model,
    tpEmis: 1,
    service,
    url,
    version,
    soapAction: `${WSDL_NAMESPACE}/${operation}/${method}`,
  };
}

function row(
  ...args: [
    authority: AuthorityId,
    tpAmb: 1 | 2,
    service: SefazService,
    url: string,
    version: '4.00' | '1.00',
    operation: string,
    method: string,
  ]
): EndpointRow {
  return rowOfModel(55, ...args);
}

/** Same as `row`, for the NFC-e (modelo 65). */
function row65(
  ...args: [
    authority: AuthorityId,
    tpAmb: 1 | 2,
    service: SefazService,
    url: string,
    version: '4.00' | '1.00',
    operation: string,
    method: string,
  ]
): EndpointRow {
  return rowOfModel(65, ...args);
}

/**
 * NF-e 4.00, modelo 55, emissão normal (tpEmis 1): the 12 authorities that serve the 27 UFs
 * (10 own SEFAZ + SVAN + SVRS). The UF -> authority map is in `uf.ts`.
 *
 * Sources (last verified 2026-11-26):
 * - Portal Nacional da NF-e, "Relação de Serviços Web" (https://www.nfe.fazenda.gov.br/portal/webServices.aspx),
 *   used for the authority of each UF (own SEFAZ: AM BA GO MG MS MT PE PR RS SP; SVAN: MA; SVRS: the rest);
 * - URLs copied from sped-nfe `storage/wsnfe_4.00_mod55.xml` and `storage/autorizadores.json`
 *   (https://github.com/nfephp-org/sped-nfe, LGPL-3.0, used here only as a data reference).
 * Not yet proven against the live services: run `yarn ts-node -r tsconfig-paths/register
 * scripts/nfe-check-endpoints.ts` and the homologação roteiro (docs/fiscal/runbooks/nfe-homologacao.md)
 * before enabling a UF. SVAN is unified with SVC-AN (same URLs); SVC-RS uses the SVRS URLs
 * (see SVC_AUTHORITY_BY_UF in uf.ts).
 */
/* prettier-ignore */
export const ENDPOINTS: EndpointRow[] = [
  // AM homologação
  row('AM', 2, 'NfeStatusServico', 'https://homnfe.sefaz.am.gov.br/services2/services/NfeStatusServico4', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('AM', 2, 'NfeAutorizacao', 'https://homnfe.sefaz.am.gov.br/services2/services/NfeAutorizacao4', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('AM', 2, 'NfeRetAutorizacao', 'https://homnfe.sefaz.am.gov.br/services2/services/NfeRetAutorizacao4', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('AM', 2, 'NfeConsultaProtocolo', 'https://homnfe.sefaz.am.gov.br/services2/services/NfeConsulta4', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('AM', 2, 'NfeInutilizacao', 'https://homnfe.sefaz.am.gov.br/services2/services/NfeInutilizacao4', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('AM', 2, 'RecepcaoEvento', 'https://homnfe.sefaz.am.gov.br/services2/services/RecepcaoEvento4', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // AM produção
  row('AM', 1, 'NfeStatusServico', 'https://nfe.sefaz.am.gov.br/services2/services/NfeStatusServico4', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('AM', 1, 'NfeAutorizacao', 'https://nfe.sefaz.am.gov.br/services2/services/NfeAutorizacao4', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('AM', 1, 'NfeRetAutorizacao', 'https://nfe.sefaz.am.gov.br/services2/services/NfeRetAutorizacao4', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('AM', 1, 'NfeConsultaProtocolo', 'https://nfe.sefaz.am.gov.br/services2/services/NfeConsulta4', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('AM', 1, 'NfeInutilizacao', 'https://nfe.sefaz.am.gov.br/services2/services/NfeInutilizacao4', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('AM', 1, 'RecepcaoEvento', 'https://nfe.sefaz.am.gov.br/services2/services/RecepcaoEvento4', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // BA homologação
  row('BA', 2, 'NfeStatusServico', 'https://hnfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('BA', 2, 'NfeAutorizacao', 'https://hnfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('BA', 2, 'NfeRetAutorizacao', 'https://hnfe.sefaz.ba.gov.br/webservices/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('BA', 2, 'NfeConsultaProtocolo', 'https://hnfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('BA', 2, 'NfeInutilizacao', 'https://hnfe.sefaz.ba.gov.br/webservices/NFeInutilizacao4/NFeInutilizacao4.asmx', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('BA', 2, 'RecepcaoEvento', 'https://hnfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // BA produção
  row('BA', 1, 'NfeStatusServico', 'https://nfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('BA', 1, 'NfeAutorizacao', 'https://nfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('BA', 1, 'NfeRetAutorizacao', 'https://nfe.sefaz.ba.gov.br/webservices/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('BA', 1, 'NfeConsultaProtocolo', 'https://nfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('BA', 1, 'NfeInutilizacao', 'https://nfe.sefaz.ba.gov.br/webservices/NFeInutilizacao4/NFeInutilizacao4.asmx', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('BA', 1, 'RecepcaoEvento', 'https://nfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // GO homologação
  row('GO', 2, 'NfeStatusServico', 'https://homolog.sefaz.go.gov.br/nfe/services/NFeStatusServico4', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('GO', 2, 'NfeAutorizacao', 'https://homolog.sefaz.go.gov.br/nfe/services/NFeAutorizacao4', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('GO', 2, 'NfeRetAutorizacao', 'https://homolog.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('GO', 2, 'NfeConsultaProtocolo', 'https://homolog.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('GO', 2, 'NfeInutilizacao', 'https://homolog.sefaz.go.gov.br/nfe/services/NFeInutilizacao4', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('GO', 2, 'RecepcaoEvento', 'https://homolog.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // GO produção
  row('GO', 1, 'NfeStatusServico', 'https://nfe.sefaz.go.gov.br/nfe/services/NFeStatusServico4', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('GO', 1, 'NfeAutorizacao', 'https://nfe.sefaz.go.gov.br/nfe/services/NFeAutorizacao4', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('GO', 1, 'NfeRetAutorizacao', 'https://nfe.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('GO', 1, 'NfeConsultaProtocolo', 'https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('GO', 1, 'NfeInutilizacao', 'https://nfe.sefaz.go.gov.br/nfe/services/NFeInutilizacao4', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('GO', 1, 'RecepcaoEvento', 'https://nfe.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // MG homologação
  row('MG', 2, 'NfeStatusServico', 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('MG', 2, 'NfeAutorizacao', 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('MG', 2, 'NfeRetAutorizacao', 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRetAutorizacao4', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('MG', 2, 'NfeConsultaProtocolo', 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('MG', 2, 'NfeInutilizacao', 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeInutilizacao4', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('MG', 2, 'RecepcaoEvento', 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRecepcaoEvento4', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // MG produção
  row('MG', 1, 'NfeStatusServico', 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('MG', 1, 'NfeAutorizacao', 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('MG', 1, 'NfeRetAutorizacao', 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeRetAutorizacao4', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('MG', 1, 'NfeConsultaProtocolo', 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('MG', 1, 'NfeInutilizacao', 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeInutilizacao4', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('MG', 1, 'RecepcaoEvento', 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeRecepcaoEvento4', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // MS homologação
  row('MS', 2, 'NfeStatusServico', 'https://hom.nfe.sefaz.ms.gov.br/ws/NFeStatusServico4', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('MS', 2, 'NfeAutorizacao', 'https://hom.nfe.sefaz.ms.gov.br/ws/NFeAutorizacao4', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('MS', 2, 'NfeRetAutorizacao', 'https://hom.nfe.sefaz.ms.gov.br/ws/NFeRetAutorizacao4', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('MS', 2, 'NfeConsultaProtocolo', 'https://hom.nfe.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('MS', 2, 'NfeInutilizacao', 'https://hom.nfe.sefaz.ms.gov.br/ws/NFeInutilizacao4', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('MS', 2, 'RecepcaoEvento', 'https://hom.nfe.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // MS produção
  row('MS', 1, 'NfeStatusServico', 'https://nfe.sefaz.ms.gov.br/ws/NFeStatusServico4', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('MS', 1, 'NfeAutorizacao', 'https://nfe.sefaz.ms.gov.br/ws/NFeAutorizacao4', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('MS', 1, 'NfeRetAutorizacao', 'https://nfe.sefaz.ms.gov.br/ws/NFeRetAutorizacao4', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('MS', 1, 'NfeConsultaProtocolo', 'https://nfe.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('MS', 1, 'NfeInutilizacao', 'https://nfe.sefaz.ms.gov.br/ws/NFeInutilizacao4', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('MS', 1, 'RecepcaoEvento', 'https://nfe.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // MT homologação
  row('MT', 2, 'NfeStatusServico', 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeStatusServico4', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('MT', 2, 'NfeAutorizacao', 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeAutorizacao4', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('MT', 2, 'NfeRetAutorizacao', 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeRetAutorizacao4', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('MT', 2, 'NfeConsultaProtocolo', 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('MT', 2, 'NfeInutilizacao', 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeInutilizacao4', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('MT', 2, 'RecepcaoEvento', 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/RecepcaoEvento4', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // MT produção
  row('MT', 1, 'NfeStatusServico', 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeStatusServico4', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('MT', 1, 'NfeAutorizacao', 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeAutorizacao4', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('MT', 1, 'NfeRetAutorizacao', 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeRetAutorizacao4', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('MT', 1, 'NfeConsultaProtocolo', 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('MT', 1, 'NfeInutilizacao', 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeInutilizacao4', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('MT', 1, 'RecepcaoEvento', 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/RecepcaoEvento4', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // PE homologação
  row('PE', 2, 'NfeStatusServico', 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeStatusServico4', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('PE', 2, 'NfeAutorizacao', 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeAutorizacao4', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('PE', 2, 'NfeRetAutorizacao', 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeRetAutorizacao4', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('PE', 2, 'NfeConsultaProtocolo', 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('PE', 2, 'NfeInutilizacao', 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeInutilizacao4', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('PE', 2, 'RecepcaoEvento', 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeRecepcaoEvento4', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // PE produção
  row('PE', 1, 'NfeStatusServico', 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeStatusServico4', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('PE', 1, 'NfeAutorizacao', 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeAutorizacao4', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('PE', 1, 'NfeRetAutorizacao', 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeRetAutorizacao4', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('PE', 1, 'NfeConsultaProtocolo', 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('PE', 1, 'NfeInutilizacao', 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeInutilizacao4', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('PE', 1, 'RecepcaoEvento', 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeRecepcaoEvento4', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // PR homologação
  row('PR', 2, 'NfeStatusServico', 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeStatusServico4', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('PR', 2, 'NfeAutorizacao', 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('PR', 2, 'NfeRetAutorizacao', 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeRetAutorizacao4', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacao'),
  row('PR', 2, 'NfeConsultaProtocolo', 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('PR', 2, 'NfeInutilizacao', 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeInutilizacao4', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('PR', 2, 'RecepcaoEvento', 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // PR produção
  row('PR', 1, 'NfeStatusServico', 'https://nfe.sefa.pr.gov.br/nfe/NFeStatusServico4', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('PR', 1, 'NfeAutorizacao', 'https://nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('PR', 1, 'NfeRetAutorizacao', 'https://nfe.sefa.pr.gov.br/nfe/NFeRetAutorizacao4', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacao'),
  row('PR', 1, 'NfeConsultaProtocolo', 'https://nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('PR', 1, 'NfeInutilizacao', 'https://nfe.sefa.pr.gov.br/nfe/NFeInutilizacao4', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('PR', 1, 'RecepcaoEvento', 'https://nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // RS homologação
  row('RS', 2, 'NfeStatusServico', 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('RS', 2, 'NfeAutorizacao', 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('RS', 2, 'NfeRetAutorizacao', 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('RS', 2, 'NfeConsultaProtocolo', 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('RS', 2, 'NfeInutilizacao', 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('RS', 2, 'RecepcaoEvento', 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // RS produção
  row('RS', 1, 'NfeStatusServico', 'https://nfe.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('RS', 1, 'NfeAutorizacao', 'https://nfe.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('RS', 1, 'NfeRetAutorizacao', 'https://nfe.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('RS', 1, 'NfeConsultaProtocolo', 'https://nfe.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('RS', 1, 'NfeInutilizacao', 'https://nfe.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('RS', 1, 'RecepcaoEvento', 'https://nfe.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // SP homologação
  row('SP', 2, 'NfeStatusServico', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('SP', 2, 'NfeAutorizacao', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('SP', 2, 'NfeRetAutorizacao', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('SP', 2, 'NfeConsultaProtocolo', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('SP', 2, 'NfeInutilizacao', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('SP', 2, 'RecepcaoEvento', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // SP produção
  row('SP', 1, 'NfeStatusServico', 'https://nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('SP', 1, 'NfeAutorizacao', 'https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('SP', 1, 'NfeRetAutorizacao', 'https://nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('SP', 1, 'NfeConsultaProtocolo', 'https://nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('SP', 1, 'NfeInutilizacao', 'https://nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('SP', 1, 'RecepcaoEvento', 'https://nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // SVAN homologação
  row('SVAN', 2, 'NfeStatusServico', 'https://hom.sefazvirtual.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('SVAN', 2, 'NfeAutorizacao', 'https://hom.sefazvirtual.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('SVAN', 2, 'NfeRetAutorizacao', 'https://hom.sefazvirtual.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('SVAN', 2, 'NfeConsultaProtocolo', 'https://hom.sefazvirtual.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('SVAN', 2, 'NfeInutilizacao', 'https://hom.sefazvirtual.fazenda.gov.br/NFeInutilizacao4/NFeInutilizacao4.asmx', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('SVAN', 2, 'RecepcaoEvento', 'https://hom.sefazvirtual.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // SVAN produção
  row('SVAN', 1, 'NfeStatusServico', 'https://www.sefazvirtual.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('SVAN', 1, 'NfeAutorizacao', 'https://www.sefazvirtual.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('SVAN', 1, 'NfeRetAutorizacao', 'https://www.sefazvirtual.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('SVAN', 1, 'NfeConsultaProtocolo', 'https://www.sefazvirtual.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('SVAN', 1, 'NfeInutilizacao', 'https://www.sefazvirtual.fazenda.gov.br/NFeInutilizacao4/NFeInutilizacao4.asmx', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('SVAN', 1, 'RecepcaoEvento', 'https://www.sefazvirtual.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // SVRS homologação
  row('SVRS', 2, 'NfeStatusServico', 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('SVRS', 2, 'NfeAutorizacao', 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('SVRS', 2, 'NfeRetAutorizacao', 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('SVRS', 2, 'NfeConsultaProtocolo', 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('SVRS', 2, 'NfeInutilizacao', 'https://nfe-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('SVRS', 2, 'RecepcaoEvento', 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // SVRS produção
  row('SVRS', 1, 'NfeStatusServico', 'https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row('SVRS', 1, 'NfeAutorizacao', 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row('SVRS', 1, 'NfeRetAutorizacao', 'https://nfe.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row('SVRS', 1, 'NfeConsultaProtocolo', 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row('SVRS', 1, 'NfeInutilizacao', 'https://nfe.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row('SVRS', 1, 'RecepcaoEvento', 'https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
];

/**
 * NFC-e 4.00, modelo 65, emissão normal (tpEmis 1). Only SP, the first UF of the NFC-e (kept apart
 * from `ENDPOINTS`, which holds the model 55 rows of every authority).
 *
 * Source (verified 2026-11-26): SEFAZ-SP "Web Services da NFC-e",
 * https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/WebServices.aspx. The SOAP actions are the
 * same as the NF-e ones (same WSDL namespace). A UF only emits after the homologação roteiro.
 */
/* prettier-ignore */
export const ENDPOINTS_65: EndpointRow[] = [
  // SP homologação
  row65('SP', 2, 'NfeStatusServico', 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row65('SP', 2, 'NfeAutorizacao', 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row65('SP', 2, 'NfeRetAutorizacao', 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row65('SP', 2, 'NfeConsultaProtocolo', 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row65('SP', 2, 'NfeInutilizacao', 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row65('SP', 2, 'RecepcaoEvento', 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
  // SP produção
  row65('SP', 1, 'NfeStatusServico', 'https://nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx', '4.00', 'NFeStatusServico4', 'nfeStatusServicoNF'),
  row65('SP', 1, 'NfeAutorizacao', 'https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx', '4.00', 'NFeAutorizacao4', 'nfeAutorizacaoLote'),
  row65('SP', 1, 'NfeRetAutorizacao', 'https://nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx', '4.00', 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote'),
  row65('SP', 1, 'NfeConsultaProtocolo', 'https://nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx', '4.00', 'NFeConsultaProtocolo4', 'nfeConsultaNF'),
  row65('SP', 1, 'NfeInutilizacao', 'https://nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx', '4.00', 'NFeInutilizacao4', 'nfeInutilizacaoNF'),
  row65('SP', 1, 'RecepcaoEvento', 'https://nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx', '1.00', 'NFeRecepcaoEvento4', 'nfeRecepcaoEvento'),
];

export class TableAuthorityEndpointResolver implements AuthorityEndpointResolver {
  constructor(
    private readonly rows: EndpointRow[] = [...ENDPOINTS, ...ENDPOINTS_65],
  ) {}

  resolve(q: AuthorityTarget & { service: SefazService }): AuthorityEndpoint {
    const info = UF_TABLE[q.uf];
    const authority = q.model === 65 ? info?.authorizer65 : info?.authorizer55;
    const found =
      authority !== undefined
        ? this.rows.find(
            (r) =>
              r.authority === authority &&
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
