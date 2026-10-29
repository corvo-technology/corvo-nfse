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
  | 'pending'
  | 'paid'
  | 'refunded'
  | 'disputed'
  | 'canceled';

export interface NormalizedCustomer {
  name: string | null;
  email: string | null;
  /** Digits only; null when absent. */
  taxId: string | null;
  /** True when the platform masked the document. */
  taxIdMasked: boolean;
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
  /** False when the platform says someone else issues the invoice. */
  sellerIssuesInvoice: boolean;
}

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  /** The platform generates the value on connection creation when the client sends none. */
  generate?: boolean;
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
  ): Promise<{ externalAccountId: string }>;
}

/** Retry later with backoff. */
export class ConnectorTransientError extends Error {}
/** Credentials were rejected: the connection needs to be reauthorized. */
export class ConnectorAuthError extends Error {}
/** The data cannot become an invoice without a person looking at it. */
export class ConnectorDataError extends Error {}
