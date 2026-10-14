import { Injectable } from '@nestjs/common';
import type { OutboxHandler } from '../domain/outbox-handler';

@Injectable()
export class OutboxHandlerRegistry {
  private readonly handlers = new Map<string, OutboxHandler>();

  register(handler: OutboxHandler): void {
    if (this.handlers.has(handler.type))
      throw new Error(`Outbox handler already registered for ${handler.type}`);
    this.handlers.set(handler.type, handler);
  }

  get(type: string): OutboxHandler | undefined {
    return this.handlers.get(type);
  }
}
