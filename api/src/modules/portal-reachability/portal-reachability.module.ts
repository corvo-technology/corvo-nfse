import { Module } from '@nestjs/common';
import { EmailModule } from '@/modules/email/email.module';
import { InvoiceModule } from '@/modules/invoice/invoice.module';
import { PortalReachabilityReadModule } from './portal-reachability-read.module';
import { PortalAlertContext } from './portal-alert-context';
import { PortalReachabilityMonitor } from './portal-reachability.monitor';

/** Worker only: tells the platform operator when the servers cannot reach the government portal. */
@Module({
  imports: [InvoiceModule, EmailModule, PortalReachabilityReadModule],
  providers: [PortalAlertContext, PortalReachabilityMonitor],
})
export class PortalReachabilityModule {}
