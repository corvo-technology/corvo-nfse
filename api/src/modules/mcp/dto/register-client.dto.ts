import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Body of `POST /mcp/register` (RFC 7591 dynamic client registration). */
export class RegisterClientDto {
  /**
   * RFC 7591 §2: the server ignores metadata it does not understand. Clients
   * send extras such as `application_type`, `client_uri` or `software_id`.
   */
  static readonly allowUnknownProperties = true;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  client_name?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  redirect_uris!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  grant_types?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  response_types?: string[];

  @IsOptional()
  @IsString()
  token_endpoint_auth_method?: string;

  @IsOptional()
  @IsString()
  scope?: string;
}
