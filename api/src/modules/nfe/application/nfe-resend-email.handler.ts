import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxHandlerRegistry } from '@/modules/invoice/application/outbox-handler.registry';
import type { OutboxHandler } from '@/modules/invoice/domain/outbox-handler';
import type { OutboxMessage } from '@/modules/invoice/domain/outbox-message';
import {
  NFE_RESEND_EMAIL,
  type NfeResendEmailPayload,
} from '../domain/nfe-message-types';
import { NfeEmailService } from './nfe-email.service';

/** `nfe.resend_email`: the note sent again to its recipient (or to the address asked for). */
@Injectable()
export class NfeResendEmailHandler implements OutboxHandler, OnModuleInit {
  readonly type = NFE_RESEND_EMAIL;

  constructor(
    private readonly registry: OutboxHandlerRegistry,
    private readonly email: NfeEmailService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(message: OutboxMessage): Promise<void> {
    const { documentId, emailId, toEmail } =
      message.payload as unknown as NfeResendEmailPayload;
    const maxAttempts =
      this.config.get<{ maxAttempts: number }>('outbox')?.maxAttempts ?? 1;
    await this.email.resend(
      documentId,
      message.tenantId,
      message.environment,
      { emailId, toEmail },
      message.attempts >= maxAttempts,
    );
  }
}
