import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { data } from '@/shared/http/response';
import type { RequestWithAuthContext } from '../auth/auth-context';
import { IOAuthClientRepository } from '../auth/domain/oauth-client.repository';
import type { OAuthClient } from '../auth/domain/oauth-client';
import {
  permissionsForTenantRole,
  type TenantPermission,
} from '../auth/domain/permission';
import { ITenantMembershipRepository } from '../auth/domain/tenant-membership.repository';
import { ConsentDecisionDto, ConsentRequestDto } from './dto/consent.dto';
import {
  MCP_SCOPES,
  SCOPE_DESCRIPTIONS,
  matchesRegisteredRedirectUri,
  parseScopes,
} from './mcp-client-policy';
import { McpAuthService } from './mcp-auth.service';

const SCOPE_PERMISSION: Record<string, TenantPermission> = {
  'nfse:read': 'nfse.invoices.view',
  'nfse:write': 'nfse.invoices.issue',
};

/**
 * Consent API used by the dashboard screen `/mcp/authorize`. It runs behind
 * the normal session guard (cookie + CSRF), so only a logged-in human can
 * approve a connection.
 */
@ApiTags('MCP')
@Controller('mcp/consent')
export class McpConsentController {
  constructor(
    @Inject(ITenantMembershipRepository)
    private readonly memberships: ITenantMembershipRepository,
    @Inject(IOAuthClientRepository)
    private readonly clients: IOAuthClientRepository,
    private readonly mcpAuth: McpAuthService,
  ) {}

  /** What the screen shows: the app, what it asks for and the workspaces to choose from. */
  @Get()
  async context(
    @Query() query: ConsentRequestDto,
    @Req() req: RequestWithAuthContext,
  ) {
    const authUserId = this.requireHuman(req);
    const client = await this.requireClient(query);
    const requested = this.requestedScopes(query.scope, client);
    const rows =
      await this.memberships.listActiveWithEstablishmentByAuthUserAndProduct(
        authUserId,
        'corvo',
      );
    return data({
      client: { id: client.id, name: client.name },
      redirect_host: redirectLabel(query.redirect_uri),
      scopes: requested.map((name) => ({
        name,
        description: SCOPE_DESCRIPTIONS[name],
      })),
      tenants: rows.map((row) => ({
        id: row.tenantId,
        name: row.establishmentName,
        allowed_scopes: requested.filter((scope) =>
          permissionsForTenantRole(row.role).includes(SCOPE_PERMISSION[scope]),
        ),
      })),
    });
  }

  /** Approve or deny; returns the URL the browser must open to go back to the app. */
  @Post()
  @HttpCode(200)
  async decide(
    @Body() body: ConsentDecisionDto,
    @Req() req: RequestWithAuthContext,
  ) {
    const authUserId = this.requireHuman(req);
    const client = await this.requireClient(body);
    const target = new URL(body.redirect_uri);

    if (body.decision === 'deny') {
      target.searchParams.set('error', 'access_denied');
      target.searchParams.set('state', body.state);
      return data({ redirect_url: target.toString() });
    }

    if (!body.tenant_id) {
      throw new BadRequestException({
        error: 'invalid_request',
        error_description: 'tenant_id is required to approve',
      });
    }
    const membership = await this.memberships.findByAuthUserAndTenant(
      authUserId,
      body.tenant_id,
    );
    if (!membership?.isActive) {
      throw new BadRequestException({
        error: 'invalid_request',
        error_description: 'Selected workspace is not available for this user',
      });
    }
    const granted = this.requestedScopes(body.scope, client);
    const allowed = permissionsForTenantRole(membership.role);
    const missing = granted.filter(
      (scope) => !allowed.includes(SCOPE_PERMISSION[scope]),
    );
    if (missing.length > 0) {
      throw new ForbiddenException({
        code: 'MCP_SCOPE_NOT_ALLOWED',
        message: `Your role in this workspace cannot grant: ${missing.join(', ')}`,
      });
    }

    const code = await this.mcpAuth.createAuthorizationCode({
      clientId: client.id,
      userId: authUserId,
      tenantId: body.tenant_id,
      redirectUri: body.redirect_uri,
      scope: granted.join(' '),
      codeChallenge: body.code_challenge,
      codeChallengeMethod: 'S256',
      environment: body.environment ?? 'test',
    });
    target.searchParams.set('code', code);
    target.searchParams.set('state', body.state);
    return data({ redirect_url: target.toString() });
  }

  private requireHuman(req: RequestWithAuthContext): string {
    const auth = req.authContext;
    if (!auth?.sessionId || auth.principalType === 'api_key') {
      throw new ForbiddenException({
        code: 'SESSION_REQUIRED',
        message: 'A logged-in user session is required',
      });
    }
    return auth.authUserId;
  }

  private async requireClient(query: ConsentRequestDto): Promise<OAuthClient> {
    const client = await this.clients.findById(query.client_id);
    if (!client?.isActive) {
      throw new BadRequestException({
        error: 'invalid_client',
        error_description: 'Unknown or inactive client',
      });
    }
    if (
      !matchesRegisteredRedirectUri(client.redirectUris, query.redirect_uri)
    ) {
      throw new BadRequestException({
        error: 'invalid_request',
        error_description: 'redirect_uri is not registered for this client',
      });
    }
    return client;
  }

  private requestedScopes(scope: string | undefined, client: OAuthClient) {
    const parsed = parseScopes(scope ?? '');
    const wanted = parsed.length > 0 ? parsed : [...MCP_SCOPES];
    return wanted.filter((name) => client.scopes.includes(name));
  }
}

/** Where the approval will be sent, shown so the user can spot a wrong app. */
function redirectLabel(uri: string): string {
  const url = new URL(uri);
  return url.host || `${url.protocol}//`;
}
