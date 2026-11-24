import { RawResponse } from '@/shared/http/response.interceptor';
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicRoute } from '@/modules/auth/application/public-route.decorator';
import { PublicApiEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import { HealthService } from './health.service';

@PublicRoute()
@Controller('health')
@ApiTags('Health')
@RawResponse()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @PublicApiEndpoint()
  @ApiOperation({
    summary: 'Liveness check',
    description:
      'Answers 200 while the API process is up. It needs no API key and does not look at the database.',
  })
  getLive() {
    return this.healthService.getLive();
  }

  @Get('ready')
  getReady() {
    return this.healthService.getReady();
  }
}
