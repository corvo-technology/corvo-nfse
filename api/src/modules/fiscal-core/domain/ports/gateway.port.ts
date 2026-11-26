import type { DocumentType } from '../document-type';
import type { GatewayOutcome } from '../gateway-outcome';
import type { AuthorityEndpoint, AuthorityTarget } from './authority.port';
import type { LoadedCertificate } from './xml.port';

export interface SigningContext {
  certificate: LoadedCertificate;
  tpAmb: 1 | 2;
  target: AuthorityEndpoint;
}

export interface Authorization {
  accessKey: string;
  protocol?: string;
  number?: number;
  authorizedXml?: string;
  authorizedAt?: Date;
}

export interface ConsultResult {
  status:
    | 'authorized'
    | 'rejected'
    | 'pending'
    | 'not_found'
    | 'cancelled'
    | 'denied';
  accessKey?: string;
  protocol?: string;
  cStat?: string;
  xml?: string;
}

export interface EventReceipt {
  protocol: string;
  cStat: string;
  registeredAt?: Date;
}

export interface CancelRequest {
  accessKey: string;
  reason: string;
  justification: string;
  protocol?: string;
  /** Type-specific data the adapter needs (opaque to the core). */
  context?: unknown;
}

export interface CorrectionRequest {
  accessKey: string;
  correction: string;
  sequence: number;
}

export interface InutilizeRequest {
  uf: string;
  year: number;
  series: number;
  startNumber: number;
  endNumber: number;
  justification: string;
}

export interface IssueCapability<D> {
  issue(doc: D, ctx: SigningContext): Promise<GatewayOutcome<Authorization>>;
}
export interface ConsultCapability {
  consultByKey(
    key: string,
    ctx: SigningContext,
  ): Promise<GatewayOutcome<ConsultResult>>;
}
export interface CancelCapability {
  cancel(
    req: CancelRequest,
    ctx: SigningContext,
  ): Promise<GatewayOutcome<EventReceipt>>;
}
export interface CorrectCapability {
  correct(
    req: CorrectionRequest,
    ctx: SigningContext,
  ): Promise<GatewayOutcome<EventReceipt>>;
}
export interface InutilizeCapability {
  inutilize(
    req: InutilizeRequest,
    ctx: SigningContext,
  ): Promise<GatewayOutcome<EventReceipt>>;
}
export interface ServiceStatusCapability {
  status(target: AuthorityTarget): Promise<GatewayOutcome<{ up: boolean }>>;
}

export interface FiscalDocumentGateway<D> {
  readonly type: DocumentType;
  readonly issuer: IssueCapability<D>;
  readonly consult: ConsultCapability;
  readonly cancel?: CancelCapability;
  readonly correct?: CorrectCapability;
  readonly inutilize?: InutilizeCapability;
  readonly serviceStatus?: ServiceStatusCapability;
}
