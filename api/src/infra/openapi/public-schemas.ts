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
const NFE_STATUS_VALUES = [
  'queued',
  'contingency_pending',
  'processing',
  'authorized',
  'rejected',
  'denied',
  'retry_pending',
  'reconciliation_required',
  'manual_review',
  'cancelling',
  'cancelled',
  'discarded',
];

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
    nfceDefaultSeries: int({
      minimum: 0,
      maximum: 999,
      description: 'Series of the NFC-e (model 65).',
    }),
    nfceAutoOffline: bool({
      description:
        'Issue the NFC-e off-line (contingency) by itself when the SEFAZ cannot be reached. Off by default.',
    }),
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
  NfeValidation: obj(
    {
      valid: bool({ enum: [true] }),
      accessKeyPreview: str({
        minLength: 44,
        maxLength: 44,
        description:
          'The key the next NF-e would get. The number is only read, not reserved, and `cNF` is random, so a real emission gets another key.',
      }),
      xml: str({
        description:
          'The preview XML with a placeholder signature. Only with `includeXml=true`.',
      }),
    },
    ['xml'],
  ),
  NfeAccepted: obj(
    {
      type: str({ enum: ['nfe', 'nfce'] }),
      id: uuid(),
      status: str({ enum: NFE_STATUS_VALUES }),
      replayed: bool({
        enum: [true],
        description:
          'Present (and true) when the same `Idempotency-Key` with the same body had already created this NF-e: nothing new was written.',
      }),
    },
    ['replayed'],
  ),
  NfceOfflineAccepted: obj(
    {
      type: str({ enum: ['nfce'] }),
      id: uuid(),
      status: str({ enum: NFE_STATUS_VALUES }),
      replayed: bool({
        enum: [true],
        description:
          'Present (and true) on the `200` answer to a repeated `Idempotency-Key`: nothing new was issued.',
      }),
      accessKey: str({
        description:
          'The 44-character key of the NFC-e (`tpEmis` 9 at position 35).',
      }),
      qrCode: str({
        description:
          'The QR Code v3 text of the off-line NFC-e, with the signature of the issuer. It is printed on the DANFCE.',
      }),
      xmlUrl: str({
        description:
          'Path to download the signed XML (`GET /invoices/{id}/xml`).',
      }),
      pdfUrl: str({
        description:
          'Path to download the DANFCE with the notice "EMITIDA EM CONTINGÊNCIA" (`GET /invoices/{id}/pdf`).',
      }),
    },
    ['replayed'],
  ),
  NfeError: obj(
    {
      type: str({
        enum: ['communication', 'validation', 'configuration'],
        description:
          '`validation`: the SEFAZ rejected or denied the note, fix what the message says. `communication`: the SEFAZ did not answer; Corvo checks by the key, you do not resend. `configuration`: complete the company or the release.',
      }),
      code: str({
        description:
          'The cStat of a SEFAZ rejection (`225`), or a Corvo code (`SEFAZ_NO_ANSWER`, `SEFAZ_UNAVAILABLE`, `CERTIFICATE_NOT_FOUND`...).',
      }),
      message: str(),
      hint: str({ description: 'What to do about a known SEFAZ rejection.' }),
    },
    ['hint'],
  ),
  Nfe: obj(
    {
      type: str({
        enum: ['nfe', 'nfce'],
        description:
          '`nfe` (model 55) or `nfce` (model 65). An NFS-e has no `type` field: a document without it is an NFS-e.',
      }),
      id: uuid(),
      companyId: uuid(),
      environment: str({ enum: ['test', 'live'] }),
      model: int({ enum: [55, 65] }),
      status: str({ enum: NFE_STATUS_VALUES }),
      series: nullable(int()),
      number: nullable(
        int({
          description:
            'Assigned when the first attempt is made; it never changes.',
        }),
      ),
      accessKey: nullable(
        str({
          minLength: 44,
          maxLength: 44,
          description:
            'The 44-character key of the current attempt. A resubmission after a rejection draws a new key and keeps the number.',
        }),
      ),
      issuedAt: nullable(dateTime()),
      authorizedAt: nullable(dateTime()),
      protocol: nullable(str()),
      cStat: nullable(str()),
      xMotivo: nullable(str()),
      natOp: str(),
      recipient: nullable({
        type: 'object',
        additionalProperties: true,
        description:
          'The recipient as it went in the XML. `null` on a NFC-e sold to an unidentified consumer.',
      }),
      items: array({
        type: 'object',
        additionalProperties: true,
        description:
          'Each item with its amounts as 2-place strings and the Simples tax groups used.',
      }),
      totals: obj({
        vProd: str(),
        vDesc: str(),
        vFrete: str(),
        vSeg: str(),
        vOutro: str(),
        vNF: str(),
      }),
      payment: {
        type: 'object',
        additionalProperties: true,
        description: 'The payments (`tPag`, `amount`) and the change.',
      },
      additionalInfo: nullable(str()),
      externalId: nullable(str()),
      cancelReason: nullable(
        str({
          description: 'The justification of the cancellation asked for.',
        }),
      ),
      cancelRequestedAt: nullable(dateTime()),
      documentsReady: bool({
        description:
          'True once the XML (`nfeProc`) and the DANFE can be downloaded; they stay available after a cancellation.',
      }),
      documentsReadyAt: nullable(dateTime()),
      documentsStatus: str({
        enum: ['pending', 'ready'],
        description:
          'Same as for an NFS-e: `ready` once the XML and the DANFE are stored (the same as `documentsReady`).',
      }),
      stage: str({
        enum: [
          'pending',
          'authorized',
          'documents_ready',
          'completed',
          'failed',
          'cancelled',
        ],
        description:
          'Same as for an NFS-e: `completed` means authorized, documents ready and the requested e-mail resolved.',
      }),
      emailStatus: nullable(
        str({
          enum: ['queued', 'sent', 'failed'],
          description:
            'The e-mail with the XML and the DANFE to the recipient.',
        }),
      ),
      emailSentAt: nullable(dateTime()),
      attempt: int({
        description:
          'How many times the XML was built and signed (1 on the first send).',
      }),
      lastError: { ...nullable({ type: 'object' }), allOf: [ref('NfeError')] },
      nextCheckAt: nullable(
        dateTime({
          description: 'When Corvo looks at the SEFAZ again, if it does.',
        }),
      ),
      qrCode: nullable(
        str({
          description:
            'NFC-e only: the QR Code (`infNFeSupl`) of the current attempt. Absent on an NF-e.',
        }),
      ),
      urlChave: nullable(
        str({
          description:
            'NFC-e only: the address to consult the note by its key (`infNFeSupl`). Absent on an NF-e.',
        }),
      ),
      emissionType: int({
        description:
          'NF-e only: the `tpEmis` of the current key. `1` normal, `6` issued through the SVC-AN and `7` through the SVC-RS (the SEFAZ Virtual de Contingência, used when the SEFAZ of the state is out). Absent on a NFC-e.',
      }),
      contingencyAt: nullable(
        dateTime({
          description:
            'When it was issued in contingency (`dhCont`): off-line for a NFC-e (`tpEmis` 9) or through the SVC for a NF-e (`tpEmis` 6 or 7). `null` when it was issued normally.',
        }),
      ),
      contingencyReason: nullable(
        str({
          description:
            'The reason of the contingency emission (`xJust`), for a NFC-e off-line or a NF-e through the SVC.',
        }),
      ),
      contingencyDeadlineAt: nullable(
        dateTime({
          description:
            'NFC-e only: the limit (24 hours) to transmit an off-line NFC-e. Corvo warns by e-mail and webhook after 20 hours.',
        }),
      ),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    },
    [
      'qrCode',
      'urlChave',
      'emissionType',
      'contingencyAt',
      'contingencyReason',
      'contingencyDeadlineAt',
    ],
  ),
  NfseInvoiceRequest: {
    allOf: [
      ref('CreateInvoice'),
      {
        type: 'object',
        properties: {
          type: str({
            enum: ['nfse'],
            default: 'nfse',
            description:
              'Optional: without it the request is an NFS-e, exactly as before.',
          }),
        },
      },
    ],
  },
  NfeInvoiceRequest: {
    allOf: [
      ref('NfeRequest'),
      {
        type: 'object',
        required: ['type'],
        properties: {
          type: str({
            enum: ['nfe'],
            description: 'Selects the NF-e (model 55) instead of the NFS-e.',
          }),
        },
      },
    ],
  },
  NfceInvoiceRequest: {
    allOf: [
      ref('NfceRequest'),
      {
        type: 'object',
        required: ['type'],
        properties: {
          type: str({
            enum: ['nfce'],
            description:
              'Selects the NFC-e (model 65, sale to the final consumer) instead of the NFS-e.',
          }),
        },
      },
    ],
  },
  InvoiceSummary: obj(
    {
      id: uuid(),
      type: str({ enum: ['nfse', 'nfe', 'nfce'] }),
      companyId: uuid(),
      environment: str({ enum: ['test', 'live'] }),
      status: str({
        description:
          'The state, in the vocabulary of the type (NFS-e or NF-e statuses).',
      }),
      number: nullable(int({ description: 'NFS-e number or NF-e number.' })),
      accessKey: nullable(str()),
      amount: nullable(
        str({
          description: 'Gross amount (NFS-e) or `vNF` (NF-e), a decimal text.',
          example: '150.00',
        }),
      ),
      externalId: nullable(str()),
      issuedAt: nullable(dateTime()),
      createdAt: dateTime(),
    },
    [],
    {
      description:
        'What `GET /invoices?type=all` shows of each document. Read the whole document with `GET /invoices/{id}`.',
    },
  ),
  NfeDownloadLink: obj({
    downloadUrl: str({ format: 'uri' }),
    expiresAt: dateTime(),
    fileName: str(),
    mimeType: str({ enum: ['application/pdf', 'application/xml'] }),
  }),
  NfeEvent: obj({
    id: uuid(),
    documentId: uuid(),
    type: str({ enum: ['cancellation', 'correction'] }),
    tpEvento: str({
      enum: ['110111', '110110'],
      description: '110111 cancellation, 110110 correction letter (CC-e).',
    }),
    sequence: int({
      description:
        '`nSeqEvento`: always 1 for a cancellation; the n-th letter for a correction (at most 20).',
    }),
    status: str({
      enum: ['pending', 'pending_check', 'registered', 'rejected'],
      description:
        '`pending_check`: the SEFAZ did not answer; Corvo checks by the key and does not send another.',
    }),
    text: nullable(
      str({ description: 'The justification or the correction.' }),
    ),
    protocol: nullable(str()),
    cStat: nullable(str()),
    xMotivo: nullable(str({ description: 'The SEFAZ reason, as it came.' })),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
  NfeTimelineEntry: obj({
    kind: str({
      enum: ['status', 'event'],
      description:
        '`status`: the NF-e moved to `status`. `event`: a correction letter, in its own `status`. A cancellation is not a separate entry: the request is the `cancelling` entry (justification in `text`) and the SEFAZ answer is in the `cancelled` entry, or in the entry that goes back to `authorized` when it refuses.',
    }),
    at: dateTime(),
    status: str(),
    from: nullable(str()),
    tpEvento: nullable(str()),
    sequence: nullable(int()),
    eventId: nullable(uuid()),
    text: nullable(
      str({
        description:
          'The justification of a cancellation request or the text of a correction letter.',
      }),
    ),
    cStat: nullable(
      str({ description: 'Only when the SEFAZ answered on this entry.' }),
    ),
    xMotivo: nullable(str()),
  }),
  NfeInutilization: obj(
    {
      id: uuid(),
      companyId: uuid(),
      environment: str({ enum: ['test', 'live'] }),
      model: int({ enum: [55, 65] }),
      series: int(),
      start: int(),
      end: int(),
      justification: str(),
      status: str({
        enum: ['pending', 'homologada', 'rejected'],
        description:
          '`homologada`: the SEFAZ voided the range. `rejected`: it refused, and the range is free for a new request.',
      }),
      protocol: nullable(str()),
      cStat: nullable(str()),
      xMotivo: nullable(str()),
      createdAt: dateTime(),
      updatedAt: dateTime(),
      replayed: bool({
        enum: [true],
        description:
          'Present when the same `Idempotency-Key` with the same body had already created this request.',
      }),
    },
    ['replayed'],
  ),
  NfeNumberGap: obj({
    companyId: uuid(),
    series: int(),
    start: int(),
    end: int({
      description: 'Inclusive: a single number has `start` = `end`.',
    }),
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
    authorities: array(
      obj({
        authority: str({
          example: 'nfe-sp-2',
          description:
            'An NF-e authority and environment: `nfe-<authority>-<tpAmb>`, `tpAmb` 1 production or 2 homologation.',
        }),
        available: bool(),
        since: nullable(dateTime()),
        retryAt: nullable(dateTime()),
      }),
      { description: 'The NF-e authorities already used by emissions.' },
    ),
    connection: obj({
      state: str({
        enum: [
          'ok',
          'portal_down',
          'gov_unreachable_from_us',
          'no_internet',
          'emission_failures',
        ],
        description:
          'What the connection tests see: `portal_down` when the national portal is down, or a problem on the Corvo side (`gov_unreachable_from_us`, `no_internet`, `emission_failures`). Invoices wait in the queue and are sent once the connection is back.',
      }),
      since: nullable(dateTime()),
      ourSide: bool({
        description:
          'True when the trouble is on the Corvo side, not the portal.',
      }),
      authorities: array(
        obj({
          authority: str({
            example: 'nfe-sp-2',
            description:
              'An enabled SEFAZ authority and environment, named like the breaker list above.',
          }),
          reachable: bool({
            description: 'True when the last TCP probe reached its host.',
          }),
          checkedAt: dateTime(),
        }),
        {
          description:
            'What the last connection probe saw for each enabled SEFAZ authority; empty when none is enabled or the data is not available.',
        },
      ),
    }),
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
      'nfe.document.authorized',
      'nfe.document.rejected',
      'nfe.document.denied',
      'nfe.document.failed',
      'nfe.document.reconciliation_required',
      'nfe.document.manual_review',
      'nfe.document.documents_ready',
      'nfe.document.email_sent',
      'nfe.document.email_failed',
      'nfe.document.cancelled',
      'nfe.document.cancellation_rejected',
      'nfe.document.corrected',
      'nfe.inutilization.completed',
      'nfe.inutilization.rejected',
      'nfce.document.authorized',
      'nfce.document.rejected',
      'nfce.document.denied',
      'nfce.document.failed',
      'nfce.document.reconciliation_required',
      'nfce.document.manual_review',
      'nfce.document.documents_ready',
      'nfce.document.email_sent',
      'nfce.document.email_failed',
      'nfce.document.cancelled',
      'nfce.document.cancellation_rejected',
      'nfce.inutilization.completed',
      'nfce.inutilization.rejected',
      'nfce.contingency.deadline_near',
      'nfe.contingency.entered',
      'nfe.contingency.exited',
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
      documentId: uuid({
        description:
          'The NF-e the event is about (`nfe.*` events); `invoiceId` is absent for them.',
      }),
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
      'documentId',
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
  IntegrationProvider: obj(
    {
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
            afterUrl: bool(),
            options: array(str()),
          },
          [
            'generate',
            'inWebhookUrl',
            'revealOnce',
            'optional',
            'afterUrl',
            'options',
          ],
        ),
      ),
      webhookInstructions: obj({ pt: str(), en: str() }),
      webhookEvents: array(str()),
      supportedFlows: array(str()),
    },
    ['webhookEvents'],
  ),
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
    connectionId: uuid(),
    provider: str({ example: 'woovi' }),
    environment: str({ enum: ['test', 'live'] }),
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
      obj(
        {
          name: nullable(str()),
          email: nullable(str()),
          taxId: nullable(str()),
          taxIdMasked: bool(),
          address: obj(
            {
              street: str(),
              city: str(),
              state: str(),
              zip: str(),
              country: str(),
              municipalityCode: str(),
            },
            ['street', 'city', 'state', 'zip', 'country', 'municipalityCode'],
          ),
        },
        ['address'],
      ),
    ),
    paidAt: nullable(dateTime()),
    invoiceId: nullable(uuid()),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
  IntegrationOperationDetail: obj({
    id: uuid(),
    connectionId: uuid(),
    provider: str({ example: 'woovi' }),
    environment: str({ enum: ['test', 'live'] }),
    operationKey: str(),
    commercialState: str({
      enum: ['pending', 'paid', 'refunded', 'disputed', 'canceled'],
    }),
    fiscalStatus: str({
      enum: ['none', 'blocked', 'needs_attention', 'submitted'],
    }),
    blockReason: nullable(str()),
    amountCents: int(),
    currency: str({ example: 'BRL' }),
    customer: nullable({ type: 'object', additionalProperties: true }),
    paidAt: nullable(dateTime()),
    invoiceId: nullable(uuid()),
    createdAt: dateTime(),
    updatedAt: dateTime(),
    service: obj({
      code: nullable(str()),
      description: nullable(str()),
    }),
    lastError: nullable(
      str({ description: 'What the last attempt said, when it was refused.' }),
    ),
    sendEmail: bool({
      description: 'Whether the invoice would be e-mailed to the customer.',
    }),
  }),
  IntegrationOperationResolved: obj({
    outcome: ref('IntegrationOperationRetry'),
    operation: ref('IntegrationOperation'),
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
