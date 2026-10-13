import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import {
  CreateCreditTransaction,
  CreditTransaction,
} from './credit-transaction';

export abstract class ICreditTransactionRepository {
  abstract listPage(
    tenantId: string,
    options: CursorQuery,
  ): Promise<CursorPage<CreditTransaction>>;
  abstract findByTenantId(
    tenantId: string,
    offset?: number,
    limit?: number,
  ): Promise<CreditTransaction[]>;
  /**
   * Persist a new credit transaction. Returns the same aggregate that was
   * passed in (no read-after-write). The aggregate already carries its id.
   */
  abstract save(
    transaction: CreateCreditTransaction,
    tenantId: string,
  ): Promise<CreditTransaction>;
  abstract calculateBalance(tenantId: string): Promise<number>;
  /**
   * Find a reservation by the associated invoice ID.
   */
  abstract findByReservedInvoiceId(
    invoiceId: string,
    tenantId: string,
  ): Promise<CreditTransaction | null>;
  /**
   * Confirm a reservation (mark it as no longer a reservation).
   */
  abstract confirm(id: string, tenantId: string): Promise<void>;
  /**
   * Cancel a reservation (mark it as cancelled).
   */
  abstract cancelReservation(id: string, tenantId: string): Promise<void>;
}
