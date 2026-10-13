import { RawResponse } from '@/shared/http/response.interceptor';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { PublicRoute } from '../auth/application/public-route.decorator';
import { CookieSessionService } from '../auth/application/cookie-session.service';
import { extractCookie } from '../auth/application/cookie-reader';
import {
  ITenantMembershipRepository,
  type TenantMembershipWithEstablishmentName,
} from '../auth/domain/tenant-membership.repository';
import { AuthOAuthClientOrmEntity } from '@/infra/persistence/typeorm/entities/auth.orm-entities';
import type { AppConfig } from '@/infra/config/configuration.types';
import { AuthorizeQueryDto } from './dto/authorize-query.dto';
import { McpAuthService } from './mcp-auth.service';
import {
  CORVO_LOGO_ORIGIN,
  redirectCspSource,
  renderConsentPage,
  type ConsentPageInput,
} from './templates/mcp-consent.page';

/** Body of the consent form POST (browser form, urlencoded). */
class ConsentSubmitDto {
  selected_tenant_id!: string;
  state!: string;
  code_challenge!: string;
  code_challenge_method!: string;
  redirect_uri!: string;
  scope!: string;
  client_id!: string;
}

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'nfse:read': 'Consultar e baixar notas fiscais',
  'nfse:write': 'Emitir e cancelar notas fiscais',
};

@PublicRoute()
@ApiTags('MCP')
@Controller('mcp')
@RawResponse()
export class McpConsentController {
  constructor(
    private readonly sessions: CookieSessionService,
    @Inject(ITenantMembershipRepository)
    private readonly memberships: ITenantMembershipRepository,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly mcpAuth: McpAuthService,
  ) {}

  @Get('consent')
  async consentForm(
    @Query() query: AuthorizeQueryDto,
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ): Promise<string> {
    const authUserId = await this.requireAuthUserId(req);
    const client = await this.requireActiveClient(query.client_id);
    this.requireRegisteredRedirectUri(client, query.redirect_uri);

    const tenants = await this.memberships
      .listActiveWithEstablishmentByAuthUserAndProduct(authUserId, 'corvo')
      .then((rows) =>
        rows.map((row: TenantMembershipWithEstablishmentName) => ({
          id: row.tenantId,
          name: row.establishmentName,
        })),
      );

    const scopes = this.parseScopes(query.scope);
    const html = renderConsentPage({
      clientId: client.id,
      clientName: client.name,
      scopes,
      tenants,
      state: query.state,
      redirectUri: query.redirect_uri,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
      formAction: `${this.apiPrefix()}/mcp/consent`,
    } satisfies ConsentPageInput);

    // helmet's default `form-action 'self'` makes browsers block the 302 to the
    // client's redirect_uri after the POST; allow exactly that target.
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        'font-src https://fonts.gstatic.com',
        `img-src 'self' data: ${CORVO_LOGO_ORIGIN}`,
        "script-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        `form-action 'self' ${redirectCspSource(query.redirect_uri)}`,
      ].join('; '),
    );
    res.status(200).type('text/html');
    return html;
  }

  @Post('consent')
  async consentSubmit(
    @Body() body: ConsentSubmitDto,
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const authUserId = await this.requireAuthUserId(req);

    const required: (keyof ConsentSubmitDto)[] = [
      'selected_tenant_id',
      'state',
      'code_challenge',
      'code_challenge_method',
      'redirect_uri',
      'scope',
      'client_id',
    ];
    for (const field of required) {
      if (typeof body?.[field] !== 'string' || body[field].length === 0) {
        throw new BadRequestException({
          error: 'invalid_request',
          error_description: `Missing parameter: ${field}`,
        });
      }
    }

    if (body.code_challenge_method !== 'S256') {
      throw new BadRequestException({
        error: 'invalid_request',
        error_description: 'Unsupported code_challenge_method',
      });
    }

    const client = await this.requireActiveClient(body.client_id);
    this.requireRegisteredRedirectUri(client, body.redirect_uri);

    // The selected tenant must be an ACTIVE membership of the requesting user.
    const membership = await this.memberships.findByAuthUserAndTenant(
      authUserId,
      body.selected_tenant_id,
    );
    if (!membership || !membership.isActive) {
      throw new BadRequestException({
        error: 'invalid_request',
        error_description: 'Selected tenant is not available for this user',
      });
    }

    // Bind the submission to the state cookie set by /mcp/authorize when
    // present, so a tampered form cannot be replayed against another flow.
    const expectedState = extractCookie(req, 'mcp_oauth_state');
    if (expectedState !== undefined && expectedState !== body.state) {
      throw new BadRequestException({
        error: 'invalid_request',
        error_description: 'State mismatch',
      });
    }

    const code = await this.mcpAuth.createAuthorizationCode({
      clientId: body.client_id,
      userId: authUserId,
      tenantId: body.selected_tenant_id,
      redirectUri: body.redirect_uri,
      scope: body.scope,
      codeChallenge: body.code_challenge,
      codeChallengeMethod: 'S256',
    });

    const target = new URL(body.redirect_uri);
    target.searchParams.set('code', code);
    target.searchParams.set('state', body.state);
    res.redirect(302, target.toString());
  }

  private async requireAuthUserId(req: Request): Promise<string> {
    const token =
      extractCookie(req, 'corvo_session') ??
      extractCookie(req, 'gf_session_dev') ??
      extractCookie(req, '__Host-gf_session');
    if (!token) {
      throw new UnauthorizedException('Session cookie is required');
    }
    const session = await this.sessions.validateSession(token);
    if (!session) {
      throw new UnauthorizedException('Invalid or expired session');
    }
    return session.authUserId;
  }

  private async requireActiveClient(clientId: string) {
    const client = await this.dataSource
      .getRepository(AuthOAuthClientOrmEntity)
      .findOne({ where: { id: clientId } });
    if (!client || !client.isActive) {
      throw new BadRequestException({
        error: 'invalid_client',
        error_description: 'Unknown or inactive client',
      });
    }
    return client;
  }

  private requireRegisteredRedirectUri(
    client: AuthOAuthClientOrmEntity,
    redirectUri: string,
  ): void {
    if (!client.redirectUris.includes(redirectUri)) {
      throw new BadRequestException({
        error: 'invalid_request',
        error_description: 'redirect_uri is not registered for this client',
      });
    }
  }

  private parseScopes(scope: string): ConsentPageInput['scopes'] {
    const names = scope
      .split(/\s+/)
      .filter((name) => name.length > 0 && name in SCOPE_DESCRIPTIONS);
    return names.map((name) => ({
      name,
      description: SCOPE_DESCRIPTIONS[name],
    }));
  }

  private apiPrefix(): string {
    return this.config.getOrThrow<AppConfig>('app').apiPrefix;
  }
}
