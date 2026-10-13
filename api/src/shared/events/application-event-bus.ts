import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface ApplicationEvent {
  name: string;
}

@Injectable()
export class ApplicationEventBus {
  private readonly logger = new Logger(ApplicationEventBus.name);

  constructor(private readonly emitter: EventEmitter2) {}

  publishBestEffort<T extends ApplicationEvent>(event: T): void {
    void this.emitter.emitAsync(event.name, event).catch((error: unknown) => {
      this.logFailure(event.name, error);
    });
  }

  async publishAndWait<T extends ApplicationEvent>(event: T): Promise<void> {
    try {
      await this.emitter.emitAsync(event.name, event);
    } catch (error) {
      this.logFailure(event.name, error);
    }
  }

  /** Use for state-converging events whose producer must fail when a handler fails. */
  async publishRequired<T extends ApplicationEvent>(event: T): Promise<void> {
    await this.emitter.emitAsync(event.name, event);
  }

  private logFailure(eventName: string, error: unknown): void {
    this.logger.warn({
      event: 'application_event_handler_failed',
      eventName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
