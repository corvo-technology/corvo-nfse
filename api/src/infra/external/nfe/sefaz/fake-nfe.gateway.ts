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

  constructor(private readonly now: () => Date = () => new Date()) {}

  readonly issuer: IssueCapability<SignedNfe> = {
    issue: (doc) => Promise.resolve(this.issueSync(doc)),
  };

  readonly consult: ConsultCapability = {
    consultByKey: (key) => Promise.resolve(this.consultSync(key)),
  };

  readonly cancel: CancelCapability = {
    cancel: (req: CancelRequest) =>
      Promise.resolve(this.event(req.accessKey, req.justification)),
  };

  readonly correct: CorrectCapability = {
    correct: (req: CorrectionRequest) =>
      Promise.resolve(this.event(req.accessKey, req.correction)),
  };

  readonly inutilize: InutilizeCapability = {
    inutilize: (req: InutilizeRequest) =>
      Promise.resolve(this.event(undefined, req.justification)),
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
      return {
        kind: 'ok',
        value: {
          status: 'authorized',
          accessKey: key,
          protocol: authorization.protocol,
          cStat: authorization.cStat,
          xMotivo: authorization.xMotivo,
          xml: authorization.protNFeXml,
          authorization,
          events: [],
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
  ): GatewayOutcome<EventReceipt> {
    const scenario = accessKey
      ? this.store.get(accessKey)?.scenario
      : undefined;
    if (scenario === 'FAKE-EVT-REJ' || text.includes('FAKE-EVT-REJ'))
      return this.rejection('573');
    return {
      kind: 'ok',
      value: {
        protocol: `1352${(accessKey ?? '0'.repeat(44)).slice(-11)}`,
        cStat: '135',
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
