// EmailModule only produces jobs. EmailProcessor belongs to WorkerAppModule.
import { Module } from '@nestjs/common';
import { EmailService } from './application/email.service';
import { WebhooksConfigModule } from '@/modules/webhooks-config/webhooks-config.module';

@Module({
  imports: [WebhooksConfigModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
