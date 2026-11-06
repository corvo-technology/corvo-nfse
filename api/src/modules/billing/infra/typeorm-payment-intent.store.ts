import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  PaymentIntentStore,
  type PaymentIntent,
  type PaymentIntentStatus,
} from '../domain/payment-intent';
import { PaymentIntentOrmEntity } from './payment-intent.orm-entity';

const toDomain = (row: PaymentIntentOrmEntity): PaymentIntent => ({
  ...row,
  kind: row.kind as PaymentIntent['kind'],
  cycle: row.cycle as PaymentIntent['cycle'],
  provider: row.provider as PaymentIntent['provider'],
  status: row.status as PaymentIntentStatus,
});

/** Provider-keyed lookups run without a tenant context: webhooks only know the correlationID. */
@Injectable()
export class TypeOrmPaymentIntentStore extends PaymentIntentStore {
  constructor(
    @InjectRepository(PaymentIntentOrmEntity)
    private readonly repo: Repository<PaymentIntentOrmEntity>,
  ) {
    super();
  }
  async findByKey(tenantId: string, idempotencyKey: string) {
    const row = await this.repo.findOneBy({ tenantId, idempotencyKey });
    return row ? toDomain(row) : null;
  }
  async findLiveSubscriptions(tenantId: string) {
    const rows = await this.repo.find({
      where: {
        tenantId,
        provider: 'woovi',
        kind: 'plan',
        cycle: 'monthly',
        // Contract rows carry the idempotency key; per-cycle charge rows do not.
        idempotencyKey: Not(IsNull()),
        status: In(['pending', 'authorized']),
      },
      order: { createdAt: 'DESC' },
    });
    return rows.map(toDomain);
  }
  async findByRef(provider: string, providerRef: string) {
    const row = await this.repo.findOneBy({ provider, providerRef });
    return row ? toDomain(row) : null;
  }
  async insert(intent: PaymentIntent) {
    await this.repo.insert({ ...intent });
  }
  async markPaid(id: string, paidAt: Date) {
    const result = await this.repo.update(
      { id, status: In(['pending', 'authorized', 'expired']) },
      { status: 'paid', paidAt },
    );
    return (result.affected ?? 0) > 0;
  }
  async setStatus(
    id: string,
    status: PaymentIntentStatus,
    onlyFrom?: PaymentIntentStatus[],
  ) {
    await this.repo.update(onlyFrom ? { id, status: In(onlyFrom) } : { id }, {
      status,
    });
  }
}
