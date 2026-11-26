import { XMLParser } from 'fast-xml-parser';
import type { GatewayOutcome } from '@/modules/fiscal-core/domain/gateway-outcome';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import type { AuthorityEndpointResolver } from '@/modules/fiscal-core/domain/ports/authority.port';
import type {
  LoadedCertificate,
  SchemaValidator,
} from '@/modules/fiscal-core/domain/ports/xml.port';
import { UF_TABLE } from './uf';
import type { SefazSoapClient, SoapResult } from './soap-client';

export interface StatusTarget {
  uf: Uf;
  tpAmb: 1 | 2;
  certificate: LoadedCertificate;
}

export interface StatusDetail {
  up: boolean;
  cStat: string;
  xMotivo: string;
  /** Average answer time in seconds, when the SEFAZ reports it. */
  tMed?: string;
}

const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const parser = new XMLParser({
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreAttributes: true,
});

export function consStatServXml(uf: Uf, tpAmb: 1 | 2): string {
  return (
    `<consStatServ xmlns="${NFE_NS}" versao="4.00">` +
    `<tpAmb>${tpAmb}</tpAmb><cUF>${UF_TABLE[uf].cUF}</cUF><xServ>STATUS</xServ>` +
    '</consStatServ>'
  );
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : undefined;
}

/**
 * SEFAZ transport for NF-e. In this PR only the service status exists (the spike); authorization,
 * consultation and events arrive in PR 4 and PR 5.
 */
export class NfeGateway {
  constructor(
    private readonly soap: SefazSoapClient,
    private readonly resolver: AuthorityEndpointResolver,
    private readonly validator: SchemaValidator,
    private readonly timeoutMs: number,
  ) {}

  readonly serviceStatus = {
    status: async (
      target: StatusTarget,
    ): Promise<GatewayOutcome<{ up: boolean }>> => {
      const detail = await this.queryStatus(target);
      if (detail.kind !== 'ok') return detail;
      return { kind: 'ok', value: { up: detail.value.up } };
    },
  };

  /** Same call with the cStat/xMotivo/tMed the spike prints (never the XML). */
  async queryStatus(
    target: StatusTarget,
  ): Promise<GatewayOutcome<StatusDetail>> {
    const message = consStatServXml(target.uf, target.tpAmb);
    const schema = await this.validator.validate(message, 'consStatServ');
    if (!schema.ok)
      // Our own fixed message failed the schema: a bug, not a business result.
      throw new Error(
        `consStatServ failed the XSD: ${schema.errors.map((e) => e.message).join('; ')}`,
      );

    const endpoint = this.resolver.resolve({
      uf: target.uf,
      tpAmb: target.tpAmb,
      model: 55,
      tpEmis: 1,
      service: 'NfeStatusServico',
    });
    const answer = await this.soap.call({
      endpoint,
      bodyXml: message,
      certificate: target.certificate,
      timeoutMs: this.timeoutMs,
    });
    return this.toStatus(answer);
  }

  private toStatus(answer: SoapResult): GatewayOutcome<StatusDetail> {
    if (answer.kind === 'unavailable') return { kind: 'unavailable' };
    if (answer.kind === 'uncertain')
      return { kind: 'uncertain', reason: answer.reason };

    const parsed = parser.parse(answer.bodyXml) as {
      retConsStatServ?: Record<string, unknown>;
    };
    const ret = parsed.retConsStatServ;
    const cStat = text(ret?.cStat);
    if (!ret || !cStat) return { kind: 'uncertain', reason: 'server' };
    return {
      kind: 'ok',
      value: {
        up: cStat === '107',
        cStat,
        xMotivo: text(ret.xMotivo) ?? '',
        tMed: text(ret.tMed),
      },
    };
  }
}
