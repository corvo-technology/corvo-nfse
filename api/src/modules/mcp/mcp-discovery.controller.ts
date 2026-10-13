import { RawResponse } from '@/shared/http/response.interceptor';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PublicRoute } from '../auth/application/public-route.decorator';

/**
 * MCP discovery manifest, served at the domain root (`/.well-known/mcp.json`)
 * via the global-prefix exclusion configured in `src/bootstrap-http.ts`.
 */
@PublicRoute()
@ApiTags('MCP')
@Controller()
@RawResponse()
export class McpDiscoveryController {
  @Get('/.well-known/mcp.json')
  wellKnown(): Record<string, unknown> {
    return {
      name: 'corvo-nfse',
      version: '1.0.0',
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
    };
  }
}
