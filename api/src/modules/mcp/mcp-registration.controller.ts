import { RawResponse } from '@/shared/http/response.interceptor';
import { Body, Controller, HttpCode, Inject, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { nanoid } from 'nanoid';
import { PublicRoute } from '../auth/application/public-route.decorator';
import { IOAuthClientRepository } from '../auth/domain/oauth-client.repository';
import {
  MCP_DYNAMIC_CLIENT_PREFIX,
  MCP_SCOPES,
  isAcceptableRedirectUri,
  parseScopes,
} from './mcp-client-policy';
import { RegisterClientDto } from './dto/register-client.dto';

const DEFAULT_CLIENT_NAME = 'Aplicativo de IA';

/** Drops control characters and angle brackets; the name is shown on the consent screen. */
function cleanClientName(value: string | undefined): string {
  return [...(value ?? '')]
    .filter((char) => char.charCodeAt(0) >= 32 && char !== '<' && char !== '>')
    .join('')
    .trim();
}

class RegistrationError extends Error {
  constructor(
    readonly code: string,
    description: string,
  ) {
    super(description);
  }
}

/**
 * RFC 7591 dynamic client registration. Agents (Claude Code, Cursor, ...)
 * register themselves as public PKCE clients; the user still has to approve
 * each connection on the dashboard consent screen.
 */
@PublicRoute()
@ApiTags('MCP')
@Controller('mcp')
@RawResponse()
export class McpRegistrationController {
  constructor(
    @Inject(IOAuthClientRepository)
    private readonly clients: IOAuthClientRepository,
  ) {}

  @Post('register')
  @HttpCode(201)
  async register(
    @Body() body: RegisterClientDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      return await this.registerClient(body);
    } catch (error) {
      if (!(error instanceof RegistrationError)) throw error;
      // RFC 7591 §3.2.2 error body, not the API error envelope.
      res.status(400);
      return { error: error.code, error_description: error.message };
    }
  }

  private async registerClient(body: RegisterClientDto) {
    const redirectUris = [...new Set(body.redirect_uris)];
    if (!redirectUris.every(isAcceptableRedirectUri)) {
      throw new RegistrationError(
        'invalid_redirect_uri',
        'redirect_uris must be https, loopback http or a private-use scheme',
      );
    }
    if (
      body.token_endpoint_auth_method !== undefined &&
      body.token_endpoint_auth_method !== 'none'
    ) {
      throw new RegistrationError(
        'invalid_client_metadata',
        'Only public clients (token_endpoint_auth_method "none") are supported',
      );
    }
    if (
      body.grant_types !== undefined &&
      !body.grant_types.includes('authorization_code')
    ) {
      throw new RegistrationError(
        'invalid_client_metadata',
        'grant_types must include authorization_code',
      );
    }

    const requested = body.scope === undefined ? [] : parseScopes(body.scope);
    const scopes = requested.length > 0 ? requested : [...MCP_SCOPES];
    const name = cleanClientName(body.client_name) || DEFAULT_CLIENT_NAME;
    const now = new Date();
    const client = await this.clients.save({
      id: `${MCP_DYNAMIC_CLIENT_PREFIX}${nanoid(21)}`,
      name,
      redirectUris,
      scopes,
      isFirstParty: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return {
      client_id: client.id,
      client_name: client.name,
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: scopes.join(' '),
    };
  }
}
