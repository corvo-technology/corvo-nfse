import type { DocumentType } from '@/modules/fiscal-core/domain/document-type';
import type { GatewayOutcome } from '@/modules/fiscal-core/domain/gateway-outcome';
import type {
  CancelCapability,
  CancelRequest,
  ConsultCapability,
  CorrectCapability,
  CorrectionRequest,
  EventReceipt,
  FiscalDocumentGateway,
  InutilizeCapability,
  InutilizeRequest,
  IssueCapability,
  ServiceStatusCapability,
} from '@/modules/fiscal-core/domain/ports/gateway.port';
import { CSTAT_MESSAGES, explainCstat } from './cstat';
import type {
  NfeAuthorization,
  NfeConsultResult,
  NfeEventRecord,
  SignedNfe,
} from './signed-nfe';

/**
 * Simulated NF-e gateway for tests and local development. The scenario comes from the first
 * `<cProd>` of the signed XML (design spec 9.1):
 *
 *  - FAKE-100 (default): authorized.
 *  - FAKE-302: denied.
 *  - FAKE-225, FAKE-539, FAKE-778: rejected with that code.
 *  - FAKE-TIMEOUT: the send times out (`uncertain`), but the SEFAZ had authorized it, so the next
 *    consultation returns the authorization (the "lost response" case).
 *  - FAKE-204: duplicate. Issue answers `rejected` with code 204 and a hint to consult; the
 *    consultation returns the original authorization.
 *  - FAKE-108: the service is down (`unavailable`).
 *  - FAKE-EVT-REJ: the event services (cancel, CC-e, inutilization) answer `rejected` 573.
 *  - FAKE-EVT-TIMEOUT in the justification or correction text: the event is registered, but the
 *    answer is lost (`uncertain`); the consultation by key then shows it (`procEventoNFe`).
 *
 * A registered event is remembered: a repeated one (same key, type and sequence) is rejected 573,
 * and the consultation lists the events (and says `cancelled` after a cancellation). A repeated
 * inutilization of the same range is rejected 563, like the real service.
 */
type Stored =
  | { state: 'authorized'; scenario: string; authorization: NfeAuthorization }
  | { state: 'denied'; scenario: string; cStat: string }
  | { state: 'rejected'; scenario: string; cStat: string };

const REJECTING: Record<string, string> = {
  'FAKE-225': '225',
  'FAKE-539': '539',
  'FAKE-778': '778',
};

export class FakeNfeGateway implements FiscalDocumentGateway<SignedNfe> {
  readonly type: DocumentType = 'nfe';
  private readonly store = new Map<string, Stored>();
  private readonly events = new Map<string, NfeEventRecord[]>();
  private readonly inutilized = new Set<string>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  readonly issuer: IssueCapability<SignedNfe> = {
    issue: (doc) => Promise.resolve(this.issueSync(doc)),
  };

  readonly consult: ConsultCapability = {
    consultByKey: (key) => Promise.resolve(this.consultSync(key)),
  };

  readonly cancel: CancelCapability = {
    cancel: (req: CancelRequest) =>
      Promise.resolve(
        this.event(req.accessKey, req.justification, req.signedXml),
      ),
  };

  readonly correct: CorrectCapability = {
    correct: (req: CorrectionRequest) =>
      Promise.resolve(this.event(req.accessKey, req.correction, req.signedXml)),
  };

  readonly inutilize: InutilizeCapability = {
    inutilize: (req: InutilizeRequest) =>
      Promise.resolve(this.inutilization(req)),
  };

  readonly serviceStatus: ServiceStatusCapability = {
    status: () => Promise.resolve({ kind: 'ok', value: { up: true } }),
  };

  private issueSync(doc: SignedNfe): GatewayOutcome<NfeAuthorization> {
    const scenario = scenarioOf(doc.signedXml);
    const key = doc.accessKey;

    if (scenario === 'FAKE-108') return { kind: 'unavailable' };

    if (scenario === 'FAKE-302') {
      this.store.set(key, { state: 'denied', scenario, cStat: '302' });
      return {
        kind: 'denied',
        code: '302',
        message: CSTAT_MESSAGES['302'],
      };
    }

    const rejectCode = REJECTING[scenario];
    if (rejectCode) {
      this.store.set(key, { state: 'rejected', scenario, cStat: rejectCode });
      return this.rejection(rejectCode);
    }

    // FAKE-100, FAKE-TIMEOUT, FAKE-204, FAKE-EVT-REJ: the SEFAZ authorizes the document.
    const existing = this.store.get(key);
    const authorization =
      existing?.state === 'authorized'
        ? existing.authorization
        : this.authorize(doc);
    this.store.set(key, { state: 'authorized', scenario, authorization });

    if (scenario === 'FAKE-TIMEOUT')
      return { kind: 'uncertain', reason: 'timeout' };
    if (scenario === 'FAKE-204') return this.rejection('204');
    return { kind: 'ok', value: authorization };
  }

  private consultSync(key: string): GatewayOutcome<NfeConsultResult> {
    const stored = this.store.get(key);
    if (stored?.state === 'authorized') {
      const { authorization } = stored;
      const events = this.events.get(key) ?? [];
      const cancelled = events.some((e) => e.tpEvento === '110111');
      return {
        kind: 'ok',
        value: {
          status: cancelled ? 'cancelled' : 'authorized',
          accessKey: key,
          protocol: authorization.protocol,
          cStat: cancelled ? '101' : authorization.cStat,
          xMotivo: authorization.xMotivo,
          xml: authorization.protNFeXml,
          authorization,
          events,
        },
      };
    }
    if (stored?.state === 'denied') {
      return {
        kind: 'ok',
        value: {
          status: 'denied',
          accessKey: key,
          cStat: stored.cStat,
          xMotivo: CSTAT_MESSAGES[stored.cStat],
          events: [],
        },
      };
    }
    // A rejected note never reached the base: the SEFAZ answers 217 for it, like for an unknown key.
    return {
      kind: 'ok',
      value: {
        status: 'not_found',
        accessKey: key,
        cStat: '217',
        xMotivo: CSTAT_MESSAGES['217'],
        events: [],
      },
    };
  }

  private event(
    accessKey: string | undefined,
    text: string,
    signedXml?: string,
  ): GatewayOutcome<EventReceipt> {
    const scenario = accessKey
      ? this.store.get(accessKey)?.scenario
      : undefined;
    if (scenario === 'FAKE-EVT-REJ' || text.includes('FAKE-EVT-REJ'))
      return this.rejection('573');
    const key = accessKey ?? '0'.repeat(44);
    const tpEvento = /<tpEvento>(\d{6})<\/tpEvento>/.exec(signedXml ?? '')?.[1];
    const nSeq = Number(
      /<nSeqEvento>(\d+)<\/nSeqEvento>/.exec(signedXml ?? '')?.[1] ?? 1,
    );
    const protocol = `1352${key.slice(-11)}${nSeq}`;
    if (tpEvento) {
      const known = this.events.get(key) ?? [];
      if (known.some((e) => e.tpEvento === tpEvento && e.nSeq === nSeq))
        return this.rejection('573');
      this.events.set(key, [
        ...known,
        {
          tpEvento,
          nSeq,
          protocol,
          procEventoXml: `<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">${signedXml ?? ''}</procEventoNFe>`,
        },
      ]);
    }
    if (text.includes('FAKE-EVT-TIMEOUT'))
      return { kind: 'uncertain', reason: 'timeout' };
    return {
      kind: 'ok',
      value: {
        protocol,
        cStat: '135',
        xMotivo: CSTAT_MESSAGES['135'],
        procXml: `<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">${signedXml ?? ''}</procEventoNFe>`,
        registeredAt: this.now(),
      },
    };
  }

  private inutilization(req: InutilizeRequest): GatewayOutcome<EventReceipt> {
    if (req.justification.includes('FAKE-EVT-REJ'))
      return this.rejection('573');
    const range = `${req.series}:${req.startNumber}-${req.endNumber}`;
    if (this.inutilized.has(range)) return this.rejection('563');
    this.inutilized.add(range);
    if (req.justification.includes('FAKE-EVT-TIMEOUT'))
      return { kind: 'uncertain', reason: 'timeout' };
    return {
      kind: 'ok',
      value: {
        protocol: `1352${String(req.startNumber).padStart(11, '0')}`,
        cStat: '102',
        xMotivo: CSTAT_MESSAGES['102'],
        procXml: `<ProcInutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${req.signedXml ?? ''}</ProcInutNFe>`,
        registeredAt: this.now(),
      },
    };
  }

  private authorize(doc: SignedNfe): NfeAuthorization {
    const protocol = `135${doc.accessKey.slice(0, 12)}`;
    const authorizedAt = this.now();
    return {
      accessKey: doc.accessKey,
      protocol,
      authorizedAt,
      cStat: '100',
      xMotivo: CSTAT_MESSAGES['100'],
      protNFeXml: `<protNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${doc.accessKey}</chNFe><nProt>${protocol}</nProt><cStat>100</cStat><xMotivo>${CSTAT_MESSAGES['100']}</xMotivo></infProt></protNFe>`,
    };
  }

  private rejection(code: string): GatewayOutcome<never> {
    return {
      kind: 'rejected',
      code,
      message: CSTAT_MESSAGES[code] ?? `Rejeição ${code}`,
      hint: explainCstat(code),
    };
  }
}

function scenarioOf(signedXml: string): string {
  return /<cProd>([^<]*)<\/cProd>/.exec(signedXml)?.[1] ?? 'FAKE-100';
}
