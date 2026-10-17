import { renderInvoicePdf } from '@/modules/invoice/infra/danfse/danfse';
import { NFSE_TEST_DISCLAIMER } from '@/shared/fiscal/nfse-constants';
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { buildDps, buildDpsXml, parseNfseXml, Ambiente } from 'open-nfse';
import type {
  FiscalProvider,
  IIssuePayload,
  FiscalIssueResult,
  FiscalQueryResult,
} from './nfse-fiscal-provider';
import { issueParams } from './issue-params';

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Offline simulation with complete XML for the real PDF renderer. */
@Injectable()
export class FakeNfseProvider implements FiscalProvider {
  // The provider contract is asynchronous; simulation only performs local work.
  // eslint-disable-next-line @typescript-eslint/require-await
  async issue(payload: IIssuePayload): Promise<FiscalIssueResult> {
    if (payload.environment !== 'test')
      throw new Error('Simulation is available only in test');
    const params = issueParams(payload);
    const dps =
      payload.preparedDps ??
      buildDps({
        ...params,
        nDPS: params.nDPS!,
        skipCpfCnpjValidation: true,
      });
    const dpsXml = buildDpsXml(dps).replace(/<\?xml[^?]*\?>\s*/, '');
    const digits = createHash('sha256')
      .update(`${payload.tenantId}/${payload.invoiceId}/${dps.infDPS.Id}`)
      .digest('hex')
      .split('')
      .map((c) => String(parseInt(c, 16) % 10))
      .join('');
    const accessKey = digits.slice(0, 50);
    const nfseNumber = payload.number ?? 1;
    // The real Sefin returns the computed ISS; the simulation mirrors it when a rate is known.
    const issRate = payload.valores.aliqIss;
    const issValues =
      issRate === undefined
        ? ''
        : `<vBC>${payload.valores.vServ.toFixed(2)}</vBC><pAliqAplic>${issRate.toFixed(2)}</pAliqAplic><vISSQN>${((payload.valores.vServ * issRate) / 100).toFixed(2)}</vISSQN>`;
    const xmlAuthorized = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${accessKey}">
<xLocEmi>Simulação</xLocEmi><xLocPrestacao>Simulação</xLocPrestacao><nNFSe>${nfseNumber}</nNFSe><xTribNac>${escapeXml(payload.servico.descricao)}</xTribNac><verAplic>Corvo-test-simulation</verAplic><ambGer>2</ambGer><tpEmis>1</tpEmis><cStat>100</cStat><dhProc>${params.dhEmi!.toISOString()}</dhProc><nDFSe>${nfseNumber}</nDFSe>
<emit><CNPJ>${escapeXml(payload.emitente.cnpj)}</CNPJ><xNome>${escapeXml(payload.emitente.legalName ?? 'Empresa de teste')}</xNome><enderNac><xLgr>Simulação</xLgr><nro>1</nro><xBairro>Simulação</xBairro><cMun>${escapeXml(payload.emitente.codMunicipio)}</cMun><UF>SP</UF><CEP>00000000</CEP></enderNac></emit>
<valores>${issValues}<vLiq>${payload.valores.vServ.toFixed(2)}</vLiq></valores><xOutInf>${NFSE_TEST_DISCLAIMER}</xOutInf>${dpsXml}</infNFSe>
<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><Reference URI="#NFS${accessKey}"><DigestValue>SIMULATION</DigestValue></Reference></SignedInfo><SignatureValue>SIMULATION</SignatureValue><KeyInfo><X509Data><X509Certificate>SIMULATION</X509Certificate></X509Data></KeyInfo></Signature></NFSe>`;
    parseNfseXml(xmlAuthorized);
    return {
      success: true,
      accessKey,
      nfseNumber,
      xmlAuthorized,
      requiresReconciliation: false,
    };
  }
  async queryByAccessKey(
    key: string,
    environment: 'test' | 'live',
    credentials?: IIssuePayload,
  ): Promise<FiscalQueryResult> {
    if (!credentials) return { status: 'not_found' };
    const result = await this.issue({ ...credentials, environment });
    return result.accessKey === key
      ? { ...result, status: 'authorized' }
      : { status: 'not_found' };
  }
  async retrievePdf(
    key: string,
    environment: 'test' | 'live',
    credentials?: IIssuePayload,
  ): Promise<Buffer> {
    const result = await this.queryByAccessKey(key, environment, credentials);
    if (!result.xmlAuthorized) throw new Error('Invoice not found');
    return renderInvoicePdf(
      parseNfseXml(result.xmlAuthorized),
      {
        ambiente: Ambiente.ProducaoRestrita,
        observacoes: NFSE_TEST_DISCLAIMER,
      },
      { notes: [NFSE_TEST_DISCLAIMER] },
    );
  }
}
