import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ApplicationEventBus } from './application-event-bus';

@Global()
@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [ApplicationEventBus],
  exports: [ApplicationEventBus],
})
export class ApplicationEventsModule {}
