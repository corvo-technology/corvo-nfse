import { PublicRoute } from '@/modules/auth/application/public-route.decorator';
import { RawResponse } from '@/shared/http/response.interceptor';
import {
  DeferRateLimit,
  HttpApiRateLimitGuard,
} from '@/shared/http/rate-limit.guard';
import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { MCP_SERVER_INFO, type McpServer, type McpRequest } from './mcp.server';
import { McpService } from './mcp.service';
import { McpAuthGuard } from './mcp-auth.guard';
import type { AuthContext } from '../auth/auth-context';

@ApiTags('MCP')
@Controller('mcp')
@RawResponse()
@PublicRoute()
export class McpController {
  private readonly server: McpServer;

  constructor(mcpService: McpService) {
    this.server = mcpService.getServer();
  }

  @Get()
  get() {
    // MCP initialize handshake / SSE probe — no auth required.
    // Streamable HTTP allows GET with a body for SSE, but until SSE is wired we
    // just return server metadata for an empty (or any) body.
    return MCP_SERVER_INFO;
  }

  @Post()
  @HttpCode(200)
  @DeferRateLimit()
  @UseGuards(McpAuthGuard, HttpApiRateLimitGuard)
  async post(@Req() req: Request, @Res({ passthrough: true }) _res: Response) {
    const authContext = (req as Request & { authContext: AuthContext })
      .authContext;
    const body = req.body as McpRequest | McpRequest[];
    const requests = Array.isArray(body) ? body : [body];
    const results = await Promise.all(
      requests.map((r) => this.server.handleRequest(r, authContext)),
    );
    return results.length === 1 ? results[0] : results;
  }
}
