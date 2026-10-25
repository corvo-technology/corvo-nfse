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
  get(@Res({ passthrough: true }) res: Response) {
    // Streamable HTTP lets a server refuse the optional SSE stream with 405.
    // Clients then keep using POST only.
    res.status(405).set('Allow', 'POST');
    return {
      error: 'method_not_allowed',
      error_description: 'Use POST with a JSON-RPC message',
    };
  }

  @Post()
  @HttpCode(200)
  @DeferRateLimit()
  @UseGuards(McpAuthGuard, HttpApiRateLimitGuard)
  async post(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const authContext = (req as Request & { authContext: AuthContext })
      .authContext;
    const body = req.body as McpRequest | McpRequest[];
    const requests = Array.isArray(body) ? body : [body];
    const results = await Promise.all(
      requests.map((r) => this.server.handleRequest(r, authContext)),
    );
    await this.recordUsage(authContext, requests, results);
    const replies = results.filter(
      (result): result is McpResponse => result !== null,
    );
    // Only notifications/responses were sent: accept them with no body.
    if (replies.length === 0) {
      res.status(202);
      return;
    }
    return Array.isArray(body) ? replies : replies[0];
  }

  /** Best-effort: usage numbers must never fail a tool call. */
  private async recordUsage(
    auth: AuthContext,
    requests: McpRequest[],
    results: (McpResponse | null)[],
  ): Promise<void> {
    if (!auth.mcpConnectionId) return;
    let toolCalls = 0;
    let invoicesIssued = 0;
    requests.forEach((request, index) => {
      const result = results[index];
      const failed =
        result?.error !== undefined ||
        (result?.result as { isError?: boolean } | undefined)?.isError === true;
      if (request?.method !== 'tools/call' || failed) return;
      toolCalls += 1;
      invoicesIssued += invoicesIssuedBy(request.params?.name, result);
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

/** Invoices a successful tool call created: 1 for nfse_issue, the newly accepted items for nfse_issue_batch. */
function invoicesIssuedBy(
  tool: string | undefined,
  result: McpResponse | null,
): number {
  if (tool === 'nfse_issue') return 1;
  return tool === 'nfse_issue_batch' ? newlyIssuedInBatch(result) : 0;
}

/** Accepted items of an nfse_issue_batch result, excluding replays of earlier calls. */
function newlyIssuedInBatch(result: McpResponse | null): number {
  const content = (
    result?.result as { content?: Array<{ text?: string }> } | undefined
  )?.content;
  try {
    const parsed = JSON.parse(content?.[0]?.text ?? '{}') as {
      results?: Array<{ status?: string; replayed?: boolean }>;
    };
    return (parsed.results ?? []).filter(
      (item) => item.status === 'accepted' && !item.replayed,
    ).length;
  } catch {
    return 0;
  }
}
