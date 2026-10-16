import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { MCP_CLIENT_ID_PATTERN } from '../mcp-client-policy';

/**
 * Query parameters for `GET /mcp/authorize` (OAuth 2.0 authorization code
 * flow with PKCE, RFC 7636).
 */
export class AuthorizeQueryDto {
  @IsString()
  @Matches(MCP_CLIENT_ID_PATTERN)
  client_id!: string;

  @IsString()
  @MaxLength(500)
  redirect_uri!: string;

  @IsString()
  @IsIn(['code'])
  response_type!: string;

  @IsOptional()
  @IsString()
  scope?: string; // 'nfse:read nfse:write' or subset; defaults to both

  @IsString()
  code_challenge!: string;

  @IsString()
  @IsIn(['S256'])
  code_challenge_method!: string;

  @IsString()
  state!: string;
}
