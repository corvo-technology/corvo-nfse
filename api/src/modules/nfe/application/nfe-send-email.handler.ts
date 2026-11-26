import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxHandlerRegistry } from '@/modules/invoice/application/outbox-handler.registry';
import type { OutboxHandler } from '@/modules/invoice/domain/outbox-handler';
import type { OutboxMessage } from '@/modules/invoice/domain/outbox-message';
import {
  NFE_SEND_EMAIL,
  type NfeMessagePayload,
} from '../domain/nfe-message-types';
import { NfeEmailService } from './nfe-email.service';

/** `nfe.send_email`: the NF-e to its recipient; the outbox tries again until its limit. */
@Injectable()
export class NfeSendEmailHandler implements OutboxHandler, OnModuleInit {
  readonly type = NFE_SEND_EMAIL;

  constructor(
    private readonly registry: OutboxHandlerRegistry,
    private readonly email: NfeEmailService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(message: OutboxMessage): Promise<void> {
    const { documentId } = message.payload as unknown as NfeMessagePayload;
    const maxAttempts =
      this.config.get<{ maxAttempts: number }>('outbox')?.maxAttempts ?? 1;
    await this.email.send(
      documentId,
      message.tenantId,
      message.environment,
      message.attempts >= maxAttempts,
    );
  }
}
