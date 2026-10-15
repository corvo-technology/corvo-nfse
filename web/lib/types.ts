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
export type PlanSlug = "free" | "developer" | "growth" | "scale" | "volume";
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
  overageUnits: number;
  overageAmountCents: number;
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
  { value: "nfse.invoice.cancelled", label: "Invoice cancelled", description: "The invoice was cancelled (scheduled or at the Sefin)." },
  { value: "nfse.invoice.cancellation_rejected", label: "Cancellation rejected", description: "The Sefin refused the cancellation; the invoice stays authorized." },
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

export type SetupGap = "municipality_code" | "municipal_registration" | "certificate";
export type CompanyStatus = "pending_setup" | "ready" | "blocked";
export type TaxRegime = "MEI" | "Simples Nacional" | "Lucro Presumido" | "Lucro Real";
export type CompanyEnvironment = "test" | "live";
export interface CompanyAddress {
  street?: string; number?: string; complement?: string; district?: string;
  city?: string; state?: string; zip?: string;
}
export interface Company {
  id: string; tenantId: string; legalName: string; tradeName?: string;
  taxId: string; municipalReg?: string; municipalityCode?: string; defaultServiceCode?: string;
  taxRegime: TaxRegime; simpleNational: boolean; specialRegime?: string;
  environment: CompanyEnvironment; address: CompanyAddress;
  status: CompanyStatus; /** What is still missing before the company is ready, from the API. */ setupGaps?: SetupGap[];
  createdAt: string; updatedAt: string;
}
export interface CreateCompanyInput {
  legalName: string; taxId: string; taxRegime: TaxRegime;
  tradeName?: string; municipalReg?: string; municipalityCode: string; defaultServiceCode?: string;
  simpleNational?: boolean; specialRegime?: string;
  address?: CompanyAddress;
}
export type UpdateCompanyInput = Partial<Omit<CreateCompanyInput, "municipalReg" | "defaultServiceCode" | "address">> & {
  /** `null` clears the value; omit to keep it. */
  municipalReg?: string | null; defaultServiceCode?: string | null; address?: CompanyAddress | null;
};
/** Fields the company form can send for both create and update. */
export type CompanyFormInput = UpdateCompanyInput & Pick<CreateCompanyInput, "legalName" | "taxId" | "taxRegime" | "municipalityCode">;
export type CertificateStatus = "active" | "expired" | "revoked";
export interface Certificate {
  id: string; companyId: string; serialNumber: string; issuer: string;
  subject: string; fingerprint: string; validFrom: string; validUntil: string;
  status: CertificateStatus; createdAt: string;
}
export type InvoiceStatus = "queued" | "processing" | "authorized" | "rejected" | "retry_pending" | "reconciliation_required" | "manual_review" | "failed" | "cancelling" | "cancelled";
export type CancellationReasonCode = "issue_error" | "service_not_provided" | "other";
export interface Invoice {
  id: string; tenantId: string; companyId: string; externalId?: string | null;
  accessKey?: string | null; nfseNumber?: number | null; status: InvoiceStatus;
  amount: number; customerName: string; customerTaxId: string;
  serviceDescription: string; customerSnapshot: CreateInvoiceInput["customer"];
  serviceSnapshot: Required<CreateInvoiceInput["service"]>; competenceDate: string;
  lastErrorCode?: string | null; lastErrorMessage?: string | null;
  authorizedAt?: string | null; createdAt: string; updatedAt: string;
  cancellationReason?: CancellationReasonCode | null; cancellationDescription?: string | null; cancelledAt?: string | null;
}
export type CreateInvoiceInput = ({ companyTaxId: string; companyId?: string } | { companyId: string; companyTaxId?: string }) & {
  externalId?: string;
  customer: { taxId: string; name: string; email?: string; address?: { city?: string; state?: string; country?: string } };
  /** Omit code/municipalityCode to inherit the company defaults. */
  service: { description: string; code?: string; municipalityCode?: string };
  amount: number; competenceDate: string;
  /** Email the invoice to customer.email once the documents are ready. */
  email?: boolean;
}
export interface InvoiceEvent {
  id: string; invoiceId: string; from: InvoiceStatus | null;
  to: InvoiceStatus; at: string; reason?: string | null;
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
  overageUnits: number;
  overageAmountCents: number;
}

export interface BillingSubscription {
  status: string; // "none" when there is no Stripe subscription
  paidUntil: string | null;
  cancelAtPeriodEnd: boolean;
  scheduledPlan: string | null;
  blocked: boolean;
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
  perCreditOverageCents: number; monthlyTotalCents: number; annualTotalCents: number; currency: "BRL";
}
export type PlanTier = PlanQuote;
export const NFSE_WEBHOOK_EVENTS = WEBHOOK_EVENT_OPTIONS;
export type NfseWebhookEvent = WebhookEvent;
