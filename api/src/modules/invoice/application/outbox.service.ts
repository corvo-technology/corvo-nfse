import { Inject, Injectable } from '@nestjs/common';
import {
  OUTBOX_REPOSITORY,
  type IOutboxRepository,
} from '../domain/outbox.repository';
import type { NewOutboxMessage } from '../domain/outbox-message';

/** Call inside the caller's transaction (TypeOrmTransactionContext) so state and message commit together. */
@Injectable()
export class OutboxService {
  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly repo: IOutboxRepository,
  ) {}

  enqueue(message: NewOutboxMessage): Promise<boolean> {
    return this.repo.insert(message);
  }
}
