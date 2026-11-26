import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { S3DocumentStorage } from '@/infra/storage/infra/s3-storage';
import { FakeNfeGateway } from '@/infra/external/nfe/sefaz/fake-nfe.gateway';
import type { SignedNfe } from '@/infra/external/nfe/sefaz/signed-nfe';
import { BillingUsageService } from '@/modules/billing/application/billing-usage.service';
import { TypeOrmBillingRepository } from '@/modules/billing/infra/typeorm-billing.repository';
import type { ApplicationCertificateDecryptor } from '@/modules/certificate/application/certificate-decryptor';
import type { CompanyService } from '@/modules/company/application/company.service';
import type { Company } from '@/modules/company/domain/company';
import type { ICompanyNfeSettingsRepository } from '@/modules/company/domain/company-nfe-settings.repository';
import type { NfeSettings } from '@/modules/company/domain/nfe-settings';
import { TypeOrmCreditTransactionRepository } from '@/modules/credits/infra/typeorm-credit-transaction.repository';
import { DocumentCreditLedger } from '@/modules/fiscal-core/application/document-credit-ledger';
import { FiscalDocumentRegistry } from '@/modules/fiscal-core/application/fiscal-document.registry';
import { FiscalWebhookPublisher } from '@/modules/fiscal-core/application/fiscal-webhook.publisher';
import { NfeEmissionPreconditions } from '@/modules/fiscal-core/application/nfe-emission-preconditions';
import type { GatewayOutcome } from '@/modules/fiscal-core/domain/gateway-outcome';
import type {
  Authorization,
  CancelRequest,
  ConsultResult,
  CorrectionRequest,
  EventReceipt,
  FiscalDocumentGateway,
  InutilizeRequest,
  SigningContext,
} from '@/modules/fiscal-core/domain/ports/gateway.port';
import { FiscalPortalBreaker } from '@/modules/invoice/application/fiscal-portal-breaker';
import { OutboxService } from '@/modules/invoice/application/outbox.service';
import { TypeOrmOutboxRepository } from '@/modules/invoice/infra/typeorm-outbox.repository';
import { OutboxHandlerRegistry } from '@/modules/invoice/application/outbox-handler.registry';
import type { OutboxMessage } from '@/modules/invoice/domain/outbox-message';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { NfeCancelHandler } from '../application/nfe-cancel.handler';
import { NfeCancelService } from '../application/nfe-cancel.service';
import { NfeConsultService } from '../application/nfe-consult.service';
import { NfeCorrectHandler } from '../application/nfe-correct.handler';
import { NfeCorrectService } from '../application/nfe-correct.service';
import { NfeEmailService } from '../application/nfe-email.service';
import { NfePrepareDocumentsHandler } from '../application/nfe-prepare-documents.handler';
import { NfeSendEmailHandler } from '../application/nfe-send-email.handler';
import { DanfeRenderer } from '../infra/danfe/danfe-renderer';
import { NfeEventContext } from '../application/nfe-event-context';
import { NfeEventOutcomeService } from '../application/nfe-event-outcome.service';
import { NfeEventReconcile } from '../application/nfe-event-reconcile';
import { NfeEventSender } from '../application/nfe-event-sender';
import { NfeInutilizeHandler } from '../application/nfe-inutilize.handler';
import { NfeInutilizeService } from '../application/nfe-inutilize.service';
import { NfeTimelineService } from '../application/nfe-timeline.service';
import { NfeEmitHandler } from '../application/nfe-emit.handler';
import { NfeIntakeService } from '../application/nfe-intake.service';
import { NfeOutcomeService } from '../application/nfe-outcome.service';
import { NfePreparation } from '../application/nfe-preparation.service';
import { NfeReconcileHandler } from '../application/nfe-reconcile.handler';
import { NfeResubmitService } from '../application/nfe-resubmit.service';
import { NfeSefazAccess } from '../application/nfe-sefaz-access';
import { NfeTransitionService } from '../application/nfe-transition.service';
import type { NfeInput } from '../domain/nfe-input';
import { TypeOrmNfeDocumentRepository } from '../infra/typeorm-nfe-document.repository';
import { TypeormNfeEvents } from '../infra/typeorm-nfe-events';
import { TypeormNfeInutilizations } from '../infra/typeorm-nfe-inutilizations';
import { NfeNumberGapsQuery } from '../infra/typeorm-nfe-number-gaps.query';
import { TypeormNfeNumbering } from '../infra/typeorm-nfe-numbering';
import { inputFixture } from './draft-fixture';
import { MemoryRedis } from './memory-redis';
import type { PostgresHarness } from './postgres-harness';

/** Hooks a test sets to watch or break the conversation with the (simulated) SEFAZ. */
export interface GatewayHooks {
  beforeIssue?: (doc: SignedNfe) => Promise<void> | void;
  /** Runs after the simulator answered, before the worker sees the answer. */
  afterIssue?: (doc: SignedNfe) => Promise<void> | void;
  /** Replaces the answer of the consultation by key. */
  consult?: (key: string) => GatewayOutcome<ConsultResult>;
  /**
   * Runs before the simulator sees a cancellation, a correction letter or an inutilization; an
   * outcome it returns is the answer and the simulator is not called (the request never "arrived").
   */
  beforeEvent?: (
    kind: 'cancel' | 'correct' | 'inutilize',
    request: CancelRequest | CorrectionRequest | InutilizeRequest,
  ) => GatewayOutcome<EventReceipt> | undefined;
}

export interface DeliveryRecord {
  eventType: string;
  data: Record<string, unknown>;
}

export interface NfeStackOptions {
  /** `NFE_PRODUCTION_ENABLED`: lets a `live` company through (tests of credits). */
  production?: boolean;
  /** A real A1 for the `live` path; the `test` path is simulated and needs none. */
  certificate?: { pfx: Buffer; password: string };
  price?: number;
  /** `uncertainMaxHours`. */
  uncertainMaxHours?: number;
}

const COMPANY_TAX_ID = '11222333000181';

/**
 * Everything the NF-e emission needs, wired by hand around a real PostgreSQL schema: the intake,
 * the emit and reconcile handlers, the transition service, the credit ledger and the simulator. The
 * outside world (company data, certificate, webhook subscriptions) is a stub.
 */
export function createNfeStack(
  h: PostgresHarness,
  options: NfeStackOptions = {},
) {
  const config = new ConfigService({
    NFE_TEST_PROVIDER: 'fake',
    NFE_PRODUCTION_ENABLED: options.production ?? false,
    fiscalPortal: {
      breakerThreshold: 2,
      breakerCooldownMs: 60_000,
      uncertainMaxHours: options.uncertainMaxHours ?? 6,
    },
  });
  const documents = new TypeOrmNfeDocumentRepository(h.helper);
  const billing = new TypeOrmBillingRepository(h.runtime, h.transactions);
  const ledger = new DocumentCreditLedger(
    new BillingUsageService(billing),
    new TypeOrmCreditTransactionRepository(h.helper),
    { priceOf: () => Promise.resolve(options.price ?? 1) },
  );
  const outbox = new OutboxService(
    new TypeOrmOutboxRepository(h.runtime, h.transactions),
  );
  const deliveries: DeliveryRecord[] = [];
  const publisher = new FiscalWebhookPublisher(
    {
      findByTenantIdAndEvent: () =>
        Promise.resolve([
          { id: 'cfg', active: true, url: 'https://hook.test', secret: 's' },
        ]),
    } as never,
    {
      enqueue: (delivery: { eventType: string; payload: { data: object } }) => {
        deliveries.push({
          eventType: delivery.eventType,
          data: delivery.payload.data as Record<string, unknown>,
        });
        return Promise.resolve();
      },
    } as never,
  );
  const cache = { delete: jest.fn().mockResolvedValue(undefined) };
  const transitions = new NfeTransitionService(
    h.unitOfWork,
    billing,
    documents,
    ledger,
    outbox,
    publisher,
    cache as never,
  );
  const redis = new MemoryRedis();
  const breaker = new FiscalPortalBreaker(redis as never, config);
  const outcomes = new NfeOutcomeService(transitions, breaker);

  const company = (environment: ExecutionEnvironment) =>
    ({
      id: environment === 'live' ? h.liveCompanyId : h.companyId,
      tenantId: h.tenantId,
      taxId: COMPANY_TAX_ID,
      legalName: 'Empresa Teste LTDA',
      tradeName: 'Empresa Teste',
      municipalityCode: '3550308',
      addressStreet: 'Avenida Paulista',
      addressNumber: '1000',
      addressDistrict: 'Bela Vista',
      addressZip: '01310-100',
      addressCity: 'São Paulo',
      addressState: 'SP',
      environment,
    }) as unknown as Company;
  const companies = {
    findById: (
      id: string,
      _tenant: string,
      environment: ExecutionEnvironment,
    ) => Promise.resolve(company(environment)),
  } as unknown as CompanyService;
  const settings: NfeSettings = {
    companyId: h.companyId,
    tenantId: h.tenantId,
    stateRegistration: '110042490114',
    crt: 1,
    defaultSeries: 1,
    nfceDefaultSeries: 1,
    defaultNatOp: 'Venda de mercadoria',
    defaultCsosn: '102',
    defaultOrigin: 0,
    defaultPisCst: '49',
    defaultCofinsCst: '49',
    enabledAt: null,
  };
  const settingsRepository = {
    find: () => Promise.resolve(settings),
  } as unknown as ICompanyNfeSettingsRepository;
  // The real preconditions: only the list of released UFs is a stub (everything is released).
  const preconditions = new NfeEmissionPreconditions(config, {
    isEnabled: () => Promise.resolve(true),
  });
  const preparation = new NfePreparation(
    companies,
    settingsRepository,
    preconditions,
  );

  const fake = new FakeNfeGateway(() => new Date());
  const hooks: GatewayHooks = {};
  const gateway: {
    -readonly [
      K in keyof FiscalDocumentGateway<SignedNfe>
    ]: FiscalDocumentGateway<SignedNfe>[K];
  } = {
    type: 'nfe',
    issuer: {
      issue: async (
        doc: SignedNfe,
        ctx: SigningContext,
      ): Promise<GatewayOutcome<Authorization>> => {
        await hooks.beforeIssue?.(doc);
        const outcome = await fake.issuer.issue(doc, ctx);
        await hooks.afterIssue?.(doc);
        return outcome;
      },
    },
    consult: {
      consultByKey: (
        key: string,
        ctx: SigningContext,
      ): Promise<GatewayOutcome<ConsultResult>> =>
        hooks.consult
          ? Promise.resolve(hooks.consult(key))
          : fake.consult.consultByKey(key, ctx),
    },
  };
  const viaHook = <
    R extends CancelRequest | CorrectionRequest | InutilizeRequest,
  >(
    kind: 'cancel' | 'correct' | 'inutilize',
    request: R,
    call: () => Promise<GatewayOutcome<EventReceipt>>,
  ): Promise<GatewayOutcome<EventReceipt>> => {
    const answer = hooks.beforeEvent?.(kind, request);
    return answer ? Promise.resolve(answer) : call();
  };
  gateway.cancel = {
    cancel: (req, ctx) =>
      viaHook('cancel', req, () => fake.cancel.cancel(req, ctx)),
  };
  gateway.correct = {
    correct: (req, ctx) =>
      viaHook('correct', req, () => fake.correct.correct(req, ctx)),
  };
  gateway.inutilize = {
    inutilize: (req, ctx) =>
      viaHook('inutilize', req, () => fake.inutilize.inutilize(req, ctx)),
  };
  const registry = new FiscalDocumentRegistry();
  registry.register(gateway);

  const decryptor = {
    decryptCredentials: () => {
      if (!options.certificate) throw new Error('no certificate in this stack');
      return Promise.resolve({
        pfxBuffer: options.certificate.pfx,
        password: options.certificate.password,
      });
    },
  } as unknown as ApplicationCertificateDecryptor;
  const access = new NfeSefazAccess(config, decryptor);
  const numbering = new TypeormNfeNumbering(h.helper);
  const handlers = new OutboxHandlerRegistry();
  const emit = new NfeEmitHandler(
    handlers,
    registry,
    documents,
    companies,
    settingsRepository,
    numbering,
    access,
    transitions,
    outcomes,
    breaker,
    config,
  );
  const consult = new NfeConsultService(
    documents,
    companies,
    settingsRepository,
    registry,
    access,
    transitions,
    outcomes,
    breaker,
  );
  const events = new TypeormNfeEvents(h.helper);
  const inutilizations = new TypeormNfeInutilizations(h.helper);
  const gaps = new NfeNumberGapsQuery(h.helper);
  const eventContext = new NfeEventContext(
    companies,
    settingsRepository,
    access,
  );
  const eventOutcomes = new NfeEventOutcomeService(
    transitions,
    events,
    publisher,
  );
  const sender = new NfeEventSender(
    registry,
    documents,
    events,
    eventContext,
    access,
    breaker,
    eventOutcomes,
  );
  const eventReconcile = new NfeEventReconcile(
    registry,
    documents,
    events,
    eventContext,
    access,
    breaker,
    eventOutcomes,
  );
  const reconcile = new NfeReconcileHandler(handlers, consult, eventReconcile);
  const cancelService = new NfeCancelService(
    documents,
    eventContext,
    access,
    transitions,
    events,
  );
  const correctService = new NfeCorrectService(
    documents,
    eventContext,
    access,
    transitions,
    events,
  );
  const cancelHandler = new NfeCancelHandler(handlers, sender);
  const correctHandler = new NfeCorrectHandler(handlers, sender);
  const inutilizeService = new NfeInutilizeService(
    eventContext,
    access,
    inutilizations,
    numbering,
    h.unitOfWork,
    outbox,
  );
  const inutilizeHandler = new NfeInutilizeHandler(
    handlers,
    registry,
    inutilizations,
    eventContext,
    access,
    breaker,
    publisher,
    outbox,
    h.unitOfWork,
  );
  const timeline = new NfeTimelineService(documents, events);

  // The storage is the real one (its keys are under test) over an S3 client kept in memory.
  const objects = new Map<string, Buffer | string>();
  const s3 = {
    send: (command: unknown): Promise<unknown> => {
      const input = (
        command as { input: { Key: string; Body?: Buffer | string } }
      ).input;
      if (command instanceof PutObjectCommand) {
        objects.set(input.Key, input.Body as Buffer | string);
        return Promise.resolve({});
      }
      const body = objects.get(input.Key);
      if (command instanceof HeadObjectCommand)
        return body === undefined
          ? Promise.reject(
              Object.assign(new Error('NotFound'), {
                $metadata: { httpStatusCode: 404 },
              }),
            )
          : Promise.resolve({ $metadata: { httpStatusCode: 200 } });
      if (command instanceof GetObjectCommand && body !== undefined)
        return Promise.resolve({
          Body: {
            transformToString: () =>
              Promise.resolve(Buffer.from(body).toString('utf8')),
            transformToByteArray: () =>
              Promise.resolve(Uint8Array.from(Buffer.from(body))),
          },
        });
      return Promise.reject(new Error('NoSuchKey'));
    },
  };
  const storage = new S3DocumentStorage(
    new ConfigService({ 'storage.s3Bucket': 'test-bucket' }),
    s3 as unknown as S3Client,
  );
  const renderer = new DanfeRenderer();
  const prepareHandler = new NfePrepareDocumentsHandler(
    handlers,
    documents,
    storage,
    renderer,
    events,
    inutilizations,
    transitions,
    publisher,
  );
  const mailer = { send: jest.fn().mockResolvedValue({ id: 'mail-1' }) };
  const emailService = new NfeEmailService(
    documents,
    storage,
    {
      findByIdAndTenantId: (
        _id: string,
        _tenant: string,
        env: ExecutionEnvironment,
      ) => Promise.resolve(company(env)),
    } as never,
    transitions,
    publisher,
    mailer as never,
  );
  const sendEmailHandler = new NfeSendEmailHandler(
    handlers,
    emailService,
    config,
  );
  const remembered = jest.fn().mockResolvedValue(undefined);
  const intake = new NfeIntakeService(
    preparation,
    documents,
    h.unitOfWork,
    billing,
    ledger,
    outbox,
    { remember: remembered } as never,
    cache as never,
  );
  const resubmit = new NfeResubmitService(
    documents,
    preparation,
    transitions,
    ledger,
  );

  /** A valid request for this stack's company; `scenario` is the simulator's `cProd` switch. */
  const input = (
    scenario = 'FAKE-100',
    environment: ExecutionEnvironment = 'test',
    overrides: Partial<NfeInput> = {},
  ): NfeInput => {
    const base = inputFixture({ companyId: company(environment).id });
    return {
      ...base,
      items: [{ ...base.items[0], code: scenario }],
      ...overrides,
    };
  };

  const messages = async (
    type?: string,
    aggregateId?: string,
  ): Promise<OutboxMessage[]> => {
    const rows: Array<{
      id: string;
      type: string;
      payload: Record<string, unknown>;
      dedupe_key: string;
      aggregate_id: string;
      environment: string;
      available_at: Date;
    }> = await h.admin.query(
      `SELECT id, type, payload, dedupe_key, aggregate_id, environment, available_at FROM "${h.schema}".outbox_messages
        WHERE tenant_id = $1 ORDER BY created_at, id`,
      [h.tenantId],
    );
    return rows
      .filter((r) => (type ? r.type === type : true))
      .filter((r) => (aggregateId ? r.aggregate_id === aggregateId : true))
      .map((r) => ({
        id: r.id,
        tenantId: h.tenantId,
        environment: r.environment as ExecutionEnvironment,
        type: r.type,
        aggregateId: r.aggregate_id,
        payload: r.payload,
        dedupeKey: r.dedupe_key,
        status: 'pending' as const,
        availableAt: r.available_at,
        leaseUntil: null,
        attempts: 0,
        lastError: null,
      }));
  };

  /**
   * Hands every stored message of `type` (of one aggregate, when given) to its handler, oldest
   * first, like the relay would. Handlers ignore what was already settled, so a message seen twice
   * does nothing the second time.
   */
  const dispatch = async (type: string, aggregateId?: string) => {
    const handlerOf: Record<
      string,
      { handle(m: OutboxMessage): Promise<void> }
    > = {
      'nfe.cancel': cancelHandler,
      'nfe.correct': correctHandler,
      'nfe.inutilize': inutilizeHandler,
      'nfe.reconcile': reconcile,
      'nfe.emit': { handle: (m) => emit.handle(m) },
      'nfe.prepare_documents': prepareHandler,
      'nfe.send_email': sendEmailHandler,
    };
    const found = await messages(type, aggregateId);
    for (const message of found) await handlerOf[type].handle(message);
    return found.length;
  };

  const row = async (id: string): Promise<Record<string, unknown>> => {
    const rows: Array<Record<string, unknown>> = await h.admin.query(
      `SELECT * FROM "${h.schema}".nfe_documents WHERE id = $1`,
      [id],
    );
    return rows[0];
  };

  return {
    config,
    documents,
    billing,
    ledger,
    transitions,
    outcomes,
    breaker,
    redis,
    registry,
    fake,
    hooks,
    access,
    emit,
    reconcile,
    events,
    inutilizations,
    gaps,
    sender,
    eventReconcile,
    cancelService,
    correctService,
    cancelHandler,
    correctHandler,
    inutilizeService,
    inutilizeHandler,
    timeline,
    consult,
    intake,
    resubmit,
    deliveries,
    /** The files of the in-memory storage, by S3 key. */
    objects,
    storage,
    renderer,
    prepareHandler,
    emailService,
    /** The e-mail provider: `send` is a spy that resolves. */
    mailer,
    cache,
    remembered,
    numbering,
    input,
    messages,
    row,
    dispatch,
    /** The settings every company of this stack answers with: a test changes `defaultSeries`. */
    settings,
    company,
    /** Accepts a request and runs the emit message, like the relay would. */
    async issue(
      scenario = 'FAKE-100',
      environment: ExecutionEnvironment = 'test',
      key = `k-${Math.random().toString(36).slice(2)}`,
    ) {
      const accepted = await intake.submit(
        h.tenantId,
        environment,
        input(scenario, environment),
        key,
      );
      await emit.process(accepted.id, h.tenantId, environment);
      return accepted.id;
    },
  };
}

export type NfeStack = ReturnType<typeof createNfeStack>;
