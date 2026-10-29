import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { EventProcessorService } from '../application/event-processor.service';

/** Runs only in the worker process (registered in WorkerAppModule). */
@Injectable()
export class EventProcessorScheduler {
  private readonly logger = new Logger(EventProcessorScheduler.name);
  private running = false;

  constructor(private readonly processor: EventProcessorService) {}

  @Interval(5000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.processor.runOnce();
    } catch (error) {
      this.logger.error(
        `Integration event processing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
