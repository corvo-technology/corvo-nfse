import { RawResponse } from '@/shared/http/response.interceptor';
import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHash } from 'crypto';
import { IOAuthClientRepository } from '../auth/domain/oauth-client.repository';
import type { OAuthClient } from '../auth/domain/oauth-client';
import type { Request, Response } from 'express';
import { PublicRoute } from '../auth/application/public-route.decorator';
import { IAuthSessionRepository } from '../auth/domain/auth-session.repository';
import { AuthorizeQueryDto } from './dto/authorize-query.dto';

import { McpAuthService, TokenResponse } from './mcp-auth.service';
import {
  MCP_CLIENT_ID,
  MCP_SCOPES,
  matchesRegisteredRedirectUri,
} from './mcp-client-policy';
import { McpUrlService } from './mcp-urls.service';

type OAuthErrorBody = {
  error: string;
  error_description: string;
};

@PublicRoute()
@ApiTags('MCP')
@Controller('mcp')
@RawResponse()
export class McpOAuthController {
  constructor(
    @Inject(IOAuthClientRepository)
    private readonly clients: IOAuthClientRepository,
    private readonly urls: McpUrlService,
    @Inject(IAuthSessionRepository)
    private readonly sessionRepository: IAuthSessionRepository,
    private readonly mcpAuth: McpAuthService,
  ) {}

  /**
   * OAuth 2.0 authorization endpoint entry point. Validates the request, then
   * hands the browser to the dashboard (`/mcp/authorize`), where the user
   * logs in if needed and approves the connection. The dashboard keeps the
   * session cookie, so login and consent never run on the API origin.
   */
  @Get('authorize')
  async authorize(
    @Query() query: AuthorizeQueryDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const client = await this.findActiveClient(query.client_id);
    this.requireRegisteredRedirectUri(client, query.redirect_uri);

    const params = new URLSearchParams({
      client_id: query.client_id,
      redirect_uri: query.redirect_uri,
      response_type: query.response_type,
      scope: query.scope || MCP_SCOPES.join(' '),
      code_challenge: query.code_challenge,
      code_challenge_method: query.code_challenge_method,
      state: query.state,
    });
    res.redirect(
      302,
      `${this.urls.dashboardOrigin()}/mcp/authorize?${params.toString()}`,
    );
  }

  /**
   * OAuth 2.0 token endpoint. Accepts JSON or form-urlencoded bodies.
   */
  @Post('token')
  @HttpCode(200)
  async token(
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = normalizeRequestBody(req.body);
    } catch {
      this.sendOAuthError(res, 400, {
        error: 'invalid_request',
        error_description: 'Malformed request body',
      });
      return;
    }

    const grantType =
      typeof body.grant_type === 'string' ? body.grant_type : '';
    if (grantType === 'authorization_code') {
      await this.handleAuthorizationCodeGrant(body, res);
      return;
    }
    if (grantType === 'refresh_token') {
      await this.handleRefreshTokenGrant(body, res);
      return;
    }
    this.sendOAuthError(res, 400, {
      error: grantType ? 'unsupported_grant_type' : 'invalid_request',
      error_description: grantType
        ? `Unsupported grant_type: ${grantType}`
        : 'grant_type is required',
    });
  }

  /**
   * RFC 7009 token revocation. Always responds 200 with an empty body when
   * the request is well-formed, even if the token is unknown.
   */
  @Post('revoke')
  @HttpCode(200)
  async revoke(
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = normalizeRequestBody(req.body);
    } catch {
      this.sendOAuthError(res, 400, {
        error: 'invalid_request',
        error_description: 'Malformed request body',
      });
      return;
    }

    const rawToken =
      typeof body.token === 'string'
        ? body.token
        : typeof body.refresh_token === 'string'
          ? body.refresh_token
          : '';
    if (!rawToken) {
      this.sendOAuthError(res, 400, {
        error: 'invalid_request',
        error_description: 'token or refresh_token is required',
      });
      return;
    }

    const hash = createHash('sha256').update(rawToken).digest('hex');
    const session =
      await this.sessionRepository.findActiveByRefreshTokenHash(hash);
    if (session) {
      await this.mcpAuth.revokeSession(
        session.id,
        session.activeTenantId!,
        session.authUserId,
        session.clientId,
      );
    }
    res.status(200).json({});
  }

  private async handleAuthorizationCodeGrant(
    body: Record<string, unknown>,
    res: Response,
  ): Promise<void> {
    const code = asString(body.code);
    const codeVerifier = asString(body.code_verifier);
    const redirectUri = asString(body.redirect_uri);
    const clientId = asString(body.client_id) ?? MCP_CLIENT_ID;

    if (!code || !codeVerifier || !redirectUri) {
      this.sendOAuthError(res, 400, {
        error: 'invalid_request',
        error_description:
          'code, code_verifier and redirect_uri are required for authorization_code grant',
      });
      return;
    }

    const client = await this.findActiveClient(clientId);
    this.requireRegisteredRedirectUri(client, redirectUri);

    try {
      const tokens = await this.mcpAuth.exchangeCode({
        code,
        codeVerifier,
        clientId,
        redirectUri,
      });
      res.json(toOAuthTokenResponse(tokens));
    } catch {
      this.sendOAuthError(res, 400, {
        error: 'invalid_grant',
        error_description: 'Authorization code is invalid or expired',
      });
    }
  }

  private async handleRefreshTokenGrant(
    body: Record<string, unknown>,
    res: Response,
  ): Promise<void> {
    const refreshToken = asString(body.refresh_token);
    if (!refreshToken) {
      this.sendOAuthError(res, 400, {
        error: 'invalid_request',
        error_description: 'refresh_token is required for refresh_token grant',
      });
      return;
    }

    try {
      const tokens = await this.mcpAuth.refreshTokens(refreshToken);
      res.json(toOAuthTokenResponse(tokens));
    } catch {
      this.sendOAuthError(res, 400, {
        error: 'invalid_grant',
        error_description: 'Refresh token is invalid or expired',
      });
    }
  }

  private async findActiveClient(clientId: string): Promise<OAuthClient> {
    const client = await this.clients.findById(clientId);
    if (!client || !client.isActive) {
      throw new BadRequestException({
        error: 'invalid_client',
        error_description: 'Unknown or inactive client',
      });
    }
    return client;
  }

  private requireRegisteredRedirectUri(
    client: OAuthClient,
    redirectUri: string,
  ): void {
    if (!matchesRegisteredRedirectUri(client.redirectUris, redirectUri)) {
      throw new BadRequestException({
        error: 'invalid_request',
        error_description: 'redirect_uri is not registered for this client',
      });
    }
  }

  private sendOAuthError(
    res: Response,
    status: number,
    body: OAuthErrorBody,
  ): void {
    res.status(status).json(body);
  }
}

/**
 * Accepts JSON objects, already-parsed urlencoded objects, and raw strings
 * (form-urlencoded bodies that slipped through as strings). Throws on
 * anything that cannot be interpreted as a flat key/value body.
 */
function normalizeRequestBody(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'string') {
    const params = new URLSearchParams(raw);
    const result: Record<string, unknown> = {};
    for (const [key, value] of params) result[key] = value;
    return result;
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  throw new Error('Unsupported body type');
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Map internal TokenResponse (camelCase) to the OAuth-standard JSON body. */
function toOAuthTokenResponse(tokens: TokenResponse): Record<string, unknown> {
  return {
    access_token: tokens.accessToken,
    token_type: tokens.tokenType,
    expires_in: tokens.expiresIn,
    refresh_token: tokens.refreshToken,
    scope: tokens.scope,
  };
}
