import { Global, Module } from '@nestjs/common';
import { MillionSendEmailProvider } from './mmsend-email.provider';
import { MillionSendTemplateClient } from './email-template.client';

@Global()
@Module({
  providers: [MillionSendEmailProvider, MillionSendTemplateClient],
  exports: [MillionSendEmailProvider, MillionSendTemplateClient],
})
export class EmailExternalModule {}
