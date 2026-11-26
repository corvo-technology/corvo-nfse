/**
 * Response schemas of the public API that have no DTO class (the controllers
 * return domain objects or plain objects). They are written by hand from what
 * each route really returns, so SDK generators get typed responses.
 *
 * Naming: a field is `camelCase` except in billing, schedules and imports,
 * which answer in `snake_case` (kept as is: renaming would break clients).
 */
type Schema = Record<string, unknown>;

const str = (extra: Schema = {}): Schema => ({ type: 'string', ...extra });
const int = (extra: Schema = {}): Schema => ({ type: 'integer', ...extra });
const num = (extra: Schema = {}): Schema => ({ type: 'number', ...extra });
const bool = (extra: Schema = {}): Schema => ({ type: 'boolean', ...extra });
const uuid = (extra: Schema = {}): Schema => str({ format: 'uuid', ...extra });
const dateTime = (extra: Schema = {}): Schema =>
  str({ format: 'date-time', ...extra });
const date = (extra: Schema = {}): Schema =>
  str({ format: 'date', example: '2026-11-24', ...extra });
const nullable = (schema: Schema): Schema => ({ ...schema, nullable: true });
const ref = (name: string): Schema => ({
  $ref: `#/components/schemas/${name}`,
});
const array = (items: Schema, extra: Schema = {}): Schema => ({
  type: 'array',
  items,
  ...extra,
});
/** An object whose listed properties are all present, unless named in `optional`. */
function obj(
  properties: Record<string, Schema>,
  optional: string[] = [],
  extra: Schema = {},
): Schema {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties).filter((key) => !optional.includes(key)),
    ...extra,
  };
}

const TAX_REGIME_KINDS = [
  'MEI',
  'SIMPLES_NACIONAL',
  'LUCRO_PRESUMIDO',
  'LUCRO_REAL',
  'OUTRO_REGIME',
  'UNKNOWN',
];
const REVIEW_STATUS = ['unreviewed', 'approved', 'rejected'];

/** Every error code the API can return in `code`, grouped by where it comes from. */
export const API_ERROR_CODES = [
  'ERROR_BAD_REQUEST',
  'ERROR_UNAUTHORIZED',
  'ERROR_PAYMENT_REQUIRED',
  'ERROR_FORBIDDEN',
  'ERROR_NOT_FOUND',
  'ERROR_METHOD_NOT_ALLOWED',
  'ERROR_CONFLICT',
  'ERROR_GONE',
  'ERROR_PAYLOAD_TOO_LARGE',
  'ERROR_UNSUPPORTED_MEDIA_TYPE',
  'ERROR_UNPROCESSABLE_ENTITY',
  'ERROR_RATE_LIMIT_EXCEEDED',
  'ERROR_INTERNAL',
  'ERROR_BAD_GATEWAY',
  'ERROR_SERVICE_UNAVAILABLE',
  'ERROR_GATEWAY_TIMEOUT',
  'ERROR_VALIDATION',
  'ERROR_INVALID_JSON',
  'ERROR_INVALID_CURSOR',
  'ERROR_INVALID_LIMIT',
  'ERROR_UNKNOWN_FIELD',
  'ERROR_PERMISSION_DENIED',
  'ERROR_COMPANY_NOT_FOUND',
  'ERROR_COMPANY_NOT_READY',
  'ERROR_COMPANY_BLOCKED',
  'ERROR_COMPANY_ALREADY_EXISTS',
  'ERROR_INVOICE_NOT_FOUND',
  'ERROR_INVALID_INVOICE_TRANSITION',
  'ERROR_CONCURRENT_INVOICE_TRANSITION',
  'ERROR_INVOICE_NOT_CANCELLABLE',
  'ERROR_INVOICE_NOT_SUBSTITUTABLE',
  'ERROR_INVALID_CANCELLATION_REASON',
  'ERROR_IDEMPOTENCY_CONFLICT',
  'ERROR_DUPLICATE_IDEMPOTENCY_KEY_IN_BATCH',
  'ERROR_CERTIFICATE_NOT_FOUND',
  'ERROR_CERTIFICATE_INVALID',
  'ERROR_CERTIFICATE_EXPIRED',
  'ERROR_CERTIFICATE_TAX_ID_MISMATCH',
  'ERROR_INSUFFICIENT_CREDITS',
  'ERROR_QUOTA_EXCEEDED',
  'ERROR_MONTHLY_LIMIT_EXCEEDED',
  'ERROR_DAILY_LIMIT_EXCEEDED',
  'ERROR_PLAN_BLOCKED',
  'ERROR_SCHEDULE_NOT_FOUND',
  'ERROR_SCHEDULE_STATE',
  'ERROR_SCHEDULE_LIMIT',
  'ERROR_IMPORT_NOT_FOUND',
  'ERROR_IMPORT_STATE',
  'ERROR_IMPORT_EMPTY',
  'ERROR_IMPORT_FILE_INVALID',
  'ERROR_IMPORT_FILE_TOO_LARGE',
  'ERROR_IMPORT_TOO_MANY_ROWS',
  'ERROR_IMPORT_UNREADABLE',
  'ERROR_IMPORT_COMPANY_REQUIRED',
  'ERROR_IMPORT_COMPANY_NOT_FOUND',
  'ERROR_IMPORT_COMPANY_MISMATCH',
  'ERROR_IMPORT_EMIT_FAILED',
  'ERROR_TAX_CALCULATION_UNAVAILABLE',
  'ERROR_TAX_REGIME_NOT_SUPPORTED',
  'ERROR_SERVER_BUSY',
] as const;

export const COMPONENT_SCHEMAS: Record<string, Schema> = {
  ApiErrorCode: str({
    enum: [...API_ERROR_CODES],
    description:
      'Error codes that start with `ERROR_`. The list can grow: treat an unknown code as its HTTP status. Some routes also answer with a feature code without the prefix (for example `CNPJ_INVALID`, `CHECKOUT_INVALID`, `PACKAGE_TOO_LARGE`, `DPS_NUMBER_BELOW_CURRENT`, `NO_PLAN_ASSIGNED`); those are described on the operation.',
  }),
  DataNull: obj({ data: nullable({ type: 'object' }) }),
  Deleted: obj({ deleted: bool({ enum: [true] }) }),
  PostalAddress: obj(
    {
      street: str(),
      number: str(),
      complement: str(),
      district: str(),
      city: str(),
      state: str({ minLength: 2, maxLength: 2, example: 'SP' }),
      zip: str({ example: '01310100' }),
    },
    ['complement'],
  ),

  // --- Companies -----------------------------------------------------------
  Company: obj(
    {
      id: uuid(),
      tenantId: uuid(),
      legalName: str(),
      tradeName: nullable(str()),
      taxId: str({ description: 'CNPJ, digits only.' }),
      municipalReg: nullable(str()),
      sendMunicipalReg: bool(),
      municipalityCode: str({ description: '7-digit IBGE code.' }),
      defaultServiceCode: nullable(str()),
      addressStreet: nullable(str()),
      addressNumber: nullable(str()),
      addressComplement: nullable(str()),
      addressDistrict: nullable(str()),
      addressCity: nullable(str()),
      addressState: nullable(str()),
      addressZip: nullable(str()),
      simplesRate: nullable(str({ description: 'Percent, e.g. "6.00".' })),
      simplesIssRate: nullable(str({ description: 'Percent, e.g. "2.00".' })),
      fiscalSchemaVersion: str(),
      environment: str({ enum: ['test', 'live'] }),
      status: str({ enum: ['pending_setup', 'ready', 'blocked'] }),
      setupGaps: array(str(), {
        description:
          'What is still missing before the company can issue (for example `certificate`).',
      }),
      taxRegime: nullable(
        str({
          enum: ['MEI', 'Simples Nacional', 'Lucro Presumido', 'Lucro Real'],
        }),
      ),
      simpleNational: bool(),
      specialRegime: nullable(str()),
      municipalityAgreement: ref('MunicipalityAgreement'),
      warnings: array(ref('RegistryWarning'), {
        description:
          'Only on creation: differences between what you sent and the public CNPJ registry. They never block the request.',
      }),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    },
    [
      'tradeName',
      'municipalReg',
      'sendMunicipalReg',
      'municipalityCode',
      'defaultServiceCode',
      'addressStreet',
      'addressNumber',
      'addressComplement',
      'addressDistrict',
      'addressCity',
      'addressState',
      'addressZip',
      'simplesRate',
      'simplesIssRate',
      'municipalityAgreement',
      'warnings',
    ],
  ),
  RegistryWarning: obj({
    code: str({
      enum: ['TAX_REGIME_REGISTRY_MISMATCH', 'MEI_MUNICIPALITY_MISMATCH'],
    }),
    message: str(),
  }),
  MunicipalityAgreement: obj({
    status: str({
      enum: ['not_checked', 'active', 'inactive', 'unknown', 'not_found'],
      description:
        'Whether the municipality joined the national NFS-e system, as the Receita answered.',
    }),
    checkedAt: nullable(dateTime()),
    agreementType: nullable(str()),
  }),
  CnpjProfile: obj(
    {
      legalName: str(),
      tradeName: str(),
      address: ref('PostalAddress'),
      municipalityCode: nullable(
        str({ description: '7-digit IBGE code of the registered address.' }),
      ),
      simples: nullable(bool()),
      mei: nullable(bool()),
      active: bool({
        description: 'False when the registry says the CNPJ is not active.',
      }),
      situation: str({ example: 'ATIVA' }),
      cnae: nullable(
        obj({ code: str({ example: '9602501' }), description: str() }, [], {
          description: 'Main activity (CNAE, 7 digits).',
        }),
      ),
      secondaryCnaes: array(
        obj({ code: str({ example: '9602502' }), description: str() }),
      ),
      suggestedServiceCode: nullable(
        obj({ code: str({ example: '060101' }), description: str() }, [], {
          description:
            'Default service code (cTribNac) that fits the main activity. Only a suggestion: confirm it before using it. Null when no code is a sure match.',
        }),
      ),
    },
    [],
    { description: 'Empty text means the registry did not say.' },
  ),
  FiscalProfile: obj(
    {
      id: uuid(),
      tenantId: uuid(),
      companyId: uuid(),
      taxRegime: str({ enum: TAX_REGIME_KINDS }),
      simpleNational: bool(),
      specialTaxRegime: nullable(
        str({ enum: ['0', '1', '2', '3', '4', '5', '6'] }),
      ),
      ibsCbsRegularOption: bool(),
      ibsCbsRegularFrom: nullable(date()),
      simplesIssRate: nullable(str()),
      simplesApuracao: nullable(
        str({ enum: ['SN', 'ISS_MUNICIPAL', 'REGULAR'] }),
      ),
      validFrom: date({ description: 'Inclusive.' }),
      validUntil: nullable(
        date({ description: 'Exclusive. Null while the profile is open.' }),
      ),
      source: str(),
      reviewStatus: str({ enum: REVIEW_STATUS }),
      reviewedBy: nullable(str()),
      reviewedAt: nullable(dateTime()),
      createdAt: dateTime(),
    },
    ['simplesApuracao'],
  ),
  WithholdingRates: obj(
    {
      irrf: str(),
      pis: str(),
      cofins: str(),
      csll: str(),
      inss: str(),
    },
    ['irrf', 'pis', 'cofins', 'csll', 'inss'],
    { description: 'Percent strings, e.g. "1.5".' },
  ),
  ServiceTaxProfile: obj({
    id: uuid(),
    tenantId: uuid(),
    companyId: uuid(),
    name: str(),
    serviceCode: str(),
    municipalServiceCode: nullable(str()),
    nbsCode: nullable(str()),
    cst: nullable(str()),
    classCode: nullable(str()),
    operationIndicator: nullable(str()),
    operationNature: str({
      enum: ['SERVICE', 'GOODS', 'MIXED', 'PARTNER_SALON'],
    }),
    regimeApplicability: array(str({ enum: TAX_REGIME_KINDS })),
    incidenceMunicipalityCode: nullable(str()),
    issTaxation: nullable(str({ enum: ['NORMAL', 'FIXED', 'EXEMPT'] })),
    issRate: nullable(str()),
    issWithholdingDefault: bool(),
    withholdingPolicy: str({
      enum: ['UNKNOWN', 'NONE_CONFIRMED', 'CONFIGURED'],
    }),
    withholdingRates: ref('WithholdingRates'),
    effectiveFrom: date({ description: 'Inclusive.' }),
    effectiveUntil: nullable(date({ description: 'Exclusive.' })),
    classificationSource: str(),
    reviewStatus: str({ enum: REVIEW_STATUS }),
    catalogVersion: nullable(str()),
    createdAt: dateTime(),
  }),
  NfeSettings: obj({
    companyId: uuid(),
    stateRegistration: nullable(str({ example: '110042490114' })),
    crt: nullable(
      int({ enum: [1, 4], description: '1 Simples Nacional, 4 MEI.' }),
    ),
    defaultSeries: int({ minimum: 0, maximum: 999 }),
    defaultNatOp: str({ example: 'Venda de mercadoria' }),
    defaultCsosn: str({ enum: ['102', '400'] }),
    defaultOrigin: int({ minimum: 0, maximum: 8 }),
    defaultPisCst: str({ example: '49' }),
    defaultCofinsCst: str({ example: '49' }),
    enabledAt: nullable(dateTime()),
    missing: array(
      str({
        enum: [
          'address_street',
          'address_number',
          'address_district',
          'address_zip',
          'address_city_code',
          'address_state',
          'state_registration',
          'crt',
        ],
      }),
    ),
  }),
  DpsSequence: obj({
    series: str({ example: '00001' }),
    lastNumber: int({
      format: 'int64',
      minimum: 0,
      description: 'The last DPS number used (0 when none yet).',
    }),
  }),
  DpsNumberingCheck: obj({
    series: str({ example: '00001' }),
    nextNumber: int({
      format: 'int64',
      description: 'The number the next note would take.',
    }),
    usedNumbers: {
      type: 'array',
      items: int({ format: 'int64' }),
      description:
        'Numbers, from `nextNumber` on, that the government already has.',
    },
    suggestedNext: int({
      format: 'int64',
      description: 'First number that is free for sure.',
    }),
    moreMayBeUsed: bool({
      description:
        'True when every number asked was used, so more may be used after `suggestedNext`.',
    }),
    checkedAt: nullable(dateTime()),
  }),
  AccountantSettings: obj({
    email: nullable(str({ format: 'email' })),
    lastSentMonth: nullable(
      str({ example: '2026-10', pattern: '^\\d{4}-\\d{2}$' }),
    ),
  }),
  AccountantSettingsUpdate: obj({
    email: nullable(str({ format: 'email' })),
    lastSentMonth: nullable(str({ example: '2026-10' })),
    testEmailSent: bool({
      description:
        'True when a short hello was sent to the new address (live companies only, once per address).',
    }),
  }),
  AccountantSend: obj({
    id: uuid(),
    month: str({ example: '2026-10' }),
    recipient: str({ format: 'email' }),
    invoiceCount: int(),
    totalCents: int(),
    status: str({
      enum: ['sent', 'skipped-empty', 'skipped-too-large', 'failed'],
    }),
    trigger: str({ enum: ['scheduled', 'manual', 'mcp-or-api'] }),
    createdAt: dateTime(),
  }),
  AccountantSendResult: obj({
    status: str({
      enum: [
        'sent',
        'skipped-test',
        'skipped-no-email',
        'skipped-empty',
        'skipped-too-large',
        'skipped-already-sent',
      ],
      description:
        '`sent` means queued for e-mail (not proof of delivery). Every `skipped-*` means nothing was sent.',
    }),
  }),
  PackageSummary: obj({
    month: str({ example: '2026-10' }),
    count: int(),
    total: str({
      pattern: '^\\d+\\.\\d{2}$',
      example: '1234.50',
      description:
        'Sum of the gross amount of the authorized notes, in BRL, as a decimal string with two places.',
    }),
    limit: int({ description: 'Most notes a package can hold.' }),
    companyName: str(),
    companyTaxId: str(),
  }),
  PortalStatus: obj({
    environment: str({ enum: ['test', 'live'] }),
    available: bool({
      description:
        'False while emission is paused because the national portal stopped answering; invoices wait in the queue.',
    }),
    since: nullable(dateTime()),
    retryAt: nullable(dateTime()),
  }),
  Certificate: obj(
    {
      id: uuid(),
      companyId: uuid(),
      serialNumber: str(),
      issuer: str(),
      subject: str(),
      fingerprint: str(),
      validFrom: dateTime(),
      validUntil: dateTime(),
      status: str({ description: 'For example `active` or `expired`.' }),
      createdAt: dateTime(),
    },
    [],
    {},
  ),

  // --- Invoices ------------------------------------------------------------
  InvoiceEvent: obj({
    id: uuid(),
    invoiceId: uuid(),
    fromStatus: nullable(str({ description: 'An invoice status.' })),
    toStatus: str({ description: 'An invoice status.' }),
    reason: nullable(str()),
    createdAt: dateTime(),
    source: nullable(str({ enum: ['portal'] })),
    portalEvent: nullable(
      str({ description: 'Portal event type, such as REJEICAO_TOMADOR.' }),
    ),
    portalNsu: nullable(str()),
  }),
  InvoiceDownloadUrl: obj({
    downloadUrl: str({ format: 'uri' }),
    expiresAt: dateTime(),
    fileName: str(),
    mimeType: str({ enum: ['application/pdf', 'application/xml'] }),
  }),
  InvoiceEmailRequest: obj({
    emailId: str(),
    status: str({ example: 'queued' }),
  }),
  InvoiceReviewResult: obj({
    results: array(
      {
        oneOf: [
          obj({ id: uuid(), outcome: str({ enum: ['accepted'] }) }),
          obj({
            id: uuid(),
            outcome: str({ enum: ['skipped'] }),
            reason: str({
              enum: [
                'not_found',
                'not_in_manual_review',
                'changed',
                'dps_used_by_other_nfse',
              ],
              description:
                '`dps_used_by_other_nfse`: retry refused because the portal already has this DPS number on another NFS-e; discard the invoice and issue the sale again (it gets a new number).',
            }),
          }),
        ],
      },
      { description: 'One entry per distinct id sent, in the order sent.' },
    ),
  }),
  SavedCustomer: obj({
    taxId: str({ description: 'CPF or CNPJ, digits only.' }),
    name: str(),
    email: nullable(str({ format: 'email' })),
    lastUsedAt: dateTime(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
  ServiceFavorite: obj({
    id: uuid(),
    tenantId: uuid(),
    companyId: uuid(),
    label: str(),
    description: str(),
    serviceCode: str(),
    amountCents: nullable(int({ description: 'Default amount, in cents.' })),
    municipalityCode: nullable(str()),
    createdAt: dateTime(),
  }),

  // --- Schedules (snake_case) ---------------------------------------------
  // ScheduleResponseDto and ScheduleRunResponseDto are DTO classes.

  // --- Imports (snake_case) ------------------------------------------------
  ImportStart: obj({
    id: uuid(),
    status: str({
      enum: ['processing', 'ready', 'emitting', 'done', 'failed'],
    }),
    duplicate_of: nullable(
      uuid({
        description:
          'Set when the same file was already imported: that import.',
      }),
    ),
  }),
  ImportCounters: obj({
    total: int(),
    valid: int(),
    invalid: int(),
    accepted: int(),
    authorized: int(),
    awaiting_credits: int({
      description:
        'Turned away because credits or the plan limit ran out: not an error, emit again.',
    }),
    valid_amount: num({ description: 'BRL, rows ready to emit.' }),
    awaiting_amount: num(),
    failed: int(),
    pending: int(),
    authorized_amount: num(),
    pending_amount: num(),
    failed_amount: num(),
  }),
  ImportJob: obj({
    id: uuid(),
    status: str({
      enum: ['processing', 'ready', 'emitting', 'done', 'failed'],
    }),
    file_name: str(),
    company_id: nullable(uuid()),
    error_code: nullable(str()),
    rows_expected: nullable(int()),
    unknown_columns: array(str(), {
      description: 'Header names of the file that matched no column (ignored).',
    }),
    emit_started_at: nullable(dateTime()),
    emit_finished_at: nullable(dateTime()),
    created_at: dateTime(),
    counters: ref('ImportCounters'),
  }),
  ImportRow: obj({
    line: int({ description: 'Line of the file, starting at 1.' }),
    data: { type: 'object', additionalProperties: true },
    status: str({
      enum: ['valid', 'invalid', 'queued', 'accepted', 'rejected'],
    }),
    error_code: nullable(str()),
    error_message: nullable(str()),
    invoice_id: nullable(uuid()),
  }),

  // --- Webhooks ------------------------------------------------------------
  WebhookEventType: str({
    enum: [
      'nfse.invoice.authorized',
      'nfse.invoice.rejected',
      'nfse.invoice.failed',
      'nfse.invoice.reconciliation_required',
      'nfse.invoice.manual_review',
      'nfse.invoice.documents_ready',
      'nfse.invoice.email_sent',
      'nfse.invoice.email_failed',
      'nfse.invoice.fiscal_discrepancy',
      'nfse.invoice.cancelled',
      'nfse.invoice.cancellation_rejected',
      'nfse.invoice.taker_rejected',
    ],
  }),
  Webhook: obj({
    id: uuid(),
    url: str({ format: 'uri' }),
    events: array(ref('WebhookEventType')),
    environment: nullable(
      str({
        enum: ['test', 'live'],
        description:
          'Set when an API key created it: it then only gets events of that environment.',
      }),
    ),
    active: bool(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
  WebhookWithSecret: {
    allOf: [
      ref('Webhook'),
      obj({
        secret: str({
          description:
            'Signing secret. Shown only in this response: store it to verify deliveries.',
        }),
      }),
    ],
  },
  WebhookTestResult: {
    oneOf: [
      obj({ sent: bool({ enum: [true] }) }),
      obj({
        sent: bool({ enum: [false] }),
        statusCode: nullable(int()),
        error: str(),
      }),
    ],
  },
  WebhookRetried: obj({ retried: bool({ enum: [true] }) }),
  WebhookDelivery: obj(
    {
      id: uuid(),
      tenantId: uuid(),
      webhookConfigId: uuid(),
      invoiceId: uuid(),
      eventType: str(),
      environment: str({ enum: ['test', 'live'] }),
      url: str({ format: 'uri' }),
      payload: { type: 'object', additionalProperties: true },
      statusCode: int(),
      responseBody: str(),
      errorMessage: str(),
      status: str({
        enum: ['pending', 'sent', 'delayed', 'failed', 'manual_retry'],
      }),
      durationMs: int(),
      retryCount: int(),
      nextRetryAt: dateTime(),
      lastError: str(),
      createdAt: dateTime(),
    },
    [
      'invoiceId',
      'payload',
      'statusCode',
      'responseBody',
      'errorMessage',
      'durationMs',
      'nextRetryAt',
      'lastError',
    ],
  ),
  WebhookStats: obj({
    total: int(),
    sent: int(),
    failed: int(),
    pending: int(),
    delayed: int(),
  }),

  // --- Credits and billing -------------------------------------------------
  CreditBalance: obj({
    balance: int({
      description: 'Notes available: plan notes left plus loose notes.',
    }),
    planRemaining: int(),
    avulsoBalance: int({
      description: 'Loose (one-off) notes bought separately.',
    }),
    hardLimit: int(),
  }),
  CreditTransaction: obj(
    {
      id: uuid(),
      tenantId: uuid(),
      amount: int(),
      type: str({
        enum: [
          'purchase',
          'subscription_charge',
          'topup',
          'overage',
          'invoice_authorized',
          'invoice_rejected',
          'expiration',
          'message_sent',
          'refund',
          'adjustment',
          'bonus',
        ],
      }),
      description: str(),
      metadata: { type: 'object', additionalProperties: true },
      amountBrlCents: int(),
      unitPriceCentsApplied: int(),
      planIdSnapshot: str(),
      source: str({ enum: ['subscription', 'avulso', 'bonus'] }),
      reservedInvoiceId: uuid(),
      periodId: str(),
      isReservation: bool(),
      relatedTransactionId: uuid(),
      createdAt: dateTime(),
    },
    [
      'description',
      'metadata',
      'amountBrlCents',
      'unitPriceCentsApplied',
      'planIdSnapshot',
      'source',
      'reservedInvoiceId',
      'periodId',
      'isReservation',
      'relatedTransactionId',
    ],
  ),
  Plan: obj({
    id: uuid(),
    slug: str({
      enum: ['free', 'self-hosted', 'solo', 'equipe', 'empresa', 'escala'],
    }),
    name: str(),
    description: str(),
    monthlyCreditAllowance: int({ description: 'Notes included per month.' }),
    dailyLimit: nullable(int()),
    maxActiveCompanies: int(),
    creditUnitPriceCents: int({
      description: 'Price of each note above the allowance.',
    }),
    throughputRps: num(),
    includesWebhooks: bool(),
    includesXmlDownload: bool(),
    includesPdfDownload: bool(),
    includesApiKeys: bool(),
    supportTier: str({ enum: ['community', 'email', 'priority'] }),
    active: bool(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
  PurchasePreview: obj({
    units: int(),
    unitPriceCents: int(),
    totalCents: int(),
  }),
  PlanPrice: obj({
    slug: str({ enum: ['solo', 'equipe', 'empresa', 'escala'] }),
    name: str(),
    monthlyAllowance: int({ description: 'Notes included per month.' }),
    basePriceCents: int({ description: 'Full monthly price, in centavos.' }),
    monthlyEquivalentCents: int({
      description:
        'Price per month in the chosen cycle (the annual cycle is discounted).',
    }),
    chargeTotalCents: int({
      description: 'What is charged at once for the chosen cycle.',
    }),
    currency: str({ enum: ['BRL'] }),
  }),
  BillingPlan: obj({
    plan: obj({
      slug: str({
        enum: ['free', 'self-hosted', 'solo', 'equipe', 'empresa', 'escala'],
      }),
      name: str(),
      monthly_allowance: int(),
      daily_limit: nullable(int()),
      max_active_companies: int(),
      monthly_price_cents: int(),
    }),
    subscription: obj({
      status: str({
        description:
          'Subscription status from the payment provider, or `none`.',
      }),
      paid_until: nullable(dateTime()),
      cancel_at_period_end: bool(),
      scheduled_plan: nullable(str()),
      blocked: bool({
        description: 'True when the plan lapsed and cannot issue.',
      }),
      stripe_portal_available: bool(),
      stripe_subscription: bool(),
      pix_subscription: nullable(
        obj(
          {
            status: str({ enum: ['active', 'pending'] }),
            planSlug: str(),
            brCode: nullable(str()),
            paymentLinkUrl: nullable(str()),
            paymentId: str(),
          },
          ['paymentId'],
        ),
      ),
    }),
    usage: obj(
      {
        hard_limit: int(),
        avulso_balance: int(),
        credits_used: int(),
        credits_reserved: int(),
        credits_remaining: int(),
        monthly_allowance: int(),
        daily_usage: int(),
        daily_limit: nullable(int()),
        active_companies: int(),
        max_active_companies: int(),
        period_start: dateTime(),
        period_end: dateTime(),
      },
      ['period_start', 'period_end'],
    ),
  }),
  QuotaStatus: obj(
    {
      canEmit: bool(),
      reason: str({
        enum: [
          'no_credits',
          'daily_limit_exceeded',
          'company_limit_exceeded',
          'plan_blocked',
        ],
        description: 'Why `canEmit` is false.',
      }),
      creditsRemaining: int(),
      avulsoBalance: int(),
      creditsUsed: int(),
      creditsReserved: int(),
      monthlyAllowance: int(),
      dailyUsage: int(),
      dailyLimit: nullable(int()),
      activeCompanies: int(),
      maxActiveCompanies: int(),
      periodStart: nullable(dateTime()),
      periodEnd: nullable(dateTime()),
    },
    ['reason'],
  ),

  // --- Integrations --------------------------------------------------------
  IntegrationProvider: obj({
    id: str({ example: 'woovi' }),
    name: str(),
    version: str(),
    credentialFields: array(
      obj(
        {
          key: str(),
          label: str(),
          secret: bool(),
          generate: bool(),
          inWebhookUrl: bool(),
          revealOnce: bool(),
          optional: bool(),
          options: array(str()),
        },
        ['generate', 'inWebhookUrl', 'revealOnce', 'optional', 'options'],
      ),
    ),
    webhookInstructions: obj({ pt: str(), en: str() }),
    supportedFlows: array(str()),
  }),
  IntegrationConnection: obj({
    id: uuid(),
    provider: str(),
    environment: str({ enum: ['test', 'live'] }),
    companyId: uuid(),
    state: str({
      enum: ['draft', 'active', 'paused', 'reauth_required', 'disconnected'],
    }),
    externalAccountId: nullable(str()),
    activeFrom: nullable(dateTime()),
    webhookUrl: str({
      format: 'uri',
      description: 'Paste it into the payment platform.',
    }),
    createdAt: dateTime(),
  }),
  IntegrationConnectionCreated: {
    allOf: [
      ref('IntegrationConnection'),
      obj({
        secrets: {
          type: 'object',
          additionalProperties: str(),
          description:
            'Credentials the platform needs, shown only in this response.',
        },
      }),
    ],
  },
  IntegrationRule: obj({
    id: uuid(),
    externalProductId: nullable(
      str({ description: 'Null for the default rule (any product).' }),
    ),
    service: { type: 'object', additionalProperties: true },
    sendEmail: bool(),
    allowAnonymousCustomer: bool(),
    cancelOnRefund: bool(),
  }),
  IntegrationEvent: obj({
    id: uuid(),
    deliveryId: str(),
    externalType: str(),
    state: str({
      enum: [
        'received',
        'processing',
        'retry_pending',
        'processed',
        'ignored',
        'needs_attention',
        'dead',
      ],
    }),
    attempts: int(),
    lastError: nullable(str()),
    operationId: nullable(uuid()),
    createdAt: dateTime(),
  }),
  IntegrationOperation: obj({
    id: uuid(),
    operationKey: str(),
    commercialState: str({
      enum: ['pending', 'paid', 'refunded', 'disputed', 'canceled'],
    }),
    fiscalStatus: str({
      enum: ['none', 'blocked', 'needs_attention', 'submitted'],
    }),
    blockReason: nullable(
      str({
        description:
          'Why no invoice was issued, for example `no_rule`, `customer_tax_id_missing`, `quota_exceeded`.',
      }),
    ),
    amountCents: int(),
    currency: str({ example: 'BRL' }),
    customer: nullable(
      obj({
        name: nullable(str()),
        email: nullable(str()),
        taxId: nullable(str()),
        taxIdMasked: bool(),
      }),
    ),
    paidAt: nullable(dateTime()),
    invoiceId: nullable(uuid()),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
  IntegrationOperationRetry: obj(
    {
      state: str({ enum: ['processed', 'ignored', 'needs_attention'] }),
      operationId: uuid(),
      lastError: str(),
    },
    ['operationId', 'lastError'],
  ),

  // --- Health --------------------------------------------------------------
  Health: obj({
    status: str({ enum: ['ok'] }),
    timestamp: dateTime(),
    uptime: num({ description: 'Seconds since the process started.' }),
  }),
};
