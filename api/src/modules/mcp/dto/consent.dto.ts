import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { MCP_CLIENT_ID_PATTERN } from '../mcp-client-policy';

/** Authorization request parameters, forwarded by the dashboard consent screen. */
export class ConsentRequestDto {
  @IsString()
  @Matches(MCP_CLIENT_ID_PATTERN)
  client_id!: string;

  @IsString()
  @MaxLength(500)
  redirect_uri!: string;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsString()
  @MaxLength(500)
  state!: string;

  @IsString()
  @MaxLength(200)
  code_challenge!: string;

  @IsString()
  @IsIn(['S256'])
  code_challenge_method!: string;
}

export class ConsentDecisionDto extends ConsentRequestDto {
  @IsIn(['allow', 'deny'])
  decision!: 'allow' | 'deny';

  @IsOptional()
  @IsUUID()
  tenant_id?: string;

  @IsOptional()
  @IsIn(['test', 'live'])
  environment?: 'test' | 'live';
}
