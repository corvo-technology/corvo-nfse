import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { AppConfig } from '@/infra/config/configuration.types';

/** Public URLs advertised to MCP clients and used to hand the browser to the dashboard. */
@Injectable()
export class McpUrlService {
  constructor(private readonly config: ConfigService) {}

  apiPrefix(): string {
    return this.config.getOrThrow<AppConfig>('app').apiPrefix;
  }

  /** Public origin of the API: PUBLIC_API_URL, else derived from the request. */
  apiOrigin(req: Request): string {
    const configured = this.config.get<string>('PUBLIC_API_URL');
    if (configured) return new URL(configured).origin;
    return `${req.protocol}://${req.get('host') ?? 'localhost'}`;
  }

  /** Canonical MCP address (`/mcp`, no version prefix). */
  mcpResource(req: Request): string {
    return `${this.apiOrigin(req)}/mcp`;
  }

  resourceMetadataUrl(req: Request): string {
    return `${this.apiOrigin(req)}/.well-known/oauth-protected-resource`;
  }

  /** Dashboard origin where login and consent happen. */
  dashboardOrigin(): string {
    const configured =
      this.config.get<string>('DASHBOARD_URL') ??
      this.config.get<string>('APP_URL') ??
      this.config.getOrThrow<AppConfig>('app').corsOrigins[0];
    return new URL(configured).origin;
  }
}
