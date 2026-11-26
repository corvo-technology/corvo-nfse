import { randomUUID } from 'crypto';
import type { DocumentType } from '@/modules/fiscal-core/domain/document-type';

export type CreditTransactionType =
  | 'purchase'
  | 'subscription_charge'
  | 'topup'
  | 'overage'
  | 'invoice_authorized'
  | 'invoice_rejected'
  | 'expiration'
  | 'message_sent'
  | 'refund'
  | 'adjustment'
  | 'bonus';

export type CreditSource = 'subscription' | 'avulso' | 'bonus';

export interface CreditTransactionProps {
  id: string;
  tenantId: string;
  amount: number;
  type: CreditTransactionType;
  description?: string;
  stripeSessionId?: string;
  metadata?: Record<string, unknown>;
  // Snapshot fields for purchases — NULL on debits.
  amountBrlCents?: number;
  unitPriceCentsApplied?: number;
  planIdSnapshot?: string;
  source?: CreditSource;
  // Channel that triggered a debit.
  channelSlug?: string;
  // Reservation fields for invoice lifecycle
  reservedInvoiceId?: string;
  // NF-e reservations point here instead (the NFS-e column has a foreign key to nfse_invoices).
  reservedNfeDocumentId?: string;
  // Type of the document the reservation is for; defaults to 'nfse'.
  reservedDocumentType?: DocumentType;
  periodId?: string;
  isReservation?: boolean;
  relatedTransactionId?: string;
  createdAt: Date;
}

export type CreateCreditTransaction = Omit<CreditTransactionProps, 'id'>;

export class CreditTransaction {
  private constructor(private readonly props: CreditTransactionProps) {}

  static create(input: CreateCreditTransaction): CreditTransaction {
    if (input.amount === 0) {
      throw new Error('CreditTransaction amount must be non-zero');
    }
    return new CreditTransaction({ id: randomUUID(), ...input });
  }

  static reconstitute(props: CreditTransactionProps): CreditTransaction {
    return new CreditTransaction(props);
  }

  get id(): string {
    return this.props.id;
  }
  get tenantId(): string {
    return this.props.tenantId;
  }
  get amount(): number {
    return this.props.amount;
  }
  get type(): CreditTransactionType {
    return this.props.type;
  }
  get description(): string | undefined {
    return this.props.description;
  }
  get stripeSessionId(): string | undefined {
    return this.props.stripeSessionId;
  }
  get metadata(): Record<string, unknown> | undefined {
    return this.props.metadata;
  }
  get amountBrlCents(): number | undefined {
    return this.props.amountBrlCents;
  }
  get unitPriceCentsApplied(): number | undefined {
    return this.props.unitPriceCentsApplied;
  }
  get planIdSnapshot(): string | undefined {
    return this.props.planIdSnapshot;
  }
  get source(): CreditSource | undefined {
    return this.props.source;
  }
  get channelSlug(): string | undefined {
    return this.props.channelSlug;
  }
  get reservedInvoiceId(): string | undefined {
    return this.props.reservedInvoiceId;
  }
  get reservedNfeDocumentId(): string | undefined {
    return this.props.reservedNfeDocumentId;
  }
  get reservedDocumentType(): DocumentType {
    return this.props.reservedDocumentType ?? 'nfse';
  }
  get periodId(): string | undefined {
    return this.props.periodId;
  }
  get isReservation(): boolean {
    return this.props.isReservation ?? false;
  }
  get relatedTransactionId(): string | undefined {
    return this.props.relatedTransactionId;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }

  toSnapshot(): CreditTransactionProps {
    return { ...this.props };
  }

  toJSON(): CreditTransactionProps {
    return this.toSnapshot();
  }
}
