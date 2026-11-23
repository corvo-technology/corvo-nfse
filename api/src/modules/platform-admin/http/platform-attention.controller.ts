import { Controller, Get } from '@nestjs/common';
import { PlatformAttentionReadRepository } from '../infra/read/platform-attention.read-repository';
import type { PlatformAttention } from '../platform-admin.contract';
import { PlatformAdminRoute } from '../platform-admin.guard';

@PlatformAdminRoute()
@Controller('platform')
export class PlatformAttentionController {
  constructor(private readonly attention: PlatformAttentionReadRepository) {}

  @Get('attention')
  async get(): Promise<{ data: PlatformAttention }> {
    return { data: await this.attention.snapshot(new Date()) };
  }
}
