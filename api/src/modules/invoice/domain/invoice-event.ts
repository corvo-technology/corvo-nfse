import { InvoiceStatus } from './invoice-status';

export interface InvoiceEventSnapshot {
  id: string;
  invoiceId: string;
  fromStatus: InvoiceStatus | null;
  toStatus: InvoiceStatus;
  reason: string | null;
  createdAt: Date;
}

export class InvoiceEvent {
  private constructor(private readonly props: InvoiceEventSnapshot) {}

  static create(
    invoiceId: string,
    from: InvoiceStatus | null,
    to: InvoiceStatus,
    reason?: string,
  ): InvoiceEvent {
    return new InvoiceEvent({
      id: crypto.randomUUID(),
      invoiceId,
      fromStatus: from,
      toStatus: to,
      reason: reason ?? null,
      createdAt: new Date(),
    });
  }

  get id(): string {
    return this.props.id;
  }

  get invoiceId(): string {
    return this.props.invoiceId;
  }

  get fromStatus(): InvoiceStatus | null {
    return this.props.fromStatus;
  }

  get toStatus(): InvoiceStatus {
    return this.props.toStatus;
  }

  get reason(): string | null {
    return this.props.reason;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  toSnapshot(): InvoiceEventSnapshot {
    return { ...this.props };
  }
}
