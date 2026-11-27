/**
 * The contract of every public operation, keyed by `METHOD /path` (path without
 * the `/v1` prefix, as it appears in the document). Adding a public route
 * without an entry here fails the OpenAPI unit test, so the `operationId`s
 * (the names SDK generators turn into methods) never change by accident.
 */
type Schema = Record<string, unknown>;

export interface PublicOperation {
  /** Stable `resource_action` name. Never rename: SDK method names derive from it. */
  id: string;
  tag: string;
  /** Replaces the controller description when set. */
  description?: string;
  /** Replaces the controller summary when set. */
  summary?: string;
  /** JSON schema of the 2xx responses, by status. Omitted: keep what the controller declares. */
  ok?: Record<number, Schema>;
  /** Replaces the JSON schema of the request body (a body that depends on `type`). */
  requestBody?: Schema;
  /** Non-JSON 2xx body: its media type and what it is. */
  file?: { status?: number; contentType: string; description: string };
  /** Extra error statuses beyond the defaults. */
  errors?: number[];
  /** Body schema of a `multipart/form-data` upload (the DTO cannot describe the file). */
  multipart?: Schema;
  /** Properties of the request body DTO that the route does not take (immutable or ignored). */
  dropBodyProps?: string[];
  /** The route accepts a request without a body. */
  bodyOptional?: boolean;
  /** The operation honors the `Idempotency-Key` header. */
  idempotent?: boolean;
  /** Query parameters the DTO does not declare. */
  extraParams?: Schema[];
  /** Query parameters the DTO declares but the route ignores. */
  dropParams?: string[];
  /** Query parameter descriptions that the DTO does not carry. */
  paramDescriptions?: Record<string, string>;
}

const ref = (name: string): Schema => ({
  $ref: `#/components/schemas/${name}`,
});
const data = (schema: Schema): Schema => ({
  type: 'object',
  required: ['data'],
  properties: { data: schema },
});
const list = (schema: Schema): Schema => data({ type: 'array', items: schema });
const page = (schema: Schema): Schema => ({
  type: 'object',
  required: ['data', 'pagination'],
  properties: {
    data: { type: 'array', items: schema },
    pagination: ref('CursorPagination'),
  },
});
const nothing = data({ type: 'object', nullable: true });

/** Filters of the delivery list (the stats only use the period and the environment). */
const DELIVERY_FILTERS: Schema[] = [
  {
    name: 'invoice_id',
    in: 'query',
    required: false,
    description: 'Only deliveries about this invoice.',
    schema: { type: 'string', format: 'uuid' },
  },
  {
    name: 'document_id',
    in: 'query',
    required: false,
    description: 'Only deliveries about this NF-e.',
    schema: { type: 'string', format: 'uuid' },
  },
  {
    name: 'event_type',
    in: 'query',
    required: false,
    description: 'Only this event, for example `nfse.invoice.authorized`.',
    schema: { type: 'string', maxLength: 100 },
  },
  {
    name: 'status',
    in: 'query',
    required: false,
    description: 'Only deliveries in this status.',
    schema: {
      type: 'string',
      enum: ['pending', 'sent', 'delayed', 'failed', 'manual_retry'],
    },
  },
];

const DELIVERY_PARAMS: Schema[] = [
  {
    name: 'hours',
    in: 'query',
    required: false,
    description:
      'Look back this many hours (default 24, at most 720 = 30 days).',
    schema: { type: 'number', minimum: 0.01, maximum: 720, default: 24 },
  },
  {
    name: 'environment',
    in: 'query',
    required: false,
    description:
      'Only deliveries of this environment. Ignored with an API key: it always sees its own.',
    schema: { type: 'string', enum: ['live', 'test'] },
  },
];

/**
 * Operations added after 0.2.0 (the version the SDKs were written for). Every other
 * operation already existed in 0.2.0. Used by the route table of docs/openapi/README.md.
 */
export const ADDED_IN_0_3_0: ReadonlySet<string> = new Set([
  'DELETE /companies/{companyId}/service-favorites/{favoriteId}',
  'DELETE /customers/{taxId}',
  'DELETE /imports/{id}',
  'GET /cnpj/{cnpj}',
  'GET /companies/{companyId}/accountant-package',
  'GET /companies/{companyId}/accountant-package/sends',
  'GET /companies/{companyId}/invoice-package',
  'GET /companies/{companyId}/invoice-package/summary',
  'GET /companies/{companyId}/service-favorites',
  'GET /companies/{id}/dps-sequence',
  'POST /companies/{id}/dps-sequence/check',
  'POST /companies/{id}/dps-sequence/confirm',
  'GET /credits/purchase/preview',
  'GET /customers',
  'GET /customers/{taxId}',
  'GET /fiscal-portal/status',
  'GET /health/live',
  'GET /imports',
  'GET /imports/template',
  'GET /imports/{id}',
  'GET /imports/{id}/errors.csv',
  'GET /imports/{id}/rows',
  'GET /integrations/connections',
  'GET /integrations/connections/{id}',
  'GET /integrations/connections/{id}/events',
  'GET /integrations/connections/{id}/operations',
  'GET /integrations/connections/{id}/rules',
  'GET /integrations/operations',
  'GET /integrations/operations/{id}',
  'GET /integrations/providers',
  'GET /plans',
  'GET /plans/{slug}',
  'GET /schedules',
  'GET /schedules/{id}',
  'GET /schedules/{id}/runs',
  'PATCH /customers/{taxId}',
  'PATCH /imports/{id}/rows/{line}',
  'PATCH /integrations/operations/{id}/customer',
  'PATCH /schedules/{id}',
  'POST /companies/{companyId}/accountant-package/send',
  'POST /companies/{companyId}/service-favorites',
  'POST /imports',
  'POST /imports/{id}/emit',
  'POST /integrations/connections',
  'POST /integrations/connections/{id}/activate',
  'POST /integrations/connections/{id}/disconnect',
  'POST /integrations/connections/{id}/pause',
  'POST /integrations/connections/{id}/validate',
  'POST /integrations/operations/{id}/ignore',
  'POST /integrations/operations/{id}/resolve',
  'POST /integrations/operations/{id}/retry',
  'POST /invoices/review',
  'POST /invoices/{id}/substitute',
  'POST /schedules/{id}/cancel',
  'POST /schedules/{id}/pause',
  'POST /schedules/{id}/resume',
  'PUT /companies/{companyId}/accountant-package',
  'PUT /companies/{id}/dps-sequence',
  'PUT /integrations/connections/{id}/credentials',
  'PUT /integrations/connections/{id}/rules',
]);

export const TAGS: Record<string, string> = {
  Invoices:
    'Issue, list, cancel and substitute NFS-e, and download their PDF, XML and monthly package.',
  Companies:
    'The companies (CNPJs) that issue invoices: registration, fiscal profile, service tax profiles, DPS numbering and the accountant package.',
  Certificates: 'The A1 digital certificate (PKCS#12) of each company.',
  Customers: 'Customers saved from accepted invoices, and CNPJ lookup.',
  'Service favorites': 'Services a company issues often, saved to reuse.',
  Schedules: 'Scheduled and recurring invoices.',
  Imports: 'Bulk issuing from a CSV or Excel spreadsheet.',
  Webhooks:
    'Endpoints that receive invoice events, and the log of their deliveries.',
  'Credits and billing': 'Notes available, plan, usage and credit history.',
  Integrations:
    'Payment-platform connections that issue an invoice for each paid sale.',
  'NF-e':
    'NF-e (modelo 55, only in the homologation environment while the release is limited): company settings, issuing and queries.',
  Health: 'Service status.',
};

export const PUBLIC_OPERATIONS: Record<string, PublicOperation> = {
  // --- Invoices ------------------------------------------------------------
  'POST /invoices': {
    id: 'invoices_create',
    tag: 'Invoices',
    summary: 'Issue an invoice (NFS-e, NF-e or NFC-e), or schedule one',
    ok: {
      200: data(ref('NfeAccepted')),
      201: data(ref('NfceOfflineAccepted')),
      202: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            description:
              'The invoice, or the schedule when `options.type` is `SCHEDULE` or `RECURRING`, or `{ type: "nfe" | "nfce", id, status }` for an NF-e or a NFC-e.',
            oneOf: [
              ref('InvoiceResponseDto'),
              ref('ScheduleResponseDto'),
              ref('NfeAccepted'),
            ],
          },
        },
      },
    },
    description:
      'Issues an NFS-e for a company. Issuing is asynchronous: the answer is 202 with the invoice `queued`, and the final result comes by webhook or by polling `GET /invoices/{id}`. In `live`, each accepted invoice reserves one credit. With `options.type` `SCHEDULE` or `RECURRING` nothing is issued now: the answer is the schedule (see Schedules). Send `Idempotency-Key` to make retries safe. A test key issues on the restricted-production environment, with no fiscal value.\n\n**With `type: "nfe"`:** Issues an NF-e (model 55, Simples Nacional, homologation only). The answer is asynchronous: `202` with the `id` and `status: queued`; the result comes by webhook (`nfe.document.*`) or by `GET /invoices/{id}`. Same body as `POST /invoices/validate`, which is the way to check a note without issuing it.\n\n`Idempotency-Key` (1 to 200 characters) is **required**: without it the answer is `400 IDEMPOTENCY_KEY_REQUIRED`. Repeating a key with the same body answers `200` with the same `id` and `replayed: true`; with another body, `409 IDEMPOTENCY_KEY_REUSED`.\n\nEverything that can be refused is refused here with `422` and nothing is saved or charged: `type` `validation` (fix the fields in `details`) or `configuration` (`COMPANY_NFE_INCOMPLETE`, `NFE_PRODUCTION_DISABLED`; a NFC-e from a state that has no NFC-e addresses yet answers `UF_NOT_ENABLED`). Every workspace can issue in `test`; in `live` the answer is `NFE_PRODUCTION_DISABLED` until production is turned on. In `live`, each accepted NF-e reserves one credit, given back if the note ends rejected, denied or discarded.\n\n**With `type: "nfce"`:** Issues a NFC-e (model 65, sale to the final consumer, Simples Nacional, homologation only, QR Code v3 online, no CSC). Same body as the dry-run `POST /invoices/validate` with `type: "nfce"`; the consumer is optional. Same rules as the NF-e: `Idempotency-Key` required, `202` with `{ type: "nfce", id, status: "queued" }`, the result by webhook (`nfce.document.*`) or `GET /invoices/{id}`, one credit reserved in `live`. The note carries `qrCode` and `urlChave` once the first attempt is built.\n\n**Off-line NFC-e (`contingency: "offline"`):** the PDV asks for the contingency `tpEmis` 9. Corvo numbers, signs and answers **`201` at once** with `{ type: "nfce", id, status: "contingency_pending", accessKey, qrCode, xmlUrl, pdfUrl }`; the DANFCE says "EMITIDA EM CONTINGÊNCIA". Nothing is sent to the SEFAZ in this call: Corvo transmits when the authority answers and warns by e-mail and by webhook `nfce.contingency.deadline_near` after 20 hours (the limit is 24). Without `contingency`, a company that turned on "issue off-line automatically" gets the same answer when the SEFAZ cannot be reached; otherwise the NFC-e goes the normal way. A state with no off-line QR Code address answers `422 NFCE_OFFLINE_NOT_AVAILABLE`. The note can still be rejected after it was handed to the consumer: fix it with `PUT /invoices/{id}` (only the description, barcode, NCM, CEST, unit and `additionalInfo` may change, `422 NFCE_CONTINGENCY_FIELD_LOCKED` otherwise).',
    idempotent: true,
    errors: [400, 402, 409, 422],
    requestBody: {
      oneOf: [
        ref('NfseInvoiceRequest'),
        ref('NfeInvoiceRequest'),
        ref('NfceInvoiceRequest'),
      ],
      discriminator: {
        propertyName: 'type',
        mapping: {
          nfse: '#/components/schemas/NfseInvoiceRequest',
          nfe: '#/components/schemas/NfeInvoiceRequest',
          nfce: '#/components/schemas/NfceInvoiceRequest',
        },
      },
    },
  },
  'POST /invoices/batches': { id: 'invoices_createBatch', tag: 'Invoices' },
  'POST /invoices/calculate': {
    id: 'invoices_calculate',
    tag: 'Invoices',
    ok: { 200: data(ref('InvoiceCalculation')) },
    description:
      'Previews the taxes of an invoice with the same body as `POST /invoices`, without reserving a credit, a DPS number or a document. Future competence dates are limited (15 days by default). A fiscal failure answers 200 with `blocked` and the partial result; 503 (with `Retry-After`) means the tax calculator is unavailable.',
    errors: [503],
  },
  'GET /invoices': {
    id: 'invoices_list',
    tag: 'Invoices',
    description:
      'Newest first. Filter by `status`, `origin`, `companyId`, `externalId`, `customerTaxId` or a `from`/`to` competence-date range, and walk the pages with `cursor`. A test key lists only test invoices and a live key only live ones.\n\n**With `type: "nfe"`:** The NF-e of the environment of the key, newest first. Filter by `companyId` and `status`.\n\n**With `type: "nfce"`:** The NFC-e (model 65) of the environment of the key, newest first, with the same filters. Answers 404 while NFC-e (or NF-e, for `type: "nfe"`) is not released for the workspace.',
    ok: {
      200: {
        oneOf: [
          page(ref('InvoiceResponseDto')),
          page(ref('Nfe')),
          page(ref('InvoiceSummary')),
        ],
      },
    },
    errors: [404],
    paramDescriptions: {
      from: 'Only invoices with a competence date on or after this date (ISO 8601).',
      to: 'Only invoices with a competence date on or before this date (ISO 8601).',
      externalId: 'Only the invoice created with this `externalId`.',
      companyId: 'Only invoices of this company.',
      status:
        'Only this state. NFS-e states by default; NF-e states with `type=nfe`; either with `type=all`.',
    },
  },
  'GET /invoices/overview': { id: 'invoices_overview', tag: 'Invoices' },
  'POST /invoices/review': {
    id: 'invoices_review',
    tag: 'Invoices',
    ok: { 202: data(ref('InvoiceReviewResult')) },
  },
  'GET /invoices/{id}': {
    id: 'invoices_get',
    tag: 'Invoices',
    description:
      'Returns the invoice in its current state. Issuing is asynchronous: poll this route or use the invoice webhooks until `status` is final.\n\n**For an NF-e:** The NF-e with its state, number, key and protocol. While it is `reconciliation_required` or `manual_review`, `lastError.type` is `communication`: the SEFAZ did not answer and Corvo checks by the key, you must not issue it again. A SEFAZ rejection has `lastError.type` `validation`, the cStat in `lastError.code` and, for the known ones, a `hint`.\n\n**For a NFC-e:** Same as the NF-e, with `type: "nfce"`, `model: 65`, `recipient` `null` when the consumer was not identified, and the `qrCode` and `urlChave` of the current attempt.',
    ok: { 200: data({ oneOf: [ref('InvoiceResponseDto'), ref('Nfe')] }) },
  },
  'GET /invoices/{id}/xml': {
    id: 'invoices_downloadXml',
    tag: 'Invoices',
    description:
      'The authorized NFS-e XML. Available once `documentsStatus` is `ready`.\n\n**For an NF-e:** The `nfeProc`: the signed NF-e followed by the SEFAZ protocol, the file the customer keeps. Available once `documentsReady` is `true`; before that, and for an NF-e that was never authorized, `409 DOCUMENTS_NOT_READY`. It stays available after a cancellation (the cancellation XML is in the events). A NFC-e has the same `nfeProc`.',
    errors: [409],
    file: {
      contentType: 'application/xml',
      description: 'The NFS-e XML document.',
    },
  },
  'GET /invoices/{id}/pdf': {
    id: 'invoices_downloadPdf',
    tag: 'Invoices',
    description:
      'The DANFSe PDF. Available once `documentsStatus` is `ready`.\n\n**For an NF-e:** The DANFE, portrait A4. A test company gets the mark `SEM VALOR FISCAL`; a cancelled NF-e gets `CANCELADA`. Available once `documentsReady` is `true`; before that, `409 DOCUMENTS_NOT_READY`. \n\n**For a NFC-e:** The DANFCE, the cupom of the sale: 80 mm wide (thermal-printer width, one page as tall as it needs) by default, or an A4 sheet with `?layout=a4`. The QR Code is drawn in the PDF. A test company gets `EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL`; a cancelled NFC-e gets `NFC-e CANCELADA`. Available once `documentsReady` is `true`; before that, `409 DOCUMENTS_NOT_READY`. `layout` is ignored for NFS-e and NF-e.',
    errors: [409],
    file: { contentType: 'application/pdf', description: 'The DANFSe PDF.' },
  },
  'GET /invoices/{id}/events': {
    id: 'invoices_listEvents',
    tag: 'Invoices',
    description:
      'The status transitions of the invoice, including what the national portal reported (`source: portal`).\n\n**For an NF-e:** The states the NF-e went through and its correction letters, oldest first. A cancellation appears once: `cancelling` (the request, with the justification in `text`), then `cancelled` with the SEFAZ answer (or `authorized` again with the reason of the refusal). `cStat` and `xMotivo` come only on entries where the SEFAZ answered. An entry with `kind` `event` (a correction letter) has its own `status` (`pending`, `pending_check`, `registered`, `rejected`).',
    ok: {
      200: {
        oneOf: [page(ref('InvoiceEvent')), list(ref('NfeTimelineEntry'))],
      },
    },
  },
  'POST /invoices/{id}/download-url': {
    id: 'invoices_createDownloadUrl',
    tag: 'Invoices',
    description:
      'Returns a short-lived signed URL for the PDF or XML, to hand to a browser or another service without sharing the API key. The response is never cached.\n\n**For an NF-e:** A short-lived signed URL for the `xml` (the `nfeProc`) or the `pdf` (the DANFE), to hand to a browser or another service without sharing the API key. The response is never cached. Before the documents are ready, `409 DOCUMENTS_NOT_READY`.\n\n**For a NFC-e:** The `pdf` is the 80 mm DANFCE (the A4 sheet is only served by `GET /invoices/{id}/pdf?layout=a4`).',
    ok: { 200: data(ref('InvoiceDownloadUrl')) },
    errors: [409],
  },
  'POST /invoices/{id}/email': {
    id: 'invoices_sendEmail',
    tag: 'Invoices',
    bodyOptional: true,
    idempotent: true,
    description:
      'Queues the e-mail with the PDF and XML. Send `email` in the body to use another destination than the customer address (the invoice must be authorized with its documents ready).',
    ok: { 202: data(ref('InvoiceEmailRequest')) },
  },
  'POST /invoices/{id}/cancel': {
    id: 'invoices_cancel',
    tag: 'Invoices',
    summary: 'Cancel an invoice',
    description:
      'Answers 200 when a queued invoice is cancelled locally, and 202 while the NFS-e cancellation event is processed or when the request is registered on an invoice still being issued (`processing`, with `cancellationRequestedAt` set). `description` (15 to 255 characters) is required. An authorized invoice is cancelled at the Sefin (event 101101) and its credit is not refunded; if a processing emission ends rejected or failed the request is discarded and the reservation is refunded as usual. Repeating the request returns the current state (the first request wins). `retry_pending`, `reconciliation_required` and `manual_review` answer 409 `ERROR_INVOICE_NOT_CANCELLABLE`.\n\n**For an NF-e:** Only for an NF-e in `authorized`. The body is the justification (15 to 255 characters, `422 JUSTIFICATION_LENGTH`). Answers `202` with the NF-e in `cancelling`; the SEFAZ answer comes by webhook (`nfe.document.cancelled`, or `nfe.document.cancellation_rejected` with the reason as the SEFAZ wrote it, and the NF-e goes back to `authorized`) and in `GET /invoices/{id}/events`. If the SEFAZ does not answer, the event stays `pending_check` and Corvo checks by the key; the same signed request is the only one ever sent. The legal deadline depends on the state: past it, the SEFAZ rejection is shown as it comes. **Cancelling does not give the credit back** (the NF-e was authorized). Any other state answers `409 NFE_INVALID_STATE`.\n\n**For a NFC-e:** Same as the NF-e, with `nfce.document.cancelled` and `nfce.document.cancellation_rejected`. The state allows a short window after the authorization (30 minutes in SP); past it the SEFAZ refuses, the NFC-e goes back to `authorized` and `lastError` carries the refusal with a `hint`.',
    ok: {
      200: data(ref('InvoiceResponseDto')),
      202: data({ oneOf: [ref('InvoiceResponseDto'), ref('Nfe')] }),
    },
    errors: [409, 422],
    requestBody: {
      oneOf: [ref('CancelInvoice'), ref('CancelNfe')],
    },
  },
  'POST /invoices/{id}/substitute': {
    id: 'invoices_substitute',
    tag: 'Invoices',
    idempotent: true,
    errors: [402],
  },
  'GET /companies/{companyId}/invoice-package': {
    id: 'invoicePackage_download',
    tag: 'Invoices',
    errors: [422],
    file: {
      contentType: 'application/zip',
      description:
        'ZIP with `xml/`, `pdf/` and `resumo.csv` (the last file: a ZIP without it is incomplete).',
    },
    paramDescriptions: {
      month: 'Competence month, `YYYY-MM`.',
      include: 'Comma-separated parts to include: `xml`, `pdf`. Default: both.',
    },
  },
  'GET /companies/{companyId}/invoice-package/summary': {
    id: 'invoicePackage_summary',
    tag: 'Invoices',
    description:
      'How many authorized and cancelled invoices the competence month has and their total, without building the ZIP. Use it to check the package fits the limit before downloading.',
    ok: { 200: data(ref('PackageSummary')) },
    paramDescriptions: { month: 'Competence month, `YYYY-MM`.' },
  },
  'GET /fiscal-portal/status': {
    id: 'fiscalPortal_status',
    tag: 'Invoices',
    description:
      'Whether the national NFS-e portal is answering for the environment of the key. While `available` is false, invoices wait in the queue and are sent once the portal answers again.',
    ok: { 200: data(ref('PortalStatus')) },
  },

  // --- Companies -----------------------------------------------------------
  'POST /companies': {
    id: 'companies_create',
    tag: 'Companies',
    description:
      'Creates a company in the environment of the API key (`corvo_test_` or `corvo_live_`). The CNPJ cannot be changed later. The answer may carry `warnings` when the public CNPJ registry disagrees with what you sent.',
    ok: { 201: data(ref('Company')) },
    errors: [409, 422],
  },
  'GET /companies': {
    id: 'companies_list',
    tag: 'Companies',
    description:
      'The companies of the workspace in the environment of the API key, with what is still missing in `setupGaps`.',
    ok: { 200: page(ref('Company')) },
  },
  'GET /companies/{id}': {
    id: 'companies_get',
    tag: 'Companies',
    description:
      'One company with its current tax regime, `setupGaps` and, when known, the `municipalityAgreement` the Receita reported.',
    ok: { 200: data(ref('Company')) },
  },
  'PATCH /companies/{id}': {
    id: 'companies_update',
    tag: 'Companies',
    // The CNPJ is immutable: the same value is a no-op and any other is a 422.
    dropBodyProps: ['taxId'],
    description:
      'Changes the listed fields; omitted fields stay. Send `null` in `municipalReg` to clear it. The CNPJ (`taxId`) cannot be changed.',
    ok: { 200: data(ref('Company')) },
    errors: [409, 422],
  },
  'DELETE /companies/{id}': {
    id: 'companies_delete',
    tag: 'Companies',
    description: 'Soft-deletes the company. Issued invoices are kept.',
    ok: { 200: nothing },
  },
  'GET /companies/{id}/nfe-settings': {
    id: 'companies_getNfeSettings',
    tag: 'NF-e',
    description:
      'The NF-e settings of the company (state registration, CRT, default series and Simples tax defaults) and `missing`, the list of what the company still lacks to issue an NF-e.\n\nPermission: `nfe.documents.view`.',
    ok: { 200: data(ref('NfeSettings')) },
  },
  'PUT /companies/{id}/nfe-settings': {
    id: 'companies_updateNfeSettings',
    tag: 'NF-e',
    description:
      'Sets the NF-e settings of the company. The state registration is validated for the state of the company (422 `STATE_REGISTRATION_INVALID`); left out, the IE the SEFAZ has for the CNPJ is used when there is exactly one enabled (else 422 `STATE_REGISTRATION_REQUIRED`). The saved IE is checked at the SEFAZ cadastro: a refusal comes as `registrationWarning`, never as an error. Fields left out take their defaults.\n\nPermission: `nfe.documents.manage`.',
    ok: { 200: data(ref('NfeSettings')) },
    errors: [422],
  },
  'GET /companies/{id}/nfe-readiness': {
    id: 'companies_getNfeReadiness',
    tag: 'NF-e',
    description:
      'Can the company issue NF-e and NFC-e? Asks the SEFAZ "Consulta Cadastro" (with the company certificate) which state registrations (IE) the CNPJ has and whether they are enabled, and answers a `status` with a plain `message`. A company with no IE (service-only) cannot issue NF-e/NFC-e. `suggestedStateRegistration` is the IE to save when the company has none yet. The consulta runs at the production SEFAZ cadastro even for test companies. UFs without the service answer `unavailable`.\n\nPermission: `nfe.documents.view`.',
    ok: { 200: data(ref('NfeReadiness')) },
  },
  'POST /invoices/validate': {
    id: 'invoices_validate',
    tag: 'Invoices',
    summary: 'Validate an NF-e or NFC-e without sending it (dry-run)',
    description:
      'Dry-run of `POST /invoices` with `type: "nfe"` (same body): runs the company checks, every validator and the official XSD, and answers `200` with `accessKeyPreview` (the key the next NF-e would get; it changes at each call) or `422` with all the problems at once. Nothing is saved, no credit is used and the SEFAZ is not called. Add `?includeXml=true` to get the preview XML (without a real signature).\n\nA `422` has `type` `validation` (fix the fields in `details`, `NFE_VALIDATION_FAILED`) or `configuration` (complete the company or use a test key: `COMPANY_NFE_INCOMPLETE`, `NFE_PRODUCTION_DISABLED`, and `UF_NOT_ENABLED` for a NFC-e from a state with no NFC-e addresses yet). In `live`, while production is not turned on, the answer is `422 NFE_PRODUCTION_DISABLED`; use a test key.\n\n**With `type: "nfce"`:** the same dry-run for a NFC-e (model 65, sale to the final consumer, homologation only): the consumer is optional (the CPF or CNPJ is required from the limit of the state, R$ 10.000,00 by default, and for a delivery sale, `indPres` 4), payments may carry the `card` group, and the preview XML has the QR Code (`infNFeSupl`). Besides `NFE_VALIDATION_FAILED`, the issues can be `NFCE_CONSUMER_ID_REQUIRED`, `NFCE_DELIVERY_ADDRESS_REQUIRED`, `NFCE_IND_PRES_INVALID`, `NFCE_CARD_DATA_REQUIRED`, `NFCE_CARD_BRAND_INVALID`, `NFCE_CARD_NOT_ALLOWED`, `NFCE_NO_PAYMENT_AMOUNT` and `NFCE_SCOPE_NOT_SUPPORTED`.',
    ok: { 200: data(ref('NfeValidation')) },
    errors: [422],
    requestBody: {
      oneOf: [ref('NfeInvoiceRequest'), ref('NfceInvoiceRequest')],
      discriminator: {
        propertyName: 'type',
        mapping: {
          nfe: '#/components/schemas/NfeInvoiceRequest',
          nfce: '#/components/schemas/NfceInvoiceRequest',
        },
      },
    },
    paramDescriptions: {
      includeXml: 'Send `true` to receive the preview XML in `xml`.',
    },
  },
  'POST /invoices/{id}/sync': {
    id: 'invoices_sync',
    tag: 'Invoices',
    summary: 'Ask the SEFAZ about the NF-e by its key',
    description:
      'For an NF-e in `reconciliation_required` or `manual_review`: asks the SEFAZ what it has for the key and adopts it (authorized, denied or cancelled). If the SEFAZ still does not know the key after the waiting window, the **same** signed XML is sent again: the number and the key never change. An NF-e that is already settled is returned as it is; one still `queued`, `processing` or `retry_pending` answers `409 NFE_INVALID_STATE`.',
    bodyOptional: true,
    ok: { 200: data(ref('Nfe')) },
    errors: [409, 422],
  },
  'PUT /invoices/{id}': {
    id: 'invoices_resubmit',
    tag: 'Invoices',
    summary: 'Correct and send a rejected NF-e again',
    description:
      'Only for an NF-e in `rejected`. The body is the same as `POST /invoices` with `type: "nfe"`: it replaces the content, keeps the **number** and draws a new key. Answers `202` (`queued`); the same body sent again answers `200` with `replayed: true`. In `live` it reserves one credit again (the rejection gave it back). Any other state answers `409 NFE_INVALID_STATE`.',
    ok: {
      200: data(ref('NfeAccepted')),
      202: data(ref('NfeAccepted')),
    },
    errors: [409, 422],
    requestBody: ref('NfeRequest'),
  },
  'POST /invoices/{id}/discard': {
    id: 'invoices_discard',
    tag: 'Invoices',
    summary: 'Give up a rejected NF-e',
    description:
      'Only for an NF-e in `rejected`: it ends `discarded` (the credit was already given back by the rejection). The number it used stays burned: it is a gap that an inutilization closes. Any other state answers `409 NFE_INVALID_STATE`.',
    bodyOptional: true,
    ok: { 200: data(ref('Nfe')) },
    errors: [409, 422],
  },
  'POST /invoices/{id}/corrections': {
    id: 'invoices_correct',
    tag: 'Invoices',
    summary: 'Send a correction letter (CC-e)',
    description:
      'Only for an NF-e in `authorized`. The body is the correction (15 to 1000 characters, `422 CORRECTION_LENGTH`); it cannot change values, taxes, the parties or the dates. Each letter takes the next `sequence` (`nSeqEvento`), even if two arrive at once; the 21st answers `422 CORRECTION_LIMIT_REACHED`. Answers `202` with the event in `pending`; the result comes by webhook (`nfe.document.corrected`) and in `GET /invoices/{id}/events`. The newest letter replaces the earlier ones. A letter costs no credit and does not change the state of the NF-e. Any other state answers `409 NFE_INVALID_STATE`. A NFC-e has no correction letter: `422 INVOICE_OPERATION_NOT_SUPPORTED`.',
    ok: { 202: data(ref('NfeEvent')) },
    errors: [409, 422],
    requestBody: ref('CorrectNfe'),
  },
  'POST /invoices/inutilizations': {
    id: 'invoices_createInutilization',
    tag: 'Invoices',
    summary: 'Inutilize a range of NF-e or NFC-e numbers',
    idempotent: true,
    description:
      'Voids the numbers `start` to `end` of a series that will never be used (the numbers of an NF-e that was `discarded`, or skipped). Answers `202` with the request in `pending`; the result comes by webhook (`nfe.inutilization.completed` or `nfe.inutilization.rejected`) and in `GET /invoices/inutilizations?type=nfe`. The range is refused with `409 INUTILIZATION_RANGE_IN_USE` when an NF-e that is not `discarded` holds a number in it, and with `409 INUTILIZATION_RANGE_OVERLAP` when another request, waiting or approved, covers part of it. A range that goes past the last number used raises the numbering to `end`, so the numbers voided are never emitted. The justification has 15 to 255 characters (`422 JUSTIFICATION_LENGTH`). `Idempotency-Key` is optional: repeating it with the same body answers `200` with `replayed: true`; with another body, `409 IDEMPOTENCY_KEY_REUSED`.\n\n**With `type: "nfce"`:** the same for the numbers of the NFC-e series (model 65, its own numbering); the webhooks are `nfce.inutilization.completed` and `nfce.inutilization.rejected`.',
    ok: {
      200: data(ref('NfeInutilization')),
      202: data(ref('NfeInutilization')),
    },
    errors: [400, 409, 422],
    requestBody: {
      allOf: [
        ref('InutilizeNfe'),
        {
          type: 'object',
          required: ['type'],
          properties: { type: { type: 'string', enum: ['nfe', 'nfce'] } },
        },
      ],
    },
  },
  'GET /invoices/inutilizations': {
    id: 'invoices_listInutilizations',
    tag: 'Invoices',
    summary: 'List NF-e or NFC-e inutilizations',
    description:
      'The inutilization requests of the environment of the key, newest first. Filter by `companyId` and `status`. `type` picks the model: `nfe` (55) or `nfce` (65).',
    ok: { 200: page(ref('NfeInutilization')) },
    errors: [422],
    extraParams: [
      {
        name: 'type',
        in: 'query',
        required: true,
        description:
          '`nfe` (model 55) or `nfce` (model 65): inutilizations and number gaps exist only for these.',
        schema: { type: 'string', enum: ['nfe', 'nfce'] },
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 1000, default: 50 },
      },
      {
        name: 'cursor',
        in: 'query',
        required: false,
        description: 'Opaque cursor from the previous page.',
        schema: { type: 'string' },
      },
      {
        name: 'companyId',
        in: 'query',
        required: false,
        description: 'Only this company.',
        schema: { type: 'string', format: 'uuid' },
      },
      {
        name: 'status',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['pending', 'homologada', 'rejected'] },
      },
    ],
  },
  'GET /invoices/number-gaps': {
    id: 'invoices_numberGaps',
    tag: 'Invoices',
    summary: 'List the numbering gaps',
    description:
      'The numbers, from 1 to the last one used, that no NF-e holds (anything but `discarded`) and no approved inutilization covers, grouped in runs per company and series. It is computed when asked. A daily job only writes them to the log: nothing is inutilized by itself.',
    ok: { 200: list(ref('NfeNumberGap')) },
    errors: [422],
    extraParams: [
      {
        name: 'type',
        in: 'query',
        required: true,
        description:
          '`nfe` (model 55) or `nfce` (model 65): inutilizations and number gaps exist only for these.',
        schema: { type: 'string', enum: ['nfe', 'nfce'] },
      },
      {
        name: 'companyId',
        in: 'query',
        required: false,
        description: 'Only this company.',
        schema: { type: 'string', format: 'uuid' },
      },
    ],
  },
  'GET /companies/{id}/dps-sequence': {
    id: 'dpsSequence_get',
    tag: 'Companies',
    description:
      'The DPS series and the last number used. Each invoice takes the next number; the Receita refuses a repeated one (`E0014`).',
    ok: { 200: data(ref('DpsSequence')) },
  },
  'PUT /companies/{id}/dps-sequence': {
    id: 'dpsSequence_set',
    tag: 'Companies',
    description:
      'Use it when the company already issued notes in another system or in the Portal Nacional, so the next DPS does not repeat a number the Receita has (`E0014`). It only moves forward: a lower number answers 422 `DPS_NUMBER_BELOW_CURRENT`.',
    ok: { 200: data(ref('DpsSequence')) },
    errors: [422],
  },
  'POST /companies/{id}/dps-sequence/check': {
    id: 'dpsSequence_check',
    tag: 'Companies',
    description:
      'Asks the government whether the next DPS numbers (up to 20 in a row) were already used. It only reads: it issues nothing and changes no number. 503 `DPS_NUMBERING_CHECK_UNAVAILABLE` means the government gave no answer: try again later.',
    ok: { 200: data(ref('DpsNumberingCheck')) },
    errors: [503],
  },
  'POST /companies/{id}/dps-sequence/confirm': {
    id: 'dpsSequence_confirm',
    tag: 'Companies',
    description:
      'Marks the numbering as checked, so the first note is not held back. With `lastNumber` it first moves the numbering forward (never back; a lower number answers 422 `DPS_NUMBER_BELOW_CURRENT`).',
    ok: { 200: data(ref('DpsSequence')) },
    errors: [422],
    bodyOptional: true,
  },
  'GET /companies/{id}/fiscal-profile': {
    id: 'fiscalProfiles_list',
    tag: 'Companies',
    description:
      'The fiscal profile history of the company (tax regime, Simples Nacional, special regime, IBS/CBS option) by validity period.',
    ok: { 200: list(ref('FiscalProfile')) },
  },
  'PUT /companies/{id}/fiscal-profile': {
    id: 'fiscalProfiles_upsert',
    tag: 'Companies',
    description:
      'Opens a new validity period for the fiscal profile. Sending a state equal to the open one changes nothing, so the call is safe to repeat. Only `MEI` and `SIMPLES_NACIONAL` can issue today: any other `taxRegime` answers 422 `ERROR_TAX_REGIME_NOT_SUPPORTED`.',
    ok: { 200: data(ref('FiscalProfile')) },
    errors: [422],
  },
  'POST /companies/{id}/fiscal-profile/{profileId}/approve': {
    id: 'fiscalProfiles_approve',
    tag: 'Companies',
    description: 'Marks a fiscal profile as reviewed and approved.',
    ok: { 201: data(ref('FiscalProfile')) },
  },
  'GET /companies/{id}/service-tax-profiles': {
    id: 'serviceTaxProfiles_list',
    tag: 'Companies',
    description:
      'The service tax profiles (classification of each service the company sells) effective on `date` (default: today in America/Sao_Paulo).',
    ok: { 200: list(ref('ServiceTaxProfile')) },
  },
  'POST /companies/{id}/service-tax-profiles': {
    id: 'serviceTaxProfiles_create',
    tag: 'Companies',
    description:
      'Adds a service to the company catalog with its tax classification (NBS, CST, class code, ISS and withholdings). It starts `unreviewed`.',
    ok: { 201: data(ref('ServiceTaxProfile')) },
    errors: [422],
  },
  'PATCH /companies/{id}/service-tax-profiles/{serviceId}': {
    id: 'serviceTaxProfiles_update',
    tag: 'Companies',
    description:
      'Changes the listed fields of a service tax profile; omitted fields stay.',
    ok: { 200: data(ref('ServiceTaxProfile')) },
    errors: [422],
  },
  'POST /companies/{id}/service-tax-profiles/{serviceId}/approve': {
    id: 'serviceTaxProfiles_approve',
    tag: 'Companies',
    description:
      'Approves the saved tax classification of the service for this company.',
    ok: { 201: data(ref('ServiceTaxProfile')) },
  },
  'DELETE /companies/{id}/service-tax-profiles/{serviceId}': {
    id: 'serviceTaxProfiles_delete',
    tag: 'Companies',
    description: 'Deletes a profile that has expired and was never approved.',
    ok: { 200: nothing },
    errors: [422],
  },
  'GET /companies/{companyId}/accountant-package': {
    id: 'accountantPackage_get',
    tag: 'Companies',
    description:
      'The accountant e-mail that receives the monthly ZIP of the company, and the last month sent.',
    ok: { 200: data(ref('AccountantSettings')) },
  },
  'PUT /companies/{companyId}/accountant-package': {
    id: 'accountantPackage_update',
    tag: 'Companies',
    description:
      'Sets the accountant e-mail. `null` or blank turns the monthly send off. A short hello goes to a new address (live companies only) so a wrong recipient is noticed.',
    ok: { 200: data(ref('AccountantSettingsUpdate')) },
  },
  'POST /companies/{companyId}/accountant-package/send': {
    id: 'accountantPackage_send',
    tag: 'Companies',
    description:
      'Builds and e-mails the package of `month` now, even if that month was already sent. 10 per hour. `status` says what happened.',
    ok: { 200: data(ref('AccountantSendResult')) },
  },
  'GET /companies/{companyId}/accountant-package/sends': {
    id: 'accountantPackage_listSends',
    tag: 'Companies',
    description:
      'The last 12 attempts to send the package. `status` `sent` means queued for e-mail, not proof of delivery.',
    ok: { 200: list(ref('AccountantSend')) },
  },

  // --- Certificates --------------------------------------------------------
  'GET /companies/{companyId}/certificates': {
    id: 'certificates_list',
    tag: 'Certificates',
    description:
      'The certificates of the company. Only metadata is returned, never the file or the password.',
    ok: { 200: page(ref('Certificate')) },
  },
  'POST /companies/{companyId}/certificates': {
    id: 'certificates_upload',
    tag: 'Certificates',
    description:
      'Uploads the A1 certificate as a multipart form: `file` (the `.pfx`/`.p12`, up to 50 KB) and `password`. The certificate must belong to the company CNPJ and be in date. The file and password are never returned.',
    ok: { 201: data(ref('Certificate')) },
    errors: [413, 422],
    multipart: {
      type: 'object',
      required: ['file', 'password'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'The PKCS#12 file (`.pfx` or `.p12`), up to 50 KB.',
        },
        password: {
          type: 'string',
          format: 'password',
          description: 'Password of the certificate.',
        },
      },
    },
  },
  'DELETE /companies/{companyId}/certificates/{certId}': {
    id: 'certificates_revoke',
    tag: 'Certificates',
    description:
      'Revokes and deletes a certificate. The company cannot issue until another one is uploaded.',
  },

  // --- Customers -----------------------------------------------------------
  'GET /cnpj/{cnpj}': {
    id: 'cnpj_lookup',
    tag: 'Customers',
    description:
      'Public registry data of a CNPJ (names, address, Simples/MEI, situation, activities/CNAE and a suggested service code), to pre-fill a company or a customer. Answers 400 `CNPJ_INVALID` for a malformed CNPJ and 404 `CNPJ_NOT_FOUND` when the registry does not know the CNPJ and 503 `CNPJ_LOOKUP_UNAVAILABLE` when it has no answer right now. 20 requests per minute.',
    ok: { 200: data(ref('CnpjProfile')) },
  },
  'GET /customers': {
    id: 'customers_search',
    tag: 'Customers',
    description:
      'Customers saved from accepted invoices, most recently used first. `search` matches part of the name or the first digits of the CPF/CNPJ. The `cursor` is the offset of the next page and is opaque to clients.',
    ok: { 200: page(ref('SavedCustomer')) },
  },
  'GET /customers/{taxId}': {
    id: 'customers_get',
    tag: 'Customers',
    description:
      'A customer saved from an accepted invoice, found by CPF or CNPJ (digits).',
    ok: { 200: data(ref('SavedCustomer')) },
  },
  'PATCH /customers/{taxId}': {
    id: 'customers_update',
    tag: 'Customers',
    description:
      'Corrects the name or e-mail of a saved customer. Send `email: null` to clear it. Issued invoices are not changed.',
    ok: { 200: data(ref('SavedCustomer')) },
  },
  'DELETE /customers/{taxId}': {
    id: 'customers_delete',
    tag: 'Customers',
    description: 'Forgets a saved customer. Issued invoices are not changed.',
    ok: { 200: nothing },
  },

  // --- Service favorites ---------------------------------------------------
  'GET /companies/{companyId}/service-favorites': {
    id: 'serviceFavorites_list',
    tag: 'Service favorites',
    description: 'The services the company saved to reuse when issuing.',
    ok: { 200: list(ref('ServiceFavorite')) },
  },
  'POST /companies/{companyId}/service-favorites': {
    id: 'serviceFavorites_create',
    tag: 'Service favorites',
    description:
      'Saves a service (label, description, service code and, optionally, a default amount and municipality) for the company.',
    ok: { 201: data(ref('ServiceFavorite')) },
  },
  'DELETE /companies/{companyId}/service-favorites/{favoriteId}': {
    id: 'serviceFavorites_delete',
    tag: 'Service favorites',
    description: 'Removes a favorite service. Issued invoices are not changed.',
    ok: { 200: data(ref('Deleted')) },
  },

  // --- Schedules -----------------------------------------------------------
  'GET /schedules': {
    id: 'schedules_list',
    tag: 'Schedules',
    description:
      'Scheduled (`once`) and recurring invoices. The `cursor` is the offset of the next page and is opaque to clients.',
    ok: { 200: page(ref('ScheduleResponseDto')) },
  },
  'GET /schedules/{id}': {
    id: 'schedules_get',
    tag: 'Schedules',
    description:
      'One schedule with its next run and the invoice body each run issues.',
    ok: { 200: data(ref('ScheduleResponseDto')) },
  },
  'PATCH /schedules/{id}': {
    id: 'schedules_update',
    tag: 'Schedules',
    description:
      'Changes the schedule; the change applies to the next runs only. `invoice` is merged over the stored body and validated like an emission.',
    ok: { 200: data(ref('ScheduleResponseDto')) },
    errors: [422],
  },
  'POST /schedules/{id}/pause': {
    id: 'schedules_pause',
    tag: 'Schedules',
    description:
      'Pauses a schedule. Resume it to continue at its next occurrence.',
    ok: { 200: data(ref('ScheduleResponseDto')) },
  },
  'POST /schedules/{id}/resume': {
    id: 'schedules_resume',
    tag: 'Schedules',
    description: 'Resumes a paused schedule at its next occurrence.',
    ok: { 200: data(ref('ScheduleResponseDto')) },
  },
  'POST /schedules/{id}/cancel': {
    id: 'schedules_cancel',
    tag: 'Schedules',
    description:
      'Cancels a schedule for good. Invoices already issued are not changed.',
    ok: { 200: data(ref('ScheduleResponseDto')) },
  },
  'GET /schedules/{id}/runs': {
    id: 'schedules_listRuns',
    tag: 'Schedules',
    description:
      'The log of every attempt to run the schedule, newest first. The `cursor` is the offset of the next page and is opaque to clients.',
    ok: { 200: page(ref('ScheduleRunResponseDto')) },
    dropParams: ['status', 'companyId'],
  },

  // --- Imports -------------------------------------------------------------
  'POST /imports': {
    id: 'imports_start',
    tag: 'Imports',
    ok: { 202: data(ref('ImportStart')) },
    errors: [413, 422],
    multipart: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'A `.csv` or `.xlsx` file, up to 2,000 rows and 10 MB.',
        },
        companyId: {
          type: 'string',
          format: 'uuid',
          description:
            'Company that issues every row that has no CNPJ column value. A row whose CNPJ differs from it is rejected.',
        },
      },
    },
  },
  'GET /imports': {
    id: 'imports_list',
    tag: 'Imports',
    description:
      'The most recent imports with their counters (newest first, up to `limit`, at most 20). Lets a user pick an import up again, for example after topping up credits.',
    ok: { 200: list(ref('ImportJob')) },
  },
  'GET /imports/template': {
    id: 'imports_downloadTemplate',
    tag: 'Imports',
    description: 'The CSV template with every column the import understands.',
    file: {
      contentType: 'text/csv',
      description: 'The CSV template with every column.',
    },
  },
  'GET /imports/{id}': {
    id: 'imports_get',
    tag: 'Imports',
    description:
      'Status and counters of an import. `status`: `processing` (reading), `ready` (review), `emitting`, `done`, `failed`.',
    ok: { 200: data(ref('ImportJob')) },
  },
  'POST /imports/{id}/emit': {
    id: 'imports_emit',
    tag: 'Imports',
    bodyOptional: true,
    description:
      'Sends every valid row to be issued. Safe to call twice. After a plan limit stopped the import, call it again once credits are available: only the rows the limit turned away are sent. With `sendEmail` each issued invoice is e-mailed to its customer.',
    ok: { 202: data(ref('ImportJob')) },
    errors: [402, 409],
  },
  'GET /imports/{id}/rows': {
    id: 'imports_listRows',
    tag: 'Imports',
    description:
      'The rows of an import, one page at a time (default 50, at most 200), optionally filtered by row `status`.',
    ok: { 200: page(ref('ImportRow')) },
  },
  'PATCH /imports/{id}/rows/{line}': {
    id: 'imports_updateRow',
    tag: 'Imports',
    description:
      'Corrects one row and checks it again. Only while the import is `ready`.',
    ok: { 200: data(ref('ImportRow')) },
    errors: [409],
  },
  'DELETE /imports/{id}': {
    id: 'imports_discard',
    tag: 'Imports',
    description: 'Discards an import that has not been emitted.',
    errors: [409],
  },
  'GET /imports/{id}/errors.csv': {
    id: 'imports_downloadErrors',
    tag: 'Imports',
    description:
      'A CSV with the rows that need attention and the reason, streamed.',
    file: {
      contentType: 'text/csv',
      description: 'The rows that need attention, with the reason.',
    },
  },

  // --- Webhooks ------------------------------------------------------------
  'GET /webhooks': {
    id: 'webhooks_list',
    tag: 'Webhooks',
    description:
      'The webhook endpoints of the workspace. The signing secret is never returned here.',
    ok: { 200: page(ref('Webhook')) },
  },
  'POST /webhooks': {
    id: 'webhooks_create',
    tag: 'Webhooks',
    description:
      'Registers an endpoint for the invoice events listed in `events`. The signing `secret` is returned only here. A key created with a test API key only receives test events.',
    ok: { 201: data(ref('WebhookWithSecret')) },
  },
  'DELETE /webhooks/{id}': {
    id: 'webhooks_delete',
    tag: 'Webhooks',
    description: 'Deletes a webhook endpoint. Pending deliveries to it stop.',
    ok: { 200: data(ref('Deleted')) },
  },
  'POST /webhooks/{id}/test': {
    id: 'webhooks_test',
    tag: 'Webhooks',
    description:
      'Queues a `webhook.test` event to the endpoint. The answer says whether it was handed over.',
    ok: { 200: data(ref('WebhookTestResult')) },
  },
  'GET /webhooks/deliveries': {
    id: 'webhookDeliveries_list',
    tag: 'Webhooks',
    description:
      'Recent deliveries (last 24 hours by default, up to 30 days with `hours`) with the endpoint answer, newest first. Filter by `invoice_id` (NFS-e), `document_id` (NF-e), `event_type` or `status`.',
    ok: { 200: page(ref('WebhookDelivery')) },
    extraParams: [...DELIVERY_PARAMS, ...DELIVERY_FILTERS],
  },
  'GET /webhooks/deliveries/stats': {
    id: 'webhookDeliveries_stats',
    tag: 'Webhooks',
    description:
      'Counts of deliveries by state over the last `hours` (default 24).',
    ok: { 200: data(ref('WebhookStats')) },
    dropParams: ['limit', 'cursor'],
    extraParams: DELIVERY_PARAMS,
  },
  'POST /webhooks/deliveries/{id}/retry': {
    id: 'webhookDeliveries_retry',
    tag: 'Webhooks',
    description:
      'Queues a failed or delayed delivery to be sent again, with the exact same event body.',
    ok: { 200: data(ref('WebhookRetried')) },
  },

  // --- Credits and billing -------------------------------------------------
  'GET /credits': {
    id: 'credits_getBalance',
    tag: 'Credits and billing',
    description:
      'The notes available now: plan notes left plus loose notes bought separately. Notes the plan no longer pays for (a lapsed plan) are not counted.',
    ok: { 200: data(ref('CreditBalance')) },
  },
  'GET /credits/plans': {
    id: 'credits_listPlans',
    tag: 'Credits and billing',
    description: 'The plan catalog with allowances and limits.',
    ok: { 200: page(ref('Plan')) },
  },
  'GET /plans': {
    id: 'plans_list',
    tag: 'Credits and billing',
    ok: { 200: page(ref('PlanPrice')) },
    paramDescriptions: {
      cycle:
        'Billing cycle of the prices (default `monthly`; `annual` is discounted).',
    },
  },
  'GET /plans/{slug}': {
    id: 'plans_get',
    tag: 'Credits and billing',
    ok: { 200: data(ref('PlanPrice')) },
    errors: [400],
    paramDescriptions: {
      slug: 'The plan: `solo`, `equipe`, `empresa` or `escala`.',
      cycle:
        'Billing cycle of the price (default `monthly`; `annual` is discounted).',
    },
  },
  'GET /credits/purchase/preview': {
    id: 'credits_previewPurchase',
    tag: 'Credits and billing',
    description:
      'Prices a one-off purchase of `units` notes (R$ 0,99 each, minimum 3) without buying. Buying is done in the dashboard.',
    ok: { 200: data(ref('PurchasePreview')) },
    paramDescriptions: {
      units: 'How many notes to price (an integer, at least 3).',
    },
  },
  'GET /credits/history': {
    id: 'credits_listHistory',
    tag: 'Credits and billing',
    description: 'The credit transactions of the workspace, newest first.',
    ok: { 200: page(ref('CreditTransaction')) },
  },
  'GET /billing/plan': {
    id: 'billing_getPlan',
    tag: 'Credits and billing',
    summary: 'Get the current plan, subscription and usage',
    description:
      'Fields are `snake_case`. Answers 404 `NO_PLAN_ASSIGNED` when the workspace has no plan.',
    ok: { 200: data(ref('BillingPlan')) },
  },
  'GET /billing/usage': {
    id: 'billing_getUsage',
    tag: 'Credits and billing',
    summary: 'Get the quota status of the period',
    description:
      'Whether the workspace can issue now (`canEmit`) and, if not, why (`reason`).',
    ok: { 200: data(ref('QuotaStatus')) },
  },

  // --- Integrations --------------------------------------------------------
  'GET /integrations/providers': {
    id: 'integrations_listProviders',
    tag: 'Integrations',
    description:
      'The payment platforms Corvo can connect to, with the credentials each one needs and the webhook setup instructions.',
    ok: { 200: list(ref('IntegrationProvider')) },
  },
  'POST /integrations/connections': {
    id: 'integrationConnections_create',
    tag: 'Integrations',
    description:
      'Connects a payment platform to a company. The answer carries the `webhookUrl` to paste in the platform and, once, the generated `secrets`. A test API key cannot create or see live connections.',
    ok: { 201: data(ref('IntegrationConnectionCreated')) },
    errors: [422],
  },
  'GET /integrations/connections': {
    id: 'integrationConnections_list',
    tag: 'Integrations',
    description:
      'The connections of the workspace. A key only sees connections of its own environment.',
    ok: { 200: list(ref('IntegrationConnection')) },
  },
  'GET /integrations/connections/{id}': {
    id: 'integrationConnections_get',
    tag: 'Integrations',
    description:
      'One connection with the `webhookUrl` to paste in the platform.',
    ok: { 200: data(ref('IntegrationConnection')) },
  },
  'POST /integrations/connections/{id}/validate': {
    id: 'integrationConnections_validate',
    tag: 'Integrations',
    description:
      'Checks the stored credentials against the platform and identifies the external account.',
    ok: { 200: data(ref('IntegrationConnection')) },
  },
  'PUT /integrations/connections/{id}/credentials': {
    id: 'integrationConnections_updateCredentials',
    tag: 'Integrations',
    description:
      'Replaces the credentials, for example after rotating a key in the platform.',
    ok: { 200: data(ref('IntegrationConnection')) },
  },
  'POST /integrations/connections/{id}/activate': {
    id: 'integrationConnections_activate',
    tag: 'Integrations',
    description:
      'Starts issuing invoices automatically for the sales the platform reports from `activeFrom` on.',
    ok: { 200: data(ref('IntegrationConnection')) },
    errors: [409],
  },
  'POST /integrations/connections/{id}/pause': {
    id: 'integrationConnections_pause',
    tag: 'Integrations',
    description:
      'Stops issuing; events from the platform are still recorded and can be handled after resuming.',
    ok: { 200: data(ref('IntegrationConnection')) },
    errors: [409],
  },
  'POST /integrations/connections/{id}/disconnect': {
    id: 'integrationConnections_disconnect',
    tag: 'Integrations',
    description:
      'Disconnects for good. It cannot be reactivated: create a new connection.',
    ok: { 200: data(ref('IntegrationConnection')) },
    errors: [409],
  },
  'GET /integrations/connections/{id}/rules': {
    id: 'integrationConnections_listRules',
    tag: 'Integrations',
    description:
      'The rules that decide which service each product is invoiced as. The rule without `externalProductId` is the default.',
    ok: { 200: list(ref('IntegrationRule')) },
  },
  'PUT /integrations/connections/{id}/rules': {
    id: 'integrationConnections_replaceRules',
    tag: 'Integrations',
    description:
      'Replaces all the rules of the connection (up to 50). Each `externalProductId` can have one rule, and only one rule can omit it.',
    ok: { 200: list(ref('IntegrationRule')) },
  },
  'GET /integrations/connections/{id}/events': {
    id: 'integrationConnections_listEvents',
    tag: 'Integrations',
    description:
      'The latest events the platform delivered to the connection, with their processing state.',
    ok: { 200: list(ref('IntegrationEvent')) },
    paramDescriptions: { limit: 'How many events (1 to 100, default 50).' },
  },
  'GET /integrations/connections/{id}/operations': {
    id: 'integrationConnections_listOperations',
    tag: 'Integrations',
    description:
      'The latest operations (sales) of the connection and the status of their invoices.',
    ok: { 200: list(ref('IntegrationOperation')) },
    paramDescriptions: { limit: 'How many operations (1 to 100, default 50).' },
  },
  'GET /integrations/operations': {
    id: 'integrationOperations_listPending',
    tag: 'Integrations',
    description:
      'Sales of every connection that wait for you (no invoice yet, `fiscalStatus` `needs_attention`), newest first.',
    ok: { 200: list(ref('IntegrationOperation')) },
    paramDescriptions: {
      environment: 'test or live (default live). An API key uses its own.',
      limit: 'How many sales (1 to 100, default 50).',
    },
  },
  'GET /integrations/operations/{id}': {
    id: 'integrationOperations_get',
    tag: 'Integrations',
    description:
      'One sale, with the service (code and description) its invoice would carry.',
    ok: { 200: data(ref('IntegrationOperationDetail')) },
    errors: [404],
  },
  'POST /integrations/operations/{id}/resolve': {
    id: 'integrationOperations_resolve',
    tag: 'Integrations',
    description:
      'Completes the data of a sale that waits for you (customer with CPF/CNPJ, name, e-mail and address; service code and description; whether to e-mail the invoice) and issues its invoice. Safe to repeat: a sale never gets two invoices. Answers 409 `OPERATION_HAS_INVOICE`, `OPERATION_NOT_RESOLVABLE` or `OPERATION_REQUEST_FIXED`, and 400 `INVALID_TAX_ID`.',
    ok: { 200: data(ref('IntegrationOperationResolved')) },
    errors: [400, 404, 409],
  },
  'POST /integrations/operations/{id}/ignore': {
    id: 'integrationOperations_ignore',
    tag: 'Integrations',
    description:
      'Marks a sale as one that needs no invoice (`blockReason` `ignored_by_user`). The reason is kept in the audit trail. Answers 409 `OPERATION_HAS_INVOICE` when it already has one.',
    ok: { 200: data(ref('IntegrationOperation')) },
    errors: [404, 409],
  },
  'PATCH /integrations/operations/{id}/customer': {
    id: 'integrationOperations_completeCustomer',
    tag: 'Integrations',
    description:
      'Fills in the customer of an operation that waits for it (`blockReason` `customer_tax_id_missing`) so its invoice can be issued.',
    ok: { 200: data(ref('IntegrationOperation')) },
  },
  'POST /integrations/operations/{id}/retry': {
    id: 'integrationOperations_retry',
    tag: 'Integrations',
    description:
      'Tries to issue the invoice of an operation again. Answers 409 `OPERATION_HAS_INVOICE` when it already has one.',
    ok: { 200: data(ref('IntegrationOperationRetry')) },
    errors: [409],
  },

  // --- Health --------------------------------------------------------------
  'GET /health/live': {
    id: 'health_live',
    tag: 'Health',
    ok: { 200: ref('Health') },
  },
};
