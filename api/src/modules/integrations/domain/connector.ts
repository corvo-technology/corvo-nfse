import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';

export type IntegrationEnvironment = ExecutionEnvironment;

export interface InboundRequest {
  rawBody: Buffer;
  /** Header names in lowercase. */
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
}

/** What a connector sees of a connection. Credentials are decrypted, in memory only. */
export interface ConnectionView {
  publicId: string;
  environment: IntegrationEnvironment;
  externalAccountId: string;
  credentials: Record<string, string>;
}

export type OperationDelivery = {
  kind: 'operation';
  /** Stable across redeliveries of the same event. */
  deliveryId: string;
  externalType: string;
  /** Set when the platform reports it (devMode, livemode). */
  environment?: IntegrationEnvironment;
  /** Set when the event identifies the account. */
  externalAccountId?: string;
};

export type ParsedDelivery =
  | { kind: 'test' }
  | { kind: 'ignored'; externalType: string }
  | OperationDelivery;

export type DeliveryAuth = { ok: true } | { ok: false; reason: string };

export type CommercialState =
  'pending' | 'paid' | 'refunded' | 'disputed' | 'canceled';

export interface NormalizedCustomer {
  name: string | null;
  email: string | null;
  /** Digits only; null when absent. */
  taxId: string | null;
  /** True when the platform masked the document. */
  taxIdMasked: boolean;
  /** Filled in by the client when resolving the sale; platforms do not send it. */
  address?: CustomerAddress;
}

export interface CustomerAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  municipalityCode?: string;
}

export interface NormalizedOperation {
  /** Identity of the individual charge, e.g. "charge:abc". */
  operationKey: string;
  commercialState: CommercialState;
  externalRefs: Record<string, string>;
  occurredAt: Date;
  paidAt: Date | null;
  currency: string;
  amountCents: number;
  discountCents: number;
  customer: NormalizedCustomer | null;
  items: Array<{
    externalProductId: string | null;
    description: string | null;
    quantity: number;
  }>;
  /** What was sold, as the platform describes it; used on the invoice when the rule sets no description. */
  description?: string | null;
  /**
   * Set when the event cannot name its sale directly (a refund that only knows the original
   * payment): the sale is the one whose `externalRefs[ref]` equals `value`.
   */
  refersTo?: { ref: string; value: string };
  /** What the client typed when resolving the sale; wins over the rule and the platform's text. */
  serviceOverride?: { code?: string; description?: string };
  /** The client's choice for this sale: send the invoice by e-mail or not. */
  sendEmailOverride?: boolean;
  /** False when the platform says someone else issues the invoice. */
  sellerIssuesInvoice: boolean;
}

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  /** The platform generates the value on connection creation when the client sends none. */
  generate?: boolean;
  /** Appended to the webhook URL as a query parameter named `key`, shown once when the connection is created. */
  inWebhookUrl?: boolean;
  /** Shown to the client only in the creation response, to paste into the platform (not part of the URL). */
  revealOnce?: boolean;
  /** The client may leave it empty (an optional setting, not a credential). */
  optional?: boolean;
  /** The allowed values, when the field is a choice; the first is the default. */
  options?: string[];
}

export interface ConnectorManifest {
  id: string;
  name: string;
  version: string;
  credentialFields: CredentialField[];
  webhookInstructions: { pt: string; en: string };
  supportedFlows: string[];
}

export interface Connector {
  readonly manifest: ConnectorManifest;
  authenticate(
    req: InboundRequest,
    connection: ConnectionView,
  ): Promise<DeliveryAuth>;
  /**
   * Must depend only on `rawBody`: the worker calls it again later, from the
   * stored body, without headers or query.
   */
  parse(req: InboundRequest): ParsedDelivery;
  normalize(input: {
    connection: ConnectionView;
    /** The raw body text, as received. */
    payload: unknown;
    delivery: OperationDelivery;
  }): Promise<NormalizedOperation>;
  validateConnection(
    credentials: Record<string, string>,
    environment: IntegrationEnvironment,
    /** For platforms that identify nothing about the account: the id can come from the connection itself. */
    connection: { publicId: string },
  ): Promise<{ externalAccountId: string }>;
}

/** Retry later with backoff. */
export class ConnectorTransientError extends Error {}
/** Credentials were rejected: the connection needs to be reauthorized. */
export class ConnectorAuthError extends Error {}
/** The data cannot become an invoice without a person looking at it. */
export class ConnectorDataError extends Error {}
