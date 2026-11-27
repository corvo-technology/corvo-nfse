import { XMLParser } from 'fast-xml-parser';
import type { GatewayOutcome } from '@/modules/fiscal-core/domain/gateway-outcome';
import type {
  AuthorityEndpointResolver,
  SefazService,
  TpEmis,
  Uf,
} from '@/modules/fiscal-core/domain/ports/authority.port';
import type {
  CancelCapability,
  ConsultCapability,
  CorrectCapability,
  EventReceipt,
  FiscalDocumentGateway,
  InutilizeCapability,
  InutilizeRequest,
  IssueCapability,
  SigningContext,
} from '@/modules/fiscal-core/domain/ports/gateway.port';
import type {
  LoadedCertificate,
  SchemaId,
  SchemaValidator,
} from '@/modules/fiscal-core/domain/ports/xml.port';
import { endpointTpEmis } from './endpoints';
import { CSTAT_MESSAGES, classifyCstat, explainCstat } from './cstat';
import type { SefazSoapClient, SoapResult } from './soap-client';
import type {
  NfeAuthorization,
  NfeConsultResult,
  NfeEventRecord,
  SignedNfe,
} from './signed-nfe';
import { UF_TABLE, isUf } from './uf';

export interface StatusTarget {
  uf: Uf;
  tpAmb: 1 | 2;
  certificate: LoadedCertificate;
  /** 6 or 7 asks the SVC of the UF; the origin when omitted. */
  tpEmis?: TpEmis;
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
  isArray: (name) => name === 'procEventoNFe',
});

/** How many times the lot is asked about when the authorization is not synchronous. */
const RET_AUTORIZACAO_ATTEMPTS = 3;
const MAX_WAIT_MS = 5000;
const CANCELLATION_EVENT = '110111';
const CORRECTION_EVENT = '110110';
/** cStat of an inutilization that was approved. */
const INUTILIZATION_APPROVED = '102';
/** cStat of a consultation that says the NF-e was cancelled. */
const CANCELLED_CSTATS = new Set(['101', '151', '155']);
/** cStat of a registered event (135 registered, 136 registered without linking, 155 late cancellation). */
const REGISTERED_EVENT_CSTATS = new Set(['135', '136', '155']);

export function consStatServXml(uf: Uf, tpAmb: 1 | 2): string {
  return (
    `<consStatServ xmlns="${NFE_NS}" versao="4.00">` +
    `<tpAmb>${tpAmb}</tpAmb><cUF>${UF_TABLE[uf].cUF}</cUF><xServ>STATUS</xServ>` +
    '</consStatServ>'
  );
}

export function consSitNFeXml(accessKey: string, tpAmb: 1 | 2): string {
  return (
    `<consSitNFe xmlns="${NFE_NS}" versao="4.00">` +
    `<tpAmb>${tpAmb}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${accessKey}</chNFe>` +
    '</consSitNFe>'
  );
}

export function consReciNFeXml(nRec: string, tpAmb: 1 | 2): string {
  return (
    `<consReciNFe xmlns="${NFE_NS}" versao="4.00">` +
    `<tpAmb>${tpAmb}</tpAmb><nRec>${nRec}</nRec>` +
    '</consReciNFe>'
  );
}

/** `idLote` is 15 digits: the timestamp in milliseconds, zero-padded. */
export function enviNFeXml(signedXml: string, idLote: string): string {
  const nfe = signedXml.replace(/^\s*<\?xml[^?]*\?>\s*/, '');
  return (
    `<enviNFe xmlns="${NFE_NS}" versao="4.00">` +
    `<idLote>${idLote}</idLote><indSinc>1</indSinc>${nfe}</enviNFe>`
  );
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : undefined;
}

type Tree = Record<string, unknown>;
const asTree = (value: unknown): Tree | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Tree)
    : undefined;

/** The first `<protNFe>` of the answer, alone and with its own namespace (the nfeProc needs it). */
function protNfeXmlOf(answerXml: string): string | undefined {
  const match = /<protNFe\b[\s\S]*?<\/protNFe>/.exec(answerXml);
  if (!match) return undefined;
  const xml = match[0];
  return /^<protNFe[^>]*\sxmlns=/.test(xml)
    ? xml
    : xml.replace(/^<protNFe/, `<protNFe xmlns="${NFE_NS}"`);
}

function rawEventXmls(answerXml: string): string[] {
  return [
    ...answerXml.matchAll(/<procEventoNFe\b[\s\S]*?<\/procEventoNFe>/g),
  ].map((m) =>
    /^<procEventoNFe[^>]*\sxmlns=/.test(m[0])
      ? m[0]
      : m[0].replace(/^<procEventoNFe/, `<procEventoNFe xmlns="${NFE_NS}"`),
  );
}

/** The registered events of the answer, each with its own `<procEventoNFe>` text. */
function eventsOf(tree: Tree, answerXml: string): NfeEventRecord[] {
  const procs = tree.procEventoNFe;
  if (!Array.isArray(procs)) return [];
  const raw = rawEventXmls(answerXml);
  const events: NfeEventRecord[] = [];
  procs.forEach((proc: unknown, index) => {
    const evento = asTree(asTree(asTree(proc)?.evento)?.infEvento);
    const retorno = asTree(asTree(asTree(proc)?.retEvento)?.infEvento);
    const cStat = text(retorno?.cStat);
    const tpEvento = text(evento?.tpEvento);
    if (!tpEvento || !cStat || !REGISTERED_EVENT_CSTATS.has(cStat)) return;
    events.push({
      tpEvento,
      nSeq: Number(text(evento?.nSeqEvento) ?? 1),
      protocol: text(retorno?.nProt) ?? '',
      procEventoXml: raw[index] ?? '',
    });
  });
  return events;
}

interface Protocol {
  cStat: string;
  xMotivo: string;
  nProt?: string;
  chNFe?: string;
  dhRecbto?: string;
}

function protocolOf(tree: Tree): Protocol | undefined {
  const infProt = asTree(asTree(tree.protNFe)?.infProt);
  const cStat = text(infProt?.cStat);
  if (!infProt || !cStat) return undefined;
  return {
    cStat,
    xMotivo: text(infProt.xMotivo) ?? '',
    nProt: text(infProt.nProt),
    chNFe: text(infProt.chNFe),
    dhRecbto: text(infProt.dhRecbto),
  };
}

function rejection(
  cStat: string,
  xMotivo: string | undefined,
): GatewayOutcome<never> {
  return {
    kind: 'rejected',
    code: cStat,
    message: xMotivo || CSTAT_MESSAGES[cStat] || `Rejeição ${cStat}`,
    hint: explainCstat(cStat),
  };
}

/** The element `name` of an XML text, as written (it keeps inheriting the NF-e namespace of its new parent). */
export function elementXml(xml: string, name: string): string | undefined {
  const open = `<${name}`;
  let from = 0;
  for (;;) {
    const start = xml.indexOf(open, from);
    if (start < 0) return undefined;
    const after = start + open.length;
    // a word boundary after the name: `<NFe` must not match `<NFeProc`
    if (!/\w/.test(xml.charAt(after))) {
      const end = xml.indexOf(`</${name}>`, after);
      return end < 0 ? undefined : xml.slice(start, end + name.length + 3);
    }
    from = start + 1;
  }
}

/** The UF a key belongs to (its first two digits). */
function ufOfKey(key: string): Uf {
  const uf = Object.entries(UF_TABLE).find(
    ([, info]) => info.cUF === key.slice(0, 2),
  )?.[0];
  if (!uf || !isUf(uf)) throw new Error('Access key with an unknown cUF');
  return uf;
}

/**
 * SEFAZ transport for NF-e: service status, authorization (`NFeAutorizacao4`, synchronous, one
 * NF-e per lot), consultation by key (`NFeConsultaProtocolo4`), events (`NFeRecepcaoEvento4`:
 * cancellation and correction letter) and inutilization (`NFeInutilizacao4`). The event and the
 * inutilization arrive already built and signed (the application stores that XML and resends it
 * as is). It never logs a message body (LGPD): the SOAP client logs only authority, duration and
 * outcome.
 */
export class NfeGateway {
  readonly type: 'nfe' | 'nfce';
  private readonly model: 55 | 65;

  /** `options` picks the document type this instance serves: NF-e (model 55) by default, or NFC-e (65). */
  constructor(
    private readonly soap: SefazSoapClient,
    private readonly resolver: AuthorityEndpointResolver,
    private readonly validator: SchemaValidator,
    private readonly timeoutMs: number,
    options: { type?: 'nfe' | 'nfce'; model?: 55 | 65 } = {},
    private readonly clock: () => Date = () => new Date(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.type = options.type ?? 'nfe';
    this.model = options.model ?? (this.type === 'nfce' ? 65 : 55);
  }

  readonly serviceStatus = {
    status: async (
      target: StatusTarget,
    ): Promise<GatewayOutcome<{ up: boolean }>> => {
      const detail = await this.queryStatus(target);
      if (detail.kind !== 'ok') return detail;
      return { kind: 'ok', value: { up: detail.value.up } };
    },
  };

  readonly issuer: IssueCapability<SignedNfe> = {
    issue: (doc, ctx) => this.issue(doc, ctx),
  };

  readonly consult: ConsultCapability = {
    consultByKey: (key, ctx) => this.consultByKey(key, ctx),
  };

  readonly cancel: CancelCapability = {
    cancel: (req, ctx) => this.sendEvent(req.accessKey, req.signedXml, ctx),
  };

  readonly correct: CorrectCapability = {
    correct: (req, ctx) => this.sendEvent(req.accessKey, req.signedXml, ctx),
  };

  readonly inutilize: InutilizeCapability = {
    inutilize: (req, ctx) => this.sendInutilization(req, ctx),
  };

  /** The slice of this gateway the registry stores (the status capability has another shape). */
  asFiscalGateway(): FiscalDocumentGateway<SignedNfe> {
    return {
      type: this.type,
      issuer: this.issuer,
      consult: this.consult,
      cancel: this.cancel,
      // The NFC-e has no correction letter (Ajuste SINIEF 19/2016, cláusula 8ª, §1º).
      ...(this.type === 'nfce' ? {} : { correct: this.correct }),
      inutilize: this.inutilize,
    };
  }

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

    const answer = await this.call(
      target.uf,
      target.tpAmb,
      'NfeStatusServico',
      message,
      target.certificate,
      target.tpEmis,
    );
    return this.toStatus(answer);
  }

  private async issue(
    doc: SignedNfe,
    ctx: SigningContext,
  ): Promise<GatewayOutcome<NfeAuthorization>> {
    const now = this.clock();
    const idLote = String(now.getTime()).padStart(15, '0').slice(-15);
    const message = enviNFeXml(doc.signedXml, idLote);
    const schema = await this.validator.validate(message, 'enviNFe');
    if (!schema.ok)
      // Never reaches the SEFAZ: the builder and the dry-run already pass the same schema.
      return {
        kind: 'rejected',
        code: 'NFE_SCHEMA_INVALID',
        message: schema.errors[0]?.message ?? 'XML fora do layout',
      };

    const answer = await this.call(
      doc.uf,
      ctx.tpAmb,
      'NfeAutorizacao',
      message,
      ctx.certificate,
      endpointTpEmis(doc.accessKey),
    );
    if (answer.kind !== 'ok') return this.communication(answer);
    return this.fromLot(answer.bodyXml, doc, ctx, 1);
  }

  /** Reads `retEnviNFe` / `retConsReciNFe`: lot status first, then the NF-e protocol. */
  private async fromLot(
    answerXml: string,
    doc: SignedNfe,
    ctx: SigningContext,
    round: number,
  ): Promise<GatewayOutcome<NfeAuthorization>> {
    const parsed = parser.parse(answerXml) as Tree;
    const ret = asTree(parsed.retEnviNFe) ?? asTree(parsed.retConsReciNFe);
    const cStat = text(ret?.cStat);
    if (!ret || !cStat) return { kind: 'uncertain', reason: 'server' };

    if (cStat === '104') return this.fromProtocol(ret, answerXml, doc);
    const kind = classifyCstat(cStat);
    if (kind === 'unavailable') return { kind: 'unavailable' };
    if (cStat === '103' || cStat === '105')
      return this.followLot(ret, doc, ctx, round);
    return rejection(cStat, text(ret.xMotivo));
  }

  /** `103` (received) or `105` (processing): ask `NFeRetAutorizacao4` with the receipt number. */
  private async followLot(
    ret: Tree,
    doc: SignedNfe,
    ctx: SigningContext,
    round: number,
  ): Promise<GatewayOutcome<NfeAuthorization>> {
    if (round > RET_AUTORIZACAO_ATTEMPTS)
      return { kind: 'uncertain', reason: 'server' };
    const infRec = asTree(ret.infRec);
    const nRec = text(infRec?.nRec) ?? text(ret.nRec);
    if (!nRec) return { kind: 'uncertain', reason: 'server' };
    const tMed = Number(text(infRec?.tMed) ?? 1);
    await this.sleep(
      Math.min(
        MAX_WAIT_MS,
        Math.max(500, (Number.isNaN(tMed) ? 1 : tMed) * 1000),
      ),
    );
    const answer = await this.call(
      doc.uf,
      ctx.tpAmb,
      'NfeRetAutorizacao',
      consReciNFeXml(nRec, ctx.tpAmb),
      ctx.certificate,
      endpointTpEmis(doc.accessKey),
    );
    if (answer.kind !== 'ok') return this.communication(answer);
    return this.fromLot(answer.bodyXml, doc, ctx, round + 1);
  }

  private fromProtocol(
    ret: Tree,
    answerXml: string,
    doc: SignedNfe,
  ): GatewayOutcome<NfeAuthorization> {
    const protocol = protocolOf(ret);
    if (!protocol) return { kind: 'uncertain', reason: 'server' };
    const kind = classifyCstat(protocol.cStat);
    if (kind === 'authorized') {
      const protNFeXml = protNfeXmlOf(answerXml);
      if (!protocol.nProt || !protNFeXml)
        return { kind: 'uncertain', reason: 'server' };
      const authorizedAt = new Date(protocol.dhRecbto ?? '');
      return {
        kind: 'ok',
        value: {
          accessKey: protocol.chNFe ?? doc.accessKey,
          protocol: protocol.nProt,
          authorizedAt: Number.isNaN(authorizedAt.getTime())
            ? this.clock()
            : authorizedAt,
          cStat: protocol.cStat,
          xMotivo: protocol.xMotivo,
          protNFeXml,
        },
      };
    }
    if (kind === 'denied')
      return {
        kind: 'denied',
        code: protocol.cStat,
        message: protocol.xMotivo || CSTAT_MESSAGES[protocol.cStat],
      };
    if (kind === 'unavailable') return { kind: 'unavailable' };
    // `duplicate` (204) is a rejection here: the handler decides to consult by key.
    return rejection(protocol.cStat, protocol.xMotivo);
  }

  private async consultByKey(
    key: string,
    ctx: SigningContext,
  ): Promise<GatewayOutcome<NfeConsultResult>> {
    const uf = ufOfKey(key);
    const message = consSitNFeXml(key, ctx.tpAmb);
    const schema = await this.validator.validate(message, 'consSitNFe');
    if (!schema.ok)
      throw new Error(
        'consSitNFe failed the XSD (the access key is malformed)',
      );

    const answer = await this.call(
      uf,
      ctx.tpAmb,
      'NfeConsultaProtocolo',
      message,
      ctx.certificate,
      endpointTpEmis(key),
    );
    if (answer.kind !== 'ok') return this.communication(answer);
    return this.toConsult(answer.bodyXml, key);
  }

  /** `retEnvEvento`: lot 128 and then the status of the one event; 135/136/155 registered it. */
  private async sendEvent(
    accessKey: string,
    signedXml: string | undefined,
    ctx: SigningContext,
  ): Promise<GatewayOutcome<EventReceipt>> {
    if (!signedXml) throw new Error('The event needs its signed XML');
    const schemaId: SchemaId = signedXml.includes(
      `<tpEvento>${CORRECTION_EVENT}</tpEvento>`,
    )
      ? 'envCCe'
      : 'envEvento';
    const schema = await this.validator.validate(signedXml, schemaId);
    if (!schema.ok)
      // Never reaches the SEFAZ: the builder output already passes the same schema.
      return {
        kind: 'rejected',
        code: 'NFE_SCHEMA_INVALID',
        message: schema.errors[0]?.message ?? 'XML fora do layout',
      };
    const answer = await this.call(
      ufOfKey(accessKey),
      ctx.tpAmb,
      'RecepcaoEvento',
      signedXml,
      ctx.certificate,
      endpointTpEmis(accessKey),
    );
    if (answer.kind !== 'ok') return this.communication(answer);

    const ret = asTree((parser.parse(answer.bodyXml) as Tree).retEnvEvento);
    const lotStat = text(ret?.cStat);
    if (!ret || !lotStat) return { kind: 'uncertain', reason: 'server' };
    if (classifyCstat(lotStat) === 'unavailable')
      return { kind: 'unavailable' };
    // 128 is "lot processed"; any other lot code is a rejection of the whole request.
    if (lotStat !== '128') return rejection(lotStat, text(ret.xMotivo));

    const info = asTree(asTree(ret.retEvento)?.infEvento);
    const cStat = text(info?.cStat);
    if (!info || !cStat) return { kind: 'uncertain', reason: 'server' };
    if (classifyCstat(cStat) === 'unavailable') return { kind: 'unavailable' };
    if (!REGISTERED_EVENT_CSTATS.has(cStat))
      return rejection(cStat, text(info.xMotivo));
    const protocol = text(info.nProt);
    if (!protocol) return { kind: 'uncertain', reason: 'server' };
    const evento = elementXml(signedXml, 'evento');
    const retEvento = elementXml(answer.bodyXml, 'retEvento');
    const registeredAt = new Date(text(info.dhRegEvento) ?? '');
    return {
      kind: 'ok',
      value: {
        protocol,
        cStat,
        xMotivo: text(info.xMotivo) ?? CSTAT_MESSAGES[cStat],
        procXml:
          evento && retEvento
            ? `<procEventoNFe xmlns="${NFE_NS}" versao="1.00">${evento}${retEvento}</procEventoNFe>`
            : undefined,
        registeredAt: Number.isNaN(registeredAt.getTime())
          ? this.clock()
          : registeredAt,
      },
    };
  }

  /** `retInutNFe`: 102 approved. Anything else is a rejection (563 and 206 are told apart by the caller). */
  private async sendInutilization(
    req: InutilizeRequest,
    ctx: SigningContext,
  ): Promise<GatewayOutcome<EventReceipt>> {
    if (!req.signedXml)
      throw new Error('The inutilization needs its signed XML');
    if (!isUf(req.uf)) throw new Error('Unknown UF');
    const schema = await this.validator.validate(req.signedXml, 'inutNFe');
    if (!schema.ok)
      return {
        kind: 'rejected',
        code: 'NFE_SCHEMA_INVALID',
        message: schema.errors[0]?.message ?? 'XML fora do layout',
      };
    const answer = await this.call(
      req.uf,
      ctx.tpAmb,
      'NfeInutilizacao',
      req.signedXml,
      ctx.certificate,
    );
    if (answer.kind !== 'ok') return this.communication(answer);

    const info = asTree(
      asTree((parser.parse(answer.bodyXml) as Tree).retInutNFe)?.infInut,
    );
    const cStat = text(info?.cStat);
    if (!info || !cStat) return { kind: 'uncertain', reason: 'server' };
    if (classifyCstat(cStat) === 'unavailable') return { kind: 'unavailable' };
    if (cStat !== INUTILIZATION_APPROVED)
      return rejection(cStat, text(info.xMotivo));
    const protocol = text(info.nProt);
    if (!protocol) return { kind: 'uncertain', reason: 'server' };
    const inut = elementXml(req.signedXml, 'inutNFe');
    const ret = elementXml(answer.bodyXml, 'retInutNFe');
    const registeredAt = new Date(text(info.dhRecbto) ?? '');
    return {
      kind: 'ok',
      value: {
        protocol,
        cStat,
        xMotivo: text(info.xMotivo) ?? '',
        procXml:
          inut && ret
            ? `<ProcInutNFe xmlns="${NFE_NS}" versao="4.00">${inut}${ret}</ProcInutNFe>`
            : undefined,
        registeredAt: Number.isNaN(registeredAt.getTime())
          ? this.clock()
          : registeredAt,
      },
    };
  }

  private toConsult(
    answerXml: string,
    key: string,
  ): GatewayOutcome<NfeConsultResult> {
    const ret = asTree((parser.parse(answerXml) as Tree).retConsSitNFe);
    const cStat = text(ret?.cStat);
    if (!ret || !cStat) return { kind: 'uncertain', reason: 'server' };
    const xMotivo = text(ret.xMotivo) ?? CSTAT_MESSAGES[cStat] ?? '';
    const base = { accessKey: key, cStat, xMotivo, events: [] };
    const kind = classifyCstat(cStat);

    if (kind === 'unavailable') return { kind: 'unavailable' };
    if (kind === 'not_found')
      return { kind: 'ok', value: { ...base, status: 'not_found' } };
    if (kind === 'processing')
      return { kind: 'ok', value: { ...base, status: 'pending' } };
    if (kind === 'denied')
      return {
        kind: 'ok',
        value: { ...base, status: 'denied', protocol: protocolOf(ret)?.nProt },
      };

    const protocol = protocolOf(ret);
    const events = eventsOf(ret, answerXml);
    const cancelled =
      CANCELLED_CSTATS.has(cStat) ||
      events.some((e) => e.tpEvento === CANCELLATION_EVENT);
    if (kind === 'authorized' || cancelled) {
      const protNFeXml = protNfeXmlOf(answerXml);
      if (!protocol?.nProt || !protNFeXml)
        return { kind: 'uncertain', reason: 'server' };
      const authorizedAt = new Date(protocol.dhRecbto ?? '');
      const authorization: NfeAuthorization = {
        accessKey: key,
        protocol: protocol.nProt,
        authorizedAt: Number.isNaN(authorizedAt.getTime())
          ? this.clock()
          : authorizedAt,
        cStat: protocol.cStat,
        xMotivo: protocol.xMotivo,
        protNFeXml,
      };
      return {
        kind: 'ok',
        value: {
          ...base,
          status: cancelled ? 'cancelled' : 'authorized',
          protocol: protocol.nProt,
          xml: protNFeXml,
          authorization,
          events,
        },
      };
    }
    // Any other answer (a malformed key, another UF...) is a rejection of the question.
    return rejection(cStat, xMotivo);
  }

  /** `tpEmis` 6 and 7 (read from the key of the note) go to the SVC; the rest to the origin. */
  private call(
    uf: Uf,
    tpAmb: 1 | 2,
    service: SefazService,
    bodyXml: string,
    certificate: LoadedCertificate,
    tpEmis: TpEmis = 1,
  ): Promise<SoapResult> {
    const endpoint = this.resolver.resolve({
      uf,
      tpAmb,
      model: this.model,
      tpEmis,
      service,
    });
    return this.soap.call({
      endpoint,
      bodyXml,
      certificate,
      timeoutMs: this.timeoutMs,
    });
  }

  private communication(
    answer: Exclude<SoapResult, { kind: 'ok' }>,
  ): GatewayOutcome<never> {
    return answer.kind === 'unavailable'
      ? { kind: 'unavailable' }
      : { kind: 'uncertain', reason: answer.reason };
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
