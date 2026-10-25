import { Global, Module } from '@nestjs/common';
import { RolloutFlagsService } from './rollout-flags.service';

@Global()
@Module({
  providers: [RolloutFlagsService],
  exports: [RolloutFlagsService],
})
export class RolloutModule {}
