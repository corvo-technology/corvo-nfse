import { idPath, query, request, toPage, unwrap, type Page, type PageParams } from "./api";

/**
 * NF-e (goods, model 55) through the unified `/invoices` routes: the `type` of the request or the
 * type of the document decides. Types mirror what the API answers (camelCase).
 */
type Envelope<T> = { data: T };
type ListBody<T> = { data: T[]; pagination?: { limit?: number; hasMore?: boolean; nextCursor?: string | null } };

export const NFE_STATUSES = ["queued", "processing", "authorized", "rejected", "denied", "retry_pending", "reconciliation_required", "manual_review", "cancelling", "cancelled", "discarded"] as const;
export type NfeStatus = (typeof NFE_STATUSES)[number];

/** A problem the API found in one field; `field` is a path such as `items[1].ncm`. */
export interface ValidationIssue { field: string; code: string; message: string }

export interface NfeAddress { street: string; number: string; complement?: string | null; district: string; zip: string; cityCode: string; city: string; state: string }
export interface NfeRecipient { taxId: string; name: string; indIeDest: 1 | 2 | 9; stateRegistration?: string | null; email?: string | null; address: NfeAddress }
export interface NfeItemTaxInput { origin?: number; csosn?: string; pisCst?: string; cofinsCst?: string }
export interface NfeItemInput { code: string; gtin?: string | null; description: string; ncm: string; cest?: string | null; cfop: string; unit: string; quantity: number; unitPrice: number; discount?: number; freight?: number; insurance?: number; other?: number; tax?: NfeItemTaxInput }
export interface NfePaymentInput { tPag: string; amount: number }
/** Body of the dry-run, of the issue and of the resubmission (same body). */
export interface NfeCreateInput { companyId: string; natOp?: string; recipient: NfeRecipient; items: NfeItemInput[]; payments: NfePaymentInput[]; change?: number; additionalInfo?: string; externalId?: string; sendEmail?: boolean }

export interface NfeLastError { type: "communication" | "validation" | "configuration"; code: string; message: string; hint?: string; issues?: ValidationIssue[] }
export interface NfeItem { nItem: number; code: string; description: string; ncm: string; cfop: string; unit: string; quantity: string; unitPrice: string; total: string; tax?: { origin?: number; csosn?: string } }
export interface NfeDocument {
  type: "nfe"; id: string; companyId: string; environment: "test" | "live"; status: NfeStatus; series: number | null; number: number | null; accessKey: string | null;
  issuedAt: string | null; authorizedAt: string | null; protocol: string | null; cStat: string | null; xMotivo: string | null; cancelReason: string | null; cancelRequestedAt: string | null;
  natOp: string; recipient: NfeRecipient; items: NfeItem[]; totals: { vProd: string; vDesc: string; vFrete: string; vSeg: string; vOutro: string; vNF: string };
  payment: { payments: { tPag: string; amount: string }[]; change: string }; additionalInfo: string | null; externalId: string | null;
  documentsReady: boolean; documentsReadyAt: string | null; emailStatus: string | null; emailSentAt: string | null; attempt: number; lastError: NfeLastError | null; nextCheckAt: string | null; createdAt: string; updatedAt: string;
}
export interface NfeAccepted { type: "nfe"; id: string; status: NfeStatus; replayed?: true }
/** One line of the timeline: a state the note went through, or a fiscal event (cancellation, correction letter). */
export interface NfeTimelineEntry { kind: "status" | "event"; at: string; status: string; from: string | null; tpEvento: string | null; sequence: number | null; eventId: string | null; cStat: string | null; xMotivo: string | null }
export interface NfeFiscalEvent { id: string; documentId: string; type: "cancellation" | "correction"; sequence: number; status: string; text: string; protocol: string | null; cStat: string | null; xMotivo: string | null }
export interface NfeInutilization { id: string; companyId: string; series: number; start: number; end: number; justification: string; status: "pending" | "homologada" | "rejected"; protocol: string | null; cStat: string | null; xMotivo: string | null; createdAt: string; replayed?: true }
export interface NfeNumberGap { companyId: string; series: number; start: number; end: number }
export type NfeMissingField = string;
export interface NfeSettings {
  companyId: string; stateRegistration: string | null; crt: number | null; defaultSeries: number; defaultNatOp: string; defaultCsosn: string; defaultOrigin: number; defaultPisCst: string; defaultCofinsCst: string;
  enabledAt: string | null;
  /** What the company still lacks to issue an NF-e (`state_registration`, `crt`, `address`...). */
  missing: NfeMissingField[];
}
export interface NfeSettingsInput { stateRegistration: string; crt: 1 | 4; defaultSeries?: number; defaultNatOp?: string; defaultCsosn?: "102" | "400"; defaultOrigin?: number }
export interface NfeListQuery extends PageParams { companyId?: string; status?: NfeStatus }
export interface NfeDownload { downloadUrl: string; expiresAt: string; fileName: string; mimeType: string }

const body = (data: unknown, method = "POST"): RequestInit => ({ method, body: JSON.stringify(data) });
const withKey = (data: unknown, idempotencyKey: string, method = "POST"): RequestInit => ({ ...body(data, method), headers: { "idempotency-key": idempotencyKey } });

/** The dry-run: nothing is numbered, sent or charged. A 422 carries `details` with the fields. */
export const validateNfe = async (input: NfeCreateInput, signal?: AbortSignal) => unwrap(await request<Envelope<{ valid: true; accessKeyPreview: string }>>("/invoices/validate", { ...body({ type: "nfe", ...input }), signal }));
/** `idempotencyKey` is made once per form, so a double click never issues two notes. */
export const createNfe = async (input: NfeCreateInput, idempotencyKey: string) => unwrap(await request<Envelope<NfeAccepted>>("/invoices", withKey({ type: "nfe", ...input }, idempotencyKey)));
export const listNfe = async (params: NfeListQuery = {}, signal?: AbortSignal): Promise<Page<NfeDocument>> => toPage(await request<ListBody<NfeDocument>>(`/invoices${query({ type: "nfe", ...params })}`, { signal }));
export const getNfe = async (id: string, signal?: AbortSignal) => unwrap(await request<Envelope<NfeDocument>>(`/invoices/${idPath(id)}`, { signal }));
/** Asks the SEFAZ about a note that is waiting (`reconciliation_required`, `manual_review`). */
export const syncNfe = async (id: string) => unwrap(await request<Envelope<NfeDocument>>(`/invoices/${idPath(id)}/sync`, body({})));
export const cancelNfe = async (id: string, justification: string) => unwrap(await request<Envelope<NfeDocument>>(`/invoices/${idPath(id)}/cancel`, body({ justification })));
export const correctNfe = async (id: string, correction: string) => unwrap(await request<Envelope<NfeFiscalEvent>>(`/invoices/${idPath(id)}/corrections`, body({ correction })));
export const discardNfe = async (id: string) => unwrap(await request<Envelope<NfeDocument>>(`/invoices/${idPath(id)}/discard`, body({})));
/** Sends a rejected note again with the same number (the same body as a new one). */
export const resubmitNfe = async (id: string, input: NfeCreateInput, idempotencyKey: string) => unwrap(await request<Envelope<NfeAccepted>>(`/invoices/${idPath(id)}`, withKey(input, idempotencyKey, "PUT")));
export const listNfeEvents = async (id: string, signal?: AbortSignal) => unwrap(await request<Envelope<NfeTimelineEntry[]>>(`/invoices/${idPath(id)}/events`, { signal }));
/** The file itself (the API serves the authorized XML and the DANFE); for a link that expires use `nfeDownloadUrl`. */
export const nfeFile = (id: string, kind: "xml" | "pdf") => request<Blob>(`/invoices/${idPath(id)}/${kind}`, {}, true);
export const nfeDownloadUrl = async (id: string, format: "pdf" | "xml") => unwrap(await request<Envelope<NfeDownload>>(`/invoices/${idPath(id)}/download-url`, body({ format })));
export const listInutilizations = async (params: PageParams & { companyId?: string } = {}, signal?: AbortSignal): Promise<Page<NfeInutilization>> => toPage(await request<ListBody<NfeInutilization>>(`/invoices/inutilizations${query({ type: "nfe", ...params })}`, { signal }));
export const createInutilization = async (input: { companyId: string; series: number; start: number; end: number; justification: string }, idempotencyKey: string) => unwrap(await request<Envelope<NfeInutilization>>("/invoices/inutilizations", withKey({ type: "nfe", ...input }, idempotencyKey)));
export const listNumberGaps = async (companyId?: string, signal?: AbortSignal) => unwrap(await request<Envelope<NfeNumberGap[]>>(`/invoices/number-gaps${query({ type: "nfe", companyId })}`, { signal }));
export const getNfeSettings = async (companyId: string, signal?: AbortSignal) => unwrap(await request<Envelope<NfeSettings>>(`/companies/${idPath(companyId)}/nfe-settings`, { signal }));
export const updateNfeSettings = async (companyId: string, input: NfeSettingsInput) => unwrap(await request<Envelope<NfeSettings>>(`/companies/${idPath(companyId)}/nfe-settings`, body(input, "PUT")));

/** Waiting for the SEFAZ or for Corvo: the detail page keeps looking while the note is in one of these. */
export const NFE_PENDING: readonly NfeStatus[] = ["queued", "processing", "retry_pending", "reconciliation_required", "cancelling"];
export const isNfePending = (status: NfeStatus) => NFE_PENDING.includes(status);

/** What each action needs. The API checks again; this only keeps the buttons honest. */
export const nfeActions = (doc: Pick<NfeDocument, "status" | "documentsReady">, can: (permission: string) => boolean) => {
  const manage = can("nfe.documents.manage");
  const issue = can("nfe.documents.issue");
  return {
    sync: manage && (doc.status === "reconciliation_required" || doc.status === "manual_review"),
    cancel: manage && doc.status === "authorized",
    correct: manage && doc.status === "authorized",
    resubmit: issue && doc.status === "rejected",
    discard: manage && doc.status === "rejected",
    download: doc.documentsReady,
  };
};

export const JUSTIFICATION_MIN = 15;
export const JUSTIFICATION_MAX = 255;
export const CORRECTION_MAX = 1000;
export const nfeTaxIdDigits = (value: string) => value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
