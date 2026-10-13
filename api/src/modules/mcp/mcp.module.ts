import { ConnectionSessionGuard } from './connection-session.guard';
import { HttpApiRateLimitGuard } from '@/shared/http/rate-limit.guard';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AuthAuthorizationCodeOrmEntity,
  AuthOAuthClientOrmEntity,
  AuthSessionOrmEntity,
} from '@/infra/persistence/typeorm/entities/auth.orm-entities';
import { InvoiceModule } from '@/modules/invoice/invoice.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { McpConnectionOrmEntity } from './infra/mcp-connection.orm-entity';
import { TypeOrmMcpConnectionRepository } from './infra/mcp-connection.repository';
import { McpController } from './mcp.controller';
import { McpOAuthController } from './mcp-oauth.controller';
import { McpConsentController } from './mcp-consent.controller';
import { McpDiscoveryController } from './mcp-discovery.controller';
import { McpDashboardController } from './mcp-dashboard.controller';
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
    // CookieSessionService (session-cookie validation for consent/dashboard).
    // AuthModule does not import McpModule, so no cycle.
    AuthModule,
  ],
  controllers: [
    McpController,
    McpOAuthController,
    McpConsentController,
    McpDiscoveryController,
    McpDashboardController,
    McpConnectionController,
  ],
  providers: [
    ConnectionSessionGuard,
    HttpApiRateLimitGuard,
    McpService,
    McpAuthService,
    McpAuthGuard,
    McpConnectionService,
    TypeOrmMcpConnectionRepository,
  ],
  exports: [McpService],
})
export class McpModule {}
