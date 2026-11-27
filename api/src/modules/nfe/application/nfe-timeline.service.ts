import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { INfeDocumentRepository } from '../domain/nfe-document.repository';
import { TypeormNfeEvents } from '../infra/typeorm-nfe-events';
import type { NfeTimelineEntry } from '../http/nfe-event.dto';
import { buildNfeTimeline } from './nfe-timeline.builder';
import { nfeNotFound } from './nfe-errors';

/** `GET /v1/invoices/{id}/events`: the states the NF-e went through and its fiscal events, oldest first. */
@Injectable()
export class NfeTimelineService {
  constructor(
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
    private readonly events: TypeormNfeEvents,
  ) {}

  async timeline(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<NfeTimelineEntry[]> {
    const doc = await this.documents.findById(id, tenantId, environment);
    if (!doc) throw nfeNotFound();
    const [history, events] = await Promise.all([
      this.documents.history(id, tenantId),
      this.events.list(id, tenantId),
    ]);
    return buildNfeTimeline(history, events);
  }
}
