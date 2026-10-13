import { ApiCursorResponse } from '@/infra/openapi/swagger';
import { CursorQuery } from '@/shared/http/pagination';
import {
  Body,
  Controller,
  Delete,
  Get,
  Query,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '@/infra/openapi/swagger';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { RequirePermission } from '../require-permission.decorator';
import { ApiKeyService } from './api-key.service';
import { data } from '@/shared/http/response';
import { CreateApiKeyDto } from '../http/create-api-key.dto';

@Controller('auth/api-keys')
@ApiTags('Auth')
@ApiBearerAuth()
@ApiErrorResponses()
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @RequirePermission('api_keys.manage')
  @Post()
  async create(
    @Req() req: RequestWithAuthContext,
    @Body() body: CreateApiKeyDto,
  ) {
    const result = await this.apiKeyService.create(req.authContext!, {
      name: body.name,
      environment: body.environment,
      scope: body.scope,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });

    const { keyHash: _, ...apiKey } = result.apiKey;
    return data({
      apiKey,
      /** Plain key returned only on creation. */
      plaintext: result.plaintext,
    });
  }

  @RequirePermission('api_keys.manage')
  @Get()
  @ApiCursorResponse()
  async list(
    @Req() req: RequestWithAuthContext,
    @Query() options: CursorQuery,
  ) {
    const keys = await this.apiKeyService.listPage(req.authContext!, options);
    // Strip key hashes from the list response.
    return keys.map(({ keyHash: _, ...rest }) => rest);
  }

  @RequirePermission('api_keys.manage')
  @Delete(':id')
  async revoke(
    @Req() req: RequestWithAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.apiKeyService.revoke(req.authContext!, id);
    return data({ revoked: true });
  }
}
