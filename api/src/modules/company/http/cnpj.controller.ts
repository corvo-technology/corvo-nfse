import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { data } from '@/shared/http/response';
import { isValidCnpj, normalizeCnpj } from '@/shared/fiscal/cnpj';
import { SimplesRegistryPort } from '../domain/registry-check';

/** Public registry data of a CNPJ, to pre-fill forms. The browser never talks to the registry itself. */
@ApiTags('cnpj')
@Controller('cnpj')
export class CnpjController {
  constructor(private readonly registry: SimplesRegistryPort) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':cnpj')
  @ApiKeyEndpoint()
  @RequirePermission(['nfse.companies.manage', 'nfse.invoices.issue'])
  @ApiOperation({ summary: 'Look up the registration data of a CNPJ' })
  async lookup(@Param('cnpj') raw: string) {
    const cnpj = normalizeCnpj(raw);
    if (!isValidCnpj(cnpj))
      throw new BadRequestException({
        code: 'CNPJ_INVALID',
        message: 'The CNPJ is not valid',
      });
    const result = await this.registry.lookupProfile(cnpj);
    if (result.status === 'not_found')
      throw new NotFoundException({
        code: 'CNPJ_NOT_FOUND',
        message: 'The public registry does not know this CNPJ',
      });
    if (result.status === 'unavailable')
      throw new ServiceUnavailableException({
        code: 'CNPJ_LOOKUP_UNAVAILABLE',
        message: 'The public registry has no answer right now',
      });
    return data(result.profile);
  }
}
