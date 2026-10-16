import { RawResponse } from '@/shared/http/response.interceptor';
import { Controller, Get, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PublicRoute } from '../auth/application/public-route.decorator';
import { MCP_SCOPES } from './mcp-client-policy';
import { McpUrlService } from './mcp-urls.service';

/**
 * Discovery documents, served at the domain root via the global-prefix
 * exclusions configured in `src/bootstrap-http.ts`:
 * - `/.well-known/mcp.json` (server manifest)
 * - `/.well-known/oauth-protected-resource` (RFC 9728)
 * - `/.well-known/oauth-authorization-server` (RFC 8414)
 */
@PublicRoute()
@ApiTags('MCP')
@Controller()
@RawResponse()
export class McpDiscoveryController {
  constructor(private readonly urls: McpUrlService) {}

  @Get('/.well-known/mcp.json')
  wellKnown(): Record<string, unknown> {
    return {
      name: 'corvo-nfse',
      version: '1.0.0',
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
    };
  }

  @Get('/.well-known/oauth-protected-resource')
  protectedResource(@Req() req: Request): Record<string, unknown> {
    return {
      resource: this.urls.mcpResource(req),
      authorization_servers: [this.urls.apiOrigin(req)],
      scopes_supported: [...MCP_SCOPES],
      bearer_methods_supported: ['header'],
      resource_name: 'Corvo NFS-e',
    };
  }

  /** Path-suffixed variants requested by clients for the `/mcp` resource. */
  @Get([
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-protected-resource/v1/mcp',
  ])
  protectedResourceForMcp(@Req() req: Request): Record<string, unknown> {
    return this.protectedResource(req);
  }

  @Get('/.well-known/oauth-authorization-server')
  authorizationServer(@Req() req: Request): Record<string, unknown> {
    const origin = this.urls.apiOrigin(req);
    const base = `${origin}/mcp`;
    return {
      issuer: origin,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      revocation_endpoint: `${base}/revoke`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [...MCP_SCOPES],
    };
  }
}
