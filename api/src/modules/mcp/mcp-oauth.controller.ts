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
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { PublicRoute } from '../auth/application/public-route.decorator';
import { IAuthSessionRepository } from '../auth/domain/auth-session.repository';
import { AuthOAuthClientOrmEntity } from '@/infra/persistence/typeorm/entities/auth.orm-entities';
import type { AppConfig } from '@/infra/config/configuration.types';
import { AuthorizeQueryDto } from './dto/authorize-query.dto';

import { McpAuthService, TokenResponse } from './mcp-auth.service';

const STATE_COOKIE = 'mcp_oauth_state';
const STATE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

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
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    @Inject(IAuthSessionRepository)
    private readonly sessionRepository: IAuthSessionRepository,
    private readonly mcpAuth: McpAuthService,
  ) {}

  /**
   * OAuth 2.0 authorization endpoint entry point. Validates the request,
   * binds `state` to an httpOnly cookie, then hands the browser off to the
   * consent page with the exact same query parameters.
   */
  @Get('authorize')
  async authorize(
    @Query() query: AuthorizeQueryDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const client = await this.findActiveClient(query.client_id);
    this.requireRegisteredRedirectUri(client, query.redirect_uri);

    res.cookie(STATE_COOKIE, query.state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: STATE_MAX_AGE_MS,
      path: '/',
    });

    const params = new URLSearchParams({
      client_id: query.client_id,
      redirect_uri: query.redirect_uri,
      response_type: query.response_type,
      scope: query.scope,
      code_challenge: query.code_challenge,
      code_challenge_method: query.code_challenge_method,
      state: query.state,
    });
    const apiPrefix = this.config.getOrThrow<AppConfig>('app').apiPrefix;
    res.redirect(302, `/${apiPrefix}/mcp/consent?${params.toString()}`);
  }

  /**
   * Intermediate callback: verifies the state cookie set by /authorize and
   * hands code+state back to the MCP client SDK's redirect_uri.
   */
  @Get('callback')
  callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('redirect_uri') redirectUri: string,
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ): void {
    if (!code || !state || !redirectUri) {
      this.sendOAuthError(res, 400, {
        error: 'invalid_request',
        error_description:
          'code, state and redirect_uri query parameters are required',
      });
      return;
    }

    const cookieHeader = req.headers.cookie ?? '';
    const stateCookie = parseCookieValue(cookieHeader, STATE_COOKIE);
    if (!stateCookie || stateCookie !== state) {
      this.sendOAuthError(res, 400, {
        error: 'invalid_request',
        error_description: 'State validation failed',
      });
      return;
    }

    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    target.searchParams.set('state', state);
    res.redirect(302, target.toString());
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
    const clientId = asString(body.client_id) ?? 'corvo-mcp';

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

  private async findActiveClient(
    clientId: string,
  ): Promise<AuthOAuthClientOrmEntity> {
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

function parseCookieValue(
  cookieHeader: string,
  name: string,
): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
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
