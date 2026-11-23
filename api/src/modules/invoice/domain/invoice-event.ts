import { InvoiceStatus } from './invoice-status';

export interface InvoiceEventSnapshot {
  id: string;
  invoiceId: string;
  fromStatus: InvoiceStatus | null;
  toStatus: InvoiceStatus;
  reason: string | null;
  createdAt: Date;
  /** `portal` when the entry comes from the national portal instead of Corvo's own work. */
  source: 'portal' | null;
  /** Portal event type (e.g. `REJEICAO_TOMADOR`), set with `source: 'portal'`. */
  portalEvent: string | null;
  /** NSU of the portal document that produced the entry; one entry per invoice and NSU. */
  portalNsu: number | null;
}

export interface PortalOrigin {
  event: string;
  nsu: number;
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
      source: null,
      portalEvent: null,
      portalNsu: null,
    });
  }

  /** A timeline entry for something the national portal reported about the invoice. */
  static fromPortal(
    invoiceId: string,
    from: InvoiceStatus,
    to: InvoiceStatus,
    origin: PortalOrigin,
    reason?: string,
  ): InvoiceEvent {
    return new InvoiceEvent({
      ...InvoiceEvent.create(invoiceId, from, to, reason).props,
      source: 'portal',
      portalEvent: origin.event,
      portalNsu: origin.nsu,
    });
  }

  /** The same event, marked as coming from the portal. */
  withPortal(origin: PortalOrigin): InvoiceEvent {
    return new InvoiceEvent({
      ...this.props,
      source: 'portal',
      portalEvent: origin.event,
      portalNsu: origin.nsu,
    });
  }

  /** Rebuilds a stored event; unlike `create` it keeps the original id and timestamp. */
  static reconstitute(snapshot: InvoiceEventSnapshot): InvoiceEvent {
    return new InvoiceEvent({ ...snapshot });
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

  toJSON(): InvoiceEventSnapshot {
    return this.toSnapshot();
  }
}
