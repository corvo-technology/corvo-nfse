import { IsEnum, IsOptional, IsString } from 'class-validator';

/**
 * Body for `POST /mcp/token` (OAuth 2.0 token endpoint).
 *
 * Accepts both `application/json` and `application/x-www-form-urlencoded`
 * bodies — the HTTP layer parses both into a plain object before validation.
 */
export class TokenRequestDto {
  @IsEnum(['authorization_code', 'refresh_token'])
  grant_type!: 'authorization_code' | 'refresh_token';

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  code_verifier?: string;

  @IsOptional()
  @IsString()
  refresh_token?: string;

  @IsOptional()
  @IsString()
  redirect_uri?: string;

  /**
   * Optional per RFC 6749 (public clients commonly send it). Defaults to
   * 'corvo-mcp' when absent — we only ever issue tokens for that client.
   */
  @IsOptional()
  @IsString()
  client_id?: string;
}
