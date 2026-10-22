import { RawResponse } from '@/shared/http/response.interceptor';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PublicRoute } from '@/modules/auth/application/public-route.decorator';
import { HealthService } from './health.service';

@PublicRoute()
@Controller('health')
@ApiTags('Health')
@RawResponse()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth() {
    return this.healthService.getLive();
  }
}
