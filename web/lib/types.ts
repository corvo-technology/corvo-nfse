// Base types
export type MessageStatus = "queued" | "sent" | "delivered" | "read" | "failed";
export type TemplateStatus = "draft" | "pending" | "approved" | "rejected";
export type KeyScope = "full_access" | "invoices_issue" | "invoices_view" | "invoices_read_write";
export type KeyEnvironment = "live" | "test";
export type MessageType = "text" | "template" | "image" | "document";
export type ChannelSlug = "whatsapp" | "sms" | "telegram";
export type ConnectionStatus = "pending" | "active" | "suspended" | "disconnected";
export type PhoneStatus = "pending" | "verified" | "registered";
export type QualityRating = "GREEN" | "YELLOW" | "RED" | "NA";
export type MemberRole = "Owner" | "Admin" | "Developer" | "Billing";
/** `free` is the internal "no plan" placeholder. */
export type PlanSlug = "free" | "solo" | "equipe" | "empresa" | "escala";
export type CreditTransactionType = "purchase" | "message_sent" | "refund" | "adjustment" | "bonus";
export type CreditSource = "avulso" | "subscription" | "bonus";

// Auth types
export interface User {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  createdAt: string;
}

// API Key types
export interface CreateApiKeyInput {
  name: string;
  environment: KeyEnvironment;
  scope: KeyScope;
  expiresAt?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  environment: KeyEnvironment;
  scope: KeyScope;
  keyPrefix: string;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface ApiKeyCreated {
  apiKey: {
    id: string;
    tenantId: string;
    name: string;
    environment: string;
    keyPrefix: string;
    scope: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
  };
  plaintext: string; // only returned on creation
}

// Plan types
export interface Plan {
  id: string;
  slug: PlanSlug;
  name: string;
  monthlyPriceCents: number;
  creditUnitPriceCents: number;
  throughputRps: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// Credit types
export interface CreditBalance {
  tenantId: string;
  balance: number;
  planRemaining?: number;
  avulsoBalance?: number;
  hardLimit: number | null;
}

export interface CreditTransaction {
  id: string;
  tenantId: string;
  amount: number;
  type: CreditTransactionType;
  description: string;
  stripeSessionId: string | null;
  metadata: Record<string, unknown> | null;
  amountBrlCents: number | null;
  unitPriceCentsApplied: number | null;
  planIdSnapshot: string | null;
  source: CreditSource | null;
  channelSlug: ChannelSlug | null;
  createdAt: string;
}

// Connection types
export type ConnectionType = "meta_cloud" | "meta_business_app_coexistence";

export interface MetaConnection {
  id: string;
  tenantId: string;
  wabaId: string;
  wabaName?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  businessName?: string;
  status: ConnectionStatus;
  connectionType: ConnectionType;
  createdAt: string;
  updatedAt: string;
}

export interface AvailablePhone {
  id: string;
  displayPhoneNumber: string;
  verifiedName?: string;
}

export interface MetaConfig {
  appId: string;
  configId: string;
  graphApiVersion: string;
  embeddedSignupVersion: number;
}

export interface MetaCompleteResponse {
  connection: MetaConnection;
  availablePhones: AvailablePhone[];
}

export interface CoexistenceAttempt {
  attemptId: string;
  expiresAt: string;
  appId: string;
  configId: string;
  graphApiVersion: string;
  embeddedSignupVersion: number;
}

export const CONNECTION_TYPES = [
  {
    value: "meta_cloud",
    label: "WhatsApp Cloud API",
    description: "Connect a WhatsApp account through the official Meta API.",
  },
  {
    value: "meta_business_app_coexistence",
    label: "Existing WhatsApp Business",
    description:
      "Use your current WhatsApp Business number with the API simultaneously.",
  },
] as const;

export type ConnectMetaScreenState =
  | "idle"
  | "loading_config"
  | "starting_coexistence"
  | "meta_dialog_open"
  | "waiting_meta_finish"
  | "completing"
  | "selecting_phone"
  | "connected"
  | "cancelled"
  | "error";

// Legacy alias for backwards compatibility with existing consumers
export type Connection = MetaConnection;

// Phone types
export interface Phone {
  id: string;
  connectionId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  countryCode?: string;
  status: PhoneStatus;
  verified: boolean;
  qualityRating?: QualityRating;
  createdAt: string;
  updatedAt: string;
}

// Template types
export interface Template {
  id: string;
  name: string;
  category: string;
  language: string;
  status: TemplateStatus;
  metaTemplateId?: string;
  bodyText: string;
  footerText?: string;
  createdAt: string;
}

export interface CreateTemplateInput {
  connectionId?: string;
  name: string;
  category: string;
  language: string;
  bodyText: string;
  footerText?: string;
}

export interface UpdateTemplateInput {
  bodyText?: string;
  footerText?: string;
}

// Message types
export interface Message {
  id: string;
  toPhone: string;
  messageType: MessageType;
  channelSlug: ChannelSlug;
  status: MessageStatus;
  metaMessageId?: string;
  content?: Record<string, unknown>;
  creditsUsed: number;
  queuedAt?: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  createdAt: string;
}

export interface SendMessageInput {
  connectionId: string;
  to: string;
  type: MessageType;
  content: Record<string, unknown>;
}

// Webhook types
export const WEBHOOK_EVENT_OPTIONS = [
  { value: "nfse.invoice.authorized", label: "Invoice authorized", description: "The municipality authorized the invoice." },
  { value: "nfse.invoice.rejected", label: "Invoice rejected", description: "The municipality rejected the invoice." },
  { value: "nfse.invoice.failed", label: "Invoice failed", description: "Invoice processing failed." },
  { value: "nfse.invoice.reconciliation_required", label: "Reconciliation required", description: "The invoice needs reconciliation." },
  { value: "nfse.invoice.manual_review", label: "Manual review", description: "The invoice needs manual review." },
  { value: "nfse.invoice.documents_ready", label: "Documents ready", description: "The PDF and XML were generated." },
  { value: "nfse.invoice.email_sent", label: "Email sent", description: "The invoice email was sent to the customer." },
  { value: "nfse.invoice.email_failed", label: "Email failed", description: "Sending the invoice email failed." },
  { value: "nfse.invoice.fiscal_discrepancy", label: "Fiscal discrepancy", description: "The authorized invoice differs from the calculated taxes." },
  { value: "nfse.invoice.cancelled", label: "Invoice cancelled", description: "The invoice was cancelled (scheduled or at the Sefin)." },
  { value: "nfse.invoice.cancellation_rejected", label: "Cancellation rejected", description: "The Sefin refused the cancellation; the invoice stays authorized." },
  { value: "nfse.invoice.taker_rejected", label: "Taker rejected", description: "The taker rejected the invoice on the national portal; it stays authorized." },
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENT_OPTIONS)[number]["value"];

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: WebhookEvent[];
  secret?: string; // only returned on creation
  active: boolean;
  createdAt: string;
}

export interface CreateWebhookInput {
  url: string;
  events: string[];
}

export interface WebhookDelivery {
  id: string;
  tenantId: string;
  webhookConfigId: string;
  eventType: string;
  environment: KeyEnvironment;
  url: string;
  statusCode?: number;
  responseBody?: string;
  errorMessage?: string | null;
  status: "pending" | "sent" | "delayed" | "failed" | "manual_retry";
  durationMs?: number;
  retryCount: number;
  nextRetryAt?: string | null;
  lastError?: string | null;
  createdAt: string;
}

export type WebhookDeliveriesQuery = {
  hours?: number; // default: 24
  limit?: number; // default: 50
  cursor?: string;
  environment?: "live" | "test"; // default: "live"
};

export interface DeliveryStats {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  delayed: number;
}

export interface WebhookPayload {
  id: string;
  type: string;
  environment: KeyEnvironment;
  createdAt: string;
  data: {
    messageId: string;
    toPhone: string;
    status: MessageStatus;
    deliveredAt?: string;
    channelSlug: ChannelSlug;
    creditsUsed: number;
  };
}

// Dashboard mock types (for UI only)
export interface AnalyticsBar {
  day: string;
  delivered: number;
  failed: number;
}

export interface Step {
  n: string;
  title: string;
  desc: string;
  done: boolean;
  stateLabel: string;
}

export interface Toggle {
  label: string;
  desc: string;
  enabled: boolean;
}

export interface Member {
  name: string;
  email: string;
  role: MemberRole;
  lastSeen: string;
}

// ── Company types ────────────────────────────────────────────────────────────

export type SetupGap = "municipality_code" | "certificate";
export type CompanyStatus = "pending_setup" | "ready" | "blocked";
export type TaxRegime = "MEI" | "Simples Nacional" | "Lucro Presumido" | "Lucro Real";
export type TaxRegimeKind = "MEI" | "SIMPLES_NACIONAL" | "LUCRO_PRESUMIDO" | "LUCRO_REAL" | "OUTRO_REGIME" | "UNKNOWN";
export type FiscalReviewStatus = "unreviewed" | "approved" | "rejected";
export interface CompanyFiscalProfile {
  id: string; tenantId: string; companyId: string; taxRegime: TaxRegimeKind;
  simpleNational: boolean; specialTaxRegime: string | null;
  ibsCbsRegularOption: boolean; ibsCbsRegularFrom: string | null;
  validFrom: string; validUntil: string | null; source: string;
  reviewStatus: FiscalReviewStatus; reviewedBy: string | null; reviewedAt: string | null; createdAt: string;
}
export interface FiscalProfileInput {
  taxRegime: TaxRegimeKind; simpleNational?: boolean; specialTaxRegime?: string | null;
  ibsCbsRegularOption?: boolean; ibsCbsRegularFrom?: string | null; validFrom?: string; confirm?: boolean;
}
export type WithholdingTax = "irrf" | "pis" | "cofins" | "csll" | "inss";
export interface CompanyServiceTaxProfile {
  id: string; tenantId: string; companyId: string; name: string; serviceCode: string;
  municipalServiceCode: string | null; nbsCode: string | null; cst: string | null;
  classCode: string | null; operationIndicator: string | null;
  operationNature: "SERVICE" | "GOODS" | "MIXED" | "PARTNER_SALON";
  regimeApplicability: TaxRegimeKind[]; incidenceMunicipalityCode: string | null;
  issTaxation: "NORMAL" | "FIXED" | "EXEMPT" | null; issRate: string | null;
  issWithholdingDefault: boolean; withholdingPolicy: "UNKNOWN" | "NONE_CONFIRMED" | "CONFIGURED";
  withholdingRates: Partial<Record<WithholdingTax, string>>;
  effectiveFrom: string; effectiveUntil: string | null; classificationSource: string;
  reviewStatus: FiscalReviewStatus; catalogVersion: string | null; createdAt: string;
}
export type ServiceTaxProfileInput = Pick<CompanyServiceTaxProfile, "name" | "serviceCode" | "effectiveFrom"> & Partial<Omit<CompanyServiceTaxProfile, "id" | "tenantId" | "companyId" | "createdAt" | "reviewStatus">>;
export type CompanyEnvironment = "test" | "live";
export interface CompanyAddress {
  street?: string; number?: string; complement?: string; district?: string;
  city?: string; state?: string; zip?: string;
}
export type MunicipalityAgreementStatus = "not_checked" | "active" | "inactive" | "unknown" | "not_found";
export interface MunicipalityAgreement { status: MunicipalityAgreementStatus; checkedAt: string | null; agreementType: string | null }
export interface Company {
  id: string; tenantId: string; legalName: string; tradeName?: string;
  taxId: string; municipalReg?: string; /** Sends the municipal registration in the DPS. Off by default. */ sendMunicipalReg?: boolean; municipalityCode?: string; defaultServiceCode?: string;
  taxRegime: TaxRegime | null; simpleNational: boolean; specialRegime?: string;
  /** Simples Nacional only: effective total rate (%) of the DAS and, optionally, the ISS rate (%). */
  simplesRate?: string; simplesIssRate?: string;
  environment: CompanyEnvironment; address: CompanyAddress;
  status: CompanyStatus; /** What is still missing before the company is ready, from the API. */ setupGaps?: SetupGap[];
  /** What the Sefin said about the company's municipality; only on the single-company read. */
  municipalityAgreement?: MunicipalityAgreement;
  createdAt: string; updatedAt: string;
}
export interface CreateCompanyInput {
  legalName: string; taxId: string; taxRegime: TaxRegime;
  tradeName?: string; municipalReg?: string; sendMunicipalReg?: boolean; municipalityCode: string; defaultServiceCode?: string;
  simpleNational?: boolean; specialRegime?: string;
  /** Required for Simples Nacional, ignored for MEI. */
  simplesRate?: string; simplesIssRate?: string;
  address?: CompanyAddress;
}
export type UpdateCompanyInput = Partial<Omit<CreateCompanyInput, "taxId" | "municipalReg" | "defaultServiceCode" | "simplesIssRate" | "address">> & {
  /** `null` clears the value; omit to keep it. */
  municipalReg?: string | null; defaultServiceCode?: string | null; simplesIssRate?: string | null; address?: CompanyAddress | null;
};
/** Fields the company form can send for both create and update. */
/** `taxId` only goes with a new company: the CNPJ of an existing one never changes. */
export type CompanyFormInput = UpdateCompanyInput & Pick<CreateCompanyInput, "legalName" | "municipalityCode"> & { taxId?: string };
export type CertificateStatus = "active" | "expired" | "revoked";
export interface Certificate {
  id: string; companyId: string; serialNumber: string; issuer: string;
  subject: string; fingerprint: string; validFrom: string; validUntil: string;
  status: CertificateStatus; createdAt: string;
}
export type InvoiceStatus = "queued" | "processing" | "authorized" | "rejected" | "retry_pending" | "reconciliation_required" | "manual_review" | "failed" | "cancelling" | "cancelled";
export type CancellationReasonCode = "issue_error" | "service_not_provided" | "other";
/** What the national portal says about an authorized invoice. */
export type PortalFlag = "taker_rejected" | "blocked";
export interface Invoice {
  portalFlag?: PortalFlag | null;
  id: string; tenantId: string; companyId: string; externalId?: string | null;
  accessKey?: string | null; nfseNumber?: number | null; status: InvoiceStatus;
  amount: number; customerName: string; customerTaxId: string;
  /** Unconditional discount applied to the amount. */
  discount?: number;
  /** Deduction from the ISS base declared by the issuer. */
  deduction?: number;
  serviceDescription: string; customerSnapshot: CreateInvoiceInput["customer"] | null;
  serviceSnapshot: Required<CreateInvoiceInput["service"]> & { purchaseOrder?: string; notes?: string }; competenceDate: string;
  lastErrorCode?: string | null; lastErrorMessage?: string | null;
  authorizedAt?: string | null; scheduledFor?: string | null; createdAt: string; updatedAt: string;
  cancellationReason?: CancellationReasonCode | null; cancellationDescription?: string | null; cancelledAt?: string | null;
  /** Set when a cancellation was requested while the invoice was still being issued. */
  cancellationRequestedAt?: string | null;
  /** On a substitute: the invoice it replaces once the Receita authorizes it. */
  substitutesInvoiceId?: string | null; substitutionDescription?: string | null;
}
export type CreateInvoiceInput = ({ companyTaxId: string; companyId?: string } | { companyId: string; companyTaxId?: string }) & {
  externalId?: string;
  /** Omit it for an invoice without tomador. When sent, `taxId` (CPF or CNPJ) is required. */
  customer?: { taxId?: string; name?: string; email?: string; address?: { city?: string; state?: string; country?: string }; /** Present on an invoice issued through the API for a customer outside Brazil; `taxId` is then empty. */ foreign?: ForeignCustomer };
  /** Omit code/municipalityCode to inherit the company defaults (code falls back to 100901). The description is optional. */
  service: { description?: string; code?: string; municipalityCode?: string };
  amount: number; competenceDate: string;
  /** Customer purchase order printed on the invoice (DPS xPed, up to 60 characters). Changes no tax. */
  purchaseOrder?: string;
  /** Free text printed on the invoice as complementary information (DPS xInfComp, up to 2000 characters). Changes no tax. */
  notes?: string;
  /**
   * Deduction from the ISS base declared by the issuer, in BRL (> 0 and < amount, max 2 decimals), sent in the DPS as `vDedRed/vDR`.
   * The issuer is responsible for the declared value; Corvo does not check whether the deduction is allowed.
   */
  deduction?: number;
  /** Email the invoice to customer.email once the documents are ready. */
  email?: boolean;
}
export interface InvoiceEvent {
  id: string; invoiceId: string; from: InvoiceStatus | null;
  to: InvoiceStatus; at: string; reason?: string | null;
  /** `portal` when the entry reports something the national portal registered. */
  source?: "portal" | null; portalEvent?: string | null;
}

// ── Billing types ─────────────────────────────────────────────────────────────

export interface BillingUsage {
  creditsUsed: number;
  creditsReserved: number;
  creditsRemaining: number;
  monthlyAllowance: number;
  dailyUsage: number;
  dailyLimit: number | null;
  activeCompanies: number;
  maxActiveCompanies: number;
  periodStart: string;
  periodEnd: string;
  avulsoBalance: number;
}

export interface PixSubscription {
  status: "pending" | "active";
  planSlug: string;
  /** Pix code to open the QR again while it is pending. */
  brCode: string | null;
  paymentLinkUrl: string | null;
}

export interface PaymentRecord {
  id: string;
  kind: "plan" | "avulso";
  planSlug: string | null;
  cycle: "monthly" | "annual" | null;
  units: number | null;
  amountCents: number;
  provider: "woovi" | "stripe";
  paidAt: string | null;
}

export interface BillingSubscription {
  status: string; // "none" when there is no Stripe subscription
  paidUntil: string | null;
  cancelAtPeriodEnd: boolean;
  scheduledPlan: string | null;
  blocked: boolean;
  /** The account has a Stripe customer: only then the Stripe portal can open. */
  stripePortalAvailable: boolean;
  /** A live Stripe subscription: only then upgrade/downgrade can be scheduled through Stripe. */
  stripeSubscription: boolean;
  /** The account's Pix Automático contract: waiting for the payer to authorize, or active. */
  pixSubscription: PixSubscription | null;
}

export interface BillingPlan {
  slug: string;
  name: string;
  monthlyPriceCents: number;
  subscription: BillingSubscription;
  usage: BillingUsage;
}

export interface PlanQuote {
  slug: PlanSlug; name: string; monthlyAllowance: number; basePriceCents: number;
  monthlyEquivalentCents: number; chargeTotalCents: number; currency: "BRL";
}
export type PlanTier = PlanQuote;
export const NFSE_WEBHOOK_EVENTS = WEBHOOK_EVENT_OPTIONS;
export type NfseWebhookEvent = WebhookEvent;

export interface CalculatedTaxAmount { base: string; rate?: string; amount: string }
export interface InvoiceCalculation {
  preEmission: true; status: "ready" | "blocked"; disclaimer: string; competenceDate: string;
  taxRegime: TaxRegimeKind | null;
  taxes: Partial<Record<"iss" | "cbs" | "ibsState" | "ibsCity" | "ibsTotal", CalculatedTaxAmount>>;
  withholdings: (CalculatedTaxAmount & { tax: string })[];
  netReceivableAmount: string | null; collectionWaived: boolean | null;
  warnings: { code: string; message: string; step: string }[];
  pendingFields: { field: string; reason: string }[];
  blocking: { code: string; message: string; step: string; category: string; retryable: boolean } | null;
}

export type ScheduleStatus = "active" | "paused" | "completed" | "cancelled";
export type ScheduleFrequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY";
/** A scheduled (once) or recurring invoice. Dates are plain YYYY-MM-DD. */
export interface InvoiceSchedule {
  id: string;
  kind: "once" | "recurring";
  frequency: ScheduleFrequency | null;
  status: ScheduleStatus;
  pauseReason: "customer" | "failures" | null;
  companyId: string;
  anchorOn: string;
  nextRunOn: string | null;
  endsOn: string | null;
  attempts: number;
  lastRunOn: string | null;
  /** The invoice body each run issues. */
  invoice: Record<string, unknown>;
  createdAt: string;
}
export interface ScheduleRun {
  id: string;
  occurrenceOn: string;
  ranOn: string;
  attempt: number;
  outcome: "issued" | "failed";
  invoiceId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

/** A spreadsheet import: read in the background, reviewed by the user, then emitted in chunks. */
export type ImportStatus = "processing" | "ready" | "emitting" | "done" | "failed";
export type ImportRowStatus = "valid" | "invalid" | "queued" | "accepted" | "rejected";
export interface ImportCounters { total: number; valid: number; invalid: number; accepted: number; authorized: number; awaitingCredits: number; validAmount: number; awaitingAmount: number; failed: number; pending: number; authorizedAmount: number; pendingAmount: number; failedAmount: number }
export interface ImportJob { id: string; status: ImportStatus; fileName: string; companyId: string | null; errorCode: string | null; rowsExpected: number | null; unknownColumns: string[]; emitStartedAt: string | null; emitFinishedAt: string | null; createdAt: string; counters: ImportCounters }
export interface ImportRow { line: number; data: Record<string, unknown>; status: ImportRowStatus; errorCode: string | null; errorMessage: string | null; invoiceId: string | null }
export interface ImportStart { id: string; status: ImportStatus; duplicateOf: string | null }

/** A service the company bills often, saved to fill the new-invoice form in one click. */
export interface ServiceFavorite { id: string; companyId: string; label: string; description: string; serviceCode: string; amountCents: number | null; municipalityCode: string | null; createdAt: string }
export interface ServiceFavoriteInput { label: string; description: string; serviceCode: string; amountCents?: number | null; municipalityCode?: string | null }

/** A customer (tomador) saved from an accepted invoice: the next invoice for the same document needs no name. */
export interface SavedCustomer { taxId: string; name: string; email: string | null; lastUsedAt: string; createdAt: string; updatedAt: string }

/** A customer outside Brazil: its tax id (or why it has none) and the address abroad. It does not declare a service export. */
export interface ForeignCustomer { taxId?: string; noTaxIdReason?: "exempt" | "not_required"; country: string; postalCode: string; city: string; region: string; street: string; number: string; district: string; complement?: string }
