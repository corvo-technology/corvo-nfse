import { IsIn, IsString, IsUrl } from 'class-validator';

/**
 * Query parameters for `GET /mcp/authorize` (OAuth 2.0 authorization code
 * flow with PKCE, RFC 7636).
 */
export class AuthorizeQueryDto {
  @IsString()
  @IsIn(['corvo-mcp'])
  client_id!: string;

  @IsUrl({ require_tld: false })
  redirect_uri!: string;

  @IsString()
  @IsIn(['code'])
  response_type!: string;

  @IsString()
  scope!: string; // 'nfse:read nfse:write' or subset

  @IsString()
  code_challenge!: string;

  @IsString()
  @IsIn(['S256'])
  code_challenge_method!: string;

  @IsString()
  state!: string;
}
