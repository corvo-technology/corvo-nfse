import { MCP_CONNECTION_REPOSITORY } from './domain/mcp-connection.repository';
import { HttpApiRateLimitGuard } from '@/shared/http/rate-limit.guard';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AuthAuthorizationCodeOrmEntity,
  AuthOAuthClientOrmEntity,
  AuthSessionOrmEntity,
} from '@/infra/persistence/typeorm/entities/auth.orm-entities';
import { CompanyModule } from '@/modules/company/company.module';
import { ImportModule } from '@/modules/import/import.module';
import { InvoiceScheduleModule } from '@/modules/invoice-schedule/invoice-schedule.module';
import { InvoiceModule } from '@/modules/invoice/invoice.module';
import { CertificateModule } from '@/modules/certificate/certificate.module';
import { BillingUsageModule } from '@/modules/billing/billing-usage.module';
import { CreditsModule } from '@/modules/credits/credits.module';
import { PlansModule } from '@/modules/plans/plans.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { McpConnectionOrmEntity } from './infra/mcp-connection.orm-entity';
import { TypeOrmMcpConnectionRepository } from './infra/mcp-connection.repository';
import { McpController } from './mcp.controller';
import { McpOAuthController } from './mcp-oauth.controller';
import { McpConsentController } from './mcp-consent.controller';
import { McpDiscoveryController } from './mcp-discovery.controller';
import { McpRegistrationController } from './mcp-registration.controller';
import { McpUrlService } from './mcp-urls.service';
import { McpConnectionController } from './mcp-connection.controller';
import { McpConnectionService } from './mcp-connection.service';
import { McpAuthService } from './mcp-auth.service';
import { McpAuthGuard } from './mcp-auth.guard';
import { McpService } from './mcp.service';

@Module({
  imports: [
    // OAuth bootstrap stores; invoice tools use InvoiceModule's scoped port.
    TypeOrmModule.forFeature([
      McpConnectionOrmEntity,
      AuthOAuthClientOrmEntity,
      AuthAuthorizationCodeOrmEntity,
      AuthSessionOrmEntity,
    ]),
    InvoiceModule,
    InvoiceScheduleModule,
    ImportModule,
    PlansModule,
    // Read tools: certificate status, credit balance/history.
    CertificateModule,
    BillingUsageModule,
    CreditsModule,
    // Company listing for the company_list tool.
    CompanyModule,
    // Membership/OAuth/user repositories used by consent and connections.
    // AuthModule does not import McpModule, so no cycle.
    AuthModule,
  ],
  controllers: [
    McpController,
    McpOAuthController,
    McpConsentController,
    McpDiscoveryController,
    McpRegistrationController,
    McpConnectionController,
  ],
  providers: [
    McpUrlService,
    HttpApiRateLimitGuard,
    McpService,
    McpAuthService,
    McpAuthGuard,
    McpConnectionService,
    {
      provide: MCP_CONNECTION_REPOSITORY,
      useClass: TypeOrmMcpConnectionRepository,
    },
  ],
  exports: [McpService],
})
export class McpModule {}
