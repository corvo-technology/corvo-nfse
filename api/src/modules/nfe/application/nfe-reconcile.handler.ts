import { Injectable, OnModuleInit } from '@nestjs/common';
import { OutboxHandlerRegistry } from '@/modules/invoice/application/outbox-handler.registry';
import type { OutboxHandler } from '@/modules/invoice/domain/outbox-handler';
import type { OutboxMessage } from '@/modules/invoice/domain/outbox-message';
import {
  NFE_RECONCILE,
  NFE_PREPARE_DOCUMENTS,
  type NfeMessagePayload,
} from '../domain/nfe-message-types';
import { NfeConsultService } from './nfe-consult.service';

/** `nfe.reconcile`: the automatic look at the SEFAZ for a document whose answer was lost. */
@Injectable()
export class NfeReconcileHandler implements OutboxHandler, OnModuleInit {
  readonly type = NFE_RECONCILE;

  constructor(
    private readonly registry: OutboxHandlerRegistry,
    private readonly consult: NfeConsultService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(message: OutboxMessage): Promise<void> {
    const { documentId, tenantId } =
      message.payload as unknown as NfeMessagePayload;
    await this.consult.sync(
      documentId,
      tenantId,
      message.environment,
      'automatic',
    );
  }
}

/**
 * `nfe.prepare_documents` is enqueued with every authorization. The `nfeProc`, the DANFE and the
 * storage arrive in PR 6 (it replaces this handler); until then the message is acknowledged, so
 * the outbox does not count it as a failure.
 */
@Injectable()
export class NfePrepareDocumentsPlaceholder
  implements OutboxHandler, OnModuleInit
{
  readonly type = NFE_PREPARE_DOCUMENTS;

  constructor(private readonly registry: OutboxHandlerRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  handle(): Promise<void> {
    return Promise.resolve();
  }
}
