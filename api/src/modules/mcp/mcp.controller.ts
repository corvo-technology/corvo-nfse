import { PublicRoute } from '@/modules/auth/application/public-route.decorator';
import { RawResponse } from '@/shared/http/response.interceptor';
import {
  DeferRateLimit,
  HttpApiRateLimitGuard,
} from '@/shared/http/rate-limit.guard';
import {
  Controller,
  Get,
  Inject,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  MCP_SERVER_INFO,
  type McpServer,
  type McpRequest,
  type McpResponse,
} from './mcp.server';
import { McpService } from './mcp.service';
import { McpAuthGuard } from './mcp-auth.guard';
import {
  MCP_CONNECTION_REPOSITORY,
  type McpConnectionRepository,
} from './domain/mcp-connection.repository';
import type { AuthContext } from '../auth/auth-context';

@ApiTags('MCP')
@Controller('mcp')
@RawResponse()
@PublicRoute()
export class McpController {
  private readonly server: McpServer;
  private readonly logger = new Logger(McpController.name);

  constructor(
    mcpService: McpService,
    @Inject(MCP_CONNECTION_REPOSITORY)
    private readonly connections: McpConnectionRepository,
  ) {
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
    await this.recordUsage(authContext, requests, results);
    return results.length === 1 ? results[0] : results;
  }

  /** Best-effort: usage numbers must never fail a tool call. */
  private async recordUsage(
    auth: AuthContext,
    requests: McpRequest[],
    results: McpResponse[],
  ): Promise<void> {
    if (!auth.mcpConnectionId) return;
    let toolCalls = 0;
    let invoicesIssued = 0;
    requests.forEach((request, index) => {
      const result = results[index];
      const failed =
        result?.error !== undefined ||
        (result?.result as { isError?: boolean } | undefined)?.isError === true;
      if (request.method !== 'tools/call' || failed) return;
      toolCalls += 1;
      if (request.params?.name === 'nfse_issue') invoicesIssued += 1;
    });
    try {
      await this.connections.recordUsage(auth.mcpConnectionId, auth.tenantId, {
        toolCalls,
        invoicesIssued,
      });
    } catch (error) {
      this.logger.warn(`Could not record MCP usage: ${String(error)}`);
    }
  }
}
