import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { randomUUID } from 'crypto';
import { InvoiceStatus, VALID_TRANSITIONS } from './invoice-status';
import { buildInvoiceState, type InvoiceState } from './invoice-state';
import { InvoiceEvent } from './invoice-event';
import {
  InvalidInvoiceTransitionError,
  InvoiceNotCancellableError,
} from './errors';
import {
  assertFiscalCancellationReason,
  type CancellationReason,
  type CancellationReasonCode,
} from './cancellation-reason';
import type { ServiceFiscalInput } from './fiscal/normalized-invoice';

export type LastEmailStatus = 'queued' | 'sent' | 'failed';

export interface CustomerSnapshot {
  /** Absent for anonymous consumers (no tomador document). */
  taxId?: string;
  name: string;
  email?: string;
  address?: {
    city: string;
    state: string;
    country?: string;
    /** Incidence municipality (7 digits) when explicitly informed. */
    municipalityCode?: string;
  };
}

export interface ServiceSnapshot {
  description: string;
  code: string;
  municipalityCode: string;
  fiscal?: ServiceFiscalInput;
  serviceProfileId?: string;
}

export interface TaxSnapshot {
  // Extensible tax calculation snapshots
  [key: string]: unknown;
}

export interface InvoiceProps {
  id: string;
  companyId: string;
  tenantId: string;
  environment?: ExecutionEnvironment;
  documentKeyVersion?: number;
  requestHash?: string | null;
  externalId: string | null;
  idempotencyKey: string | null;
  status: InvoiceStatus;
  /** Null for anonymous consumer invoices (tomador omitted). */
  customerSnapshot: CustomerSnapshot | null;
  serviceSnapshot: ServiceSnapshot;
  taxSnapshot: TaxSnapshot;
  amount: number;
  /** Unconditional discount applied to `amount`, 2 decimals. */
  discount?: number;
  currency: string;
  competenceDate: Date;
  scheduledFor?: Date | null;
  dpsId: string | null;
  dpsSeries: string | null;
  dpsNumber: number | null;
  accessKey: string | null;
  nfseNumber: number | null;
  fiscalProvider: string;
  fiscalSchemaVersion: string;
  issuedAt: Date | null;
  authorizedAt: Date | null;
  emailSnapshot?: {
    send?: boolean;
  };
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorProvider: string | null;
  documentsReadyAt: Date | null;
  lastEmailStatus: LastEmailStatus | null;
  lastEmailSentAt: Date | null;
  cancellationReason?: CancellationReasonCode | null;
  cancellationDescription?: string | null;
  cancelledAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateInvoiceInput {
  companyId: string;
  environment?: ExecutionEnvironment;
  requestHash?: string;
  externalId?: string;
  /** Null for anonymous consumer invoices. */
  customer: CustomerSnapshot | null;
  service: {
    description: string;
    code: string;
    municipalityCode: string;
    fiscal?: ServiceFiscalInput;
    serviceProfileId?: string;
  };
  amount: number;
  discount?: number;
  competenceDate: Date;
  scheduledFor?: Date;
  email?: {
    send?: boolean;
  };
}

export class Invoice {
  private constructor(private readonly props: InvoiceProps) {}

  static create(
    input: CreateInvoiceInput,
    tenantId: string,
    idempotencyKey?: string,
  ): Invoice {
    const now = new Date();
    return new Invoice({
      id: randomUUID(),
      companyId: input.companyId,
      tenantId,
      environment: input.environment ?? 'test',
      documentKeyVersion: 2,
      requestHash: input.requestHash ?? null,
      externalId: input.externalId ?? null,
      idempotencyKey: idempotencyKey ?? null,
      status: 'queued',
      customerSnapshot: input.customer
        ? {
            taxId: input.customer.taxId,
            name: input.customer.name,
            email: input.customer.email,
            address: input.customer.address,
          }
        : null,
      serviceSnapshot: {
        description: input.service.description,
        code: input.service.code,
        municipalityCode: input.service.municipalityCode,
        fiscal: input.service.fiscal,
        serviceProfileId: input.service.serviceProfileId,
      },
      taxSnapshot: {},
      emailSnapshot: input.email ? { send: input.email.send } : undefined,
      amount: input.amount,
      discount: input.discount,
      currency: 'BRL',
      competenceDate: input.competenceDate,
      scheduledFor: input.scheduledFor ?? null,
      dpsId: null,
      dpsSeries: null,
      dpsNumber: null,
      accessKey: null,
      nfseNumber: null,
      fiscalProvider: 'national',
      fiscalSchemaVersion: 'v2_02',
      issuedAt: null,
      authorizedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorProvider: null,
      documentsReadyAt: null,
      lastEmailStatus: null,
      lastEmailSentAt: null,
      cancellationReason: null,
      cancellationDescription: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: InvoiceProps): Invoice {
    return new Invoice(props);
  }

  get id(): string {
    return this.props.id;
  }

  get environment(): ExecutionEnvironment {
    return this.props.environment ?? 'test';
  }

  get storageEnvironment(): ExecutionEnvironment | undefined {
    return this.props.documentKeyVersion === 1 ? undefined : this.environment;
  }

  setDpsId(id: string): void {
    this.props.dpsId = id;
  }

  get scheduledFor(): Date | null {
    return this.props.scheduledFor ?? null;
  }

  get status(): InvoiceStatus {
    return this.props.status;
  }

  get dpsNumber(): number | null {
    return this.props.dpsNumber;
  }

  get accessKey(): string | null {
    return this.props.accessKey;
  }

  get companyId(): string {
    return this.props.companyId;
  }

  get tenantId(): string {
    return this.props.tenantId;
  }

  get externalId(): string | null {
    return this.props.externalId;
  }

  get idempotencyKey(): string | null {
    return this.props.idempotencyKey;
  }

  get emailSnapshot(): InvoiceProps['emailSnapshot'] {
    return this.props.emailSnapshot;
  }

  get documentsReadyAt(): Date | null {
    return this.props.documentsReadyAt;
  }

  /** Fiscal status, documents and email state in one consistent view. */
  get state(): InvoiceState {
    return buildInvoiceState({
      status: this.props.status,
      documentsReady: this.props.documentsReadyAt !== null,
      emailRequested: Boolean(this.props.emailSnapshot?.send),
      emailStatus: this.props.lastEmailStatus,
    });
  }

  get lastEmailStatus(): LastEmailStatus | null {
    return this.props.lastEmailStatus;
  }

  get lastEmailSentAt(): Date | null {
    return this.props.lastEmailSentAt;
  }

  get nfseNumber(): number | null {
    return this.props.nfseNumber;
  }

  get customerSnapshot(): CustomerSnapshot | null {
    return this.props.customerSnapshot;
  }

  get cancellationReason(): CancellationReason | null {
    const code = this.props.cancellationReason;
    return code
      ? { code, description: this.props.cancellationDescription ?? null }
      : null;
  }

  get cancelledAt(): Date | null {
    return this.props.cancelledAt ?? null;
  }

  /** True once the Sefin authorized it, even if later cancelled: documents exist. */
  get wasAuthorized(): boolean {
    return this.props.authorizedAt !== null;
  }

  get discount(): number | undefined {
    return this.props.discount;
  }

  get amount(): number {
    return this.props.amount;
  }

  transitionTo(newStatus: InvoiceStatus, reason?: string): InvoiceEvent {
    const validTargets = VALID_TRANSITIONS[this.props.status];
    if (!validTargets.includes(newStatus)) {
      throw new InvalidInvoiceTransitionError(this.props.status, newStatus);
    }
    const event = InvoiceEvent.create(
      this.props.id,
      this.props.status,
      newStatus,
      reason,
    );
    this.props.status = newStatus;
    this.props.updatedAt = new Date();
    return event;
  }

  setDpsInfo(series: string, number: number): void {
    this.props.dpsId = randomUUID();
    this.props.dpsSeries = series;
    this.props.dpsNumber = number;
    this.props.updatedAt = new Date();
  }

  setAuthorized(accessKey: string, nfseNumber: number): void {
    const now = new Date();
    this.props.accessKey = accessKey;
    this.props.nfseNumber = nfseNumber;
    this.props.authorizedAt = now;
    this.props.issuedAt = now;
    this.props.updatedAt = now;
  }

  setRejected(
    errorCode: string,
    errorMessage: string,
    providerMessage?: string,
  ): void {
    this.props.lastErrorCode = errorCode;
    this.props.lastErrorMessage = errorMessage;
    this.props.lastErrorProvider = providerMessage ?? null;
    this.props.updatedAt = new Date();
  }

  setReconciliationRequired(reason: string): void {
    this.props.lastErrorMessage = reason;
    this.props.updatedAt = new Date();
  }

  setProcessing(): void {
    this.props.status = 'processing';
    this.props.updatedAt = new Date();
  }

  /** queued → cancelled (local) or authorized → cancelling (fiscal event). */
  requestCancellation(reason: CancellationReason): InvoiceEvent {
    if (this.props.status === 'queued') {
      this.recordCancellationReason(reason);
      const event = this.transitionTo('cancelled', 'Cancelled before emission');
      this.props.cancelledAt = event.createdAt;
      return event;
    }
    if (this.props.status === 'authorized') {
      assertFiscalCancellationReason(reason);
      this.recordCancellationReason(reason);
      this.clearLastError();
      return this.transitionTo('cancelling', 'Cancellation requested');
    }
    throw new InvoiceNotCancellableError(this.props.status);
  }

  confirmCancellation(): InvoiceEvent {
    if (this.props.status !== 'cancelling')
      throw new InvalidInvoiceTransitionError(this.props.status, 'cancelled');
    this.clearLastError();
    const event = this.transitionTo('cancelled', 'NFS-e cancelled');
    this.props.cancelledAt = event.createdAt;
    return event;
  }

  rejectCancellation(errorCode: string, errorMessage: string): InvoiceEvent {
    if (this.props.status !== 'cancelling')
      throw new InvalidInvoiceTransitionError(this.props.status, 'authorized');
    this.setRejected(errorCode, errorMessage);
    return this.transitionTo(
      'authorized',
      `Cancellation rejected: ${errorMessage}`,
    );
  }

  /** Drops an error left by a previous (rejected) cancellation attempt. */
  private clearLastError(): void {
    this.props.lastErrorCode = null;
    this.props.lastErrorMessage = null;
    this.props.lastErrorProvider = null;
  }

  private recordCancellationReason(reason: CancellationReason): void {
    this.props.cancellationReason = reason.code;
    this.props.cancellationDescription = reason.description;
  }

  /** HTTP/MCP representation: the invoice fields at the top level, plus the derived states. */
  toJSON(): Omit<InvoiceProps, 'requestHash'> & Omit<InvoiceState, 'status'> {
    const { requestHash: _hash, ...props } = this.toSnapshot();
    const { documentsStatus, emailStatus, stage } = this.state;
    return { ...props, documentsStatus, emailStatus, stage };
  }

  toSnapshot(): InvoiceProps {
    return { ...this.props };
  }
}
