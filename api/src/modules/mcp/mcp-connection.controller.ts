import { ApiCursorResponse } from '@/infra/openapi/swagger';
import { CursorQuery } from '@/shared/http/pagination';
import { data } from '@/shared/http/response';
import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { RequestWithAuthContext } from '../auth/auth-context';
import { McpConnectionService } from './mcp-connection.service';

/**
 * "Aplicativos de IA conectados" in the dashboard. Standard session auth
 * (cookie + CSRF): members manage their own connections, admins every one in
 * the workspace.
 */
@ApiTags('MCP')
@Controller('mcp/connections')
export class McpConnectionController {
  constructor(private readonly connections: McpConnectionService) {}

  @Get()
  @ApiCursorResponse()
  list(@Req() req: RequestWithAuthContext, @Query() options: CursorQuery) {
    return this.connections.listPage(this.humanContext(req), options);
  }

  @Delete(':id')
  async revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    await this.connections.revoke(id, this.humanContext(req));
    return data({ revoked: true });
  }

  private humanContext(req: RequestWithAuthContext) {
    const auth = req.authContext;
    if (!auth?.sessionId || auth.principalType === 'api_key') {
      throw new UnauthorizedException({
        code: 'SESSION_REQUIRED',
        message: 'A logged-in user session is required',
      });
    }
    return auth;
  }
}
