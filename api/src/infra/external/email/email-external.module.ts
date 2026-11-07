import { Global, Module } from '@nestjs/common';
import { MillionSendEmailProvider } from './mmsend-email.provider';

@Global()
@Module({
  providers: [MillionSendEmailProvider],
  exports: [MillionSendEmailProvider],
})
export class EmailExternalModule {}
