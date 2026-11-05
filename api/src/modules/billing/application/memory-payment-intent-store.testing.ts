import {
  PaymentIntentStore,
  type PaymentIntent,
  type PaymentIntentStatus,
} from '../domain/payment-intent';

/** In-memory PaymentIntentStore for unit tests. */
export class MemoryPaymentIntentStore extends PaymentIntentStore {
  rows: PaymentIntent[] = [];
  findByKey(tenantId: string, key: string) {
    return Promise.resolve(
      this.rows.find(
        (r) => r.tenantId === tenantId && r.idempotencyKey === key,
      ) ?? null,
    );
  }
  findByRef(provider: string, ref: string) {
    return Promise.resolve(
      this.rows.find((r) => r.provider === provider && r.providerRef === ref) ??
        null,
    );
  }
  insert(intent: PaymentIntent) {
    if (this.rows.some((r) => r.providerRef === intent.providerRef))
      return Promise.reject(Object.assign(new Error('dup'), { code: '23505' }));
    this.rows.push({ ...intent });
    return Promise.resolve();
  }
  markPaid(id: string, paidAt: Date) {
    const row = this.rows.find((r) => r.id === id)!;
    if (!['pending', 'authorized', 'expired'].includes(row.status))
      return Promise.resolve(false);
    row.status = 'paid';
    row.paidAt = paidAt;
    return Promise.resolve(true);
  }
  setStatus(
    id: string,
    status: PaymentIntentStatus,
    onlyFrom?: PaymentIntentStatus[],
  ) {
    const row = this.rows.find((r) => r.id === id)!;
    if (!onlyFrom || onlyFrom.includes(row.status)) row.status = status;
    return Promise.resolve();
  }
}
