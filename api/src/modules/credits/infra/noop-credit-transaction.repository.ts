import { Injectable } from '@nestjs/common';
import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { ICreditTransactionRepository } from '../domain/credit-transaction.repository';
import {
  CreateCreditTransaction,
  CreditTransaction,
} from '../domain/credit-transaction';

/**
 * Ledger for `self_hosted`: there are no credits, so nothing is written and nothing is found.
 * Emission keeps calling the ledger the same way; it just leaves no `credit_transaction` row.
 */
@Injectable()
export class NoopCreditTransactionRepository extends ICreditTransactionRepository {
  listPage(
    _tenantId: string,
    options: CursorQuery,
  ): Promise<CursorPage<CreditTransaction>> {
    return Promise.resolve(
      new CursorPage<CreditTransaction>([], {
        limit: options.limit ?? 0,
        hasMore: false,
        nextCursor: null,
      }),
    );
  }
  findByTenantId(): Promise<CreditTransaction[]> {
    return Promise.resolve([]);
  }
  save(transaction: CreateCreditTransaction): Promise<CreditTransaction> {
    return Promise.resolve(CreditTransaction.create(transaction));
  }
  calculateBalance(): Promise<number> {
    return Promise.resolve(0);
  }
  findByReservedInvoiceId(): Promise<CreditTransaction | null> {
    return Promise.resolve(null);
  }
  findByReservedDocument(): Promise<CreditTransaction | null> {
    return Promise.resolve(null);
  }
  confirm(): Promise<void> {
    return Promise.resolve();
  }
  cancelReservation(): Promise<void> {
    return Promise.resolve();
  }
}
