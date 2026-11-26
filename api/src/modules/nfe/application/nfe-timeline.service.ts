import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { INfeDocumentRepository } from '../domain/nfe-document.repository';
import { TypeormNfeEvents } from '../infra/typeorm-nfe-events';
import type { NfeTimelineEntry } from '../http/nfe-event.dto';
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
    const entries: NfeTimelineEntry[] = [
      ...history.map((row): NfeTimelineEntry => ({
        kind: 'status',
        at: row.createdAt,
        status: row.toStatus,
        from: row.fromStatus,
        tpEvento: null,
        sequence: null,
        eventId: null,
        cStat: row.cStat,
        xMotivo: row.xMotivo,
      })),
      ...events.map((event): NfeTimelineEntry => ({
        kind: 'event',
        at: event.createdAt,
        status: event.status,
        from: null,
        tpEvento: event.tpEvento,
        sequence: event.nSeq,
        eventId: event.id,
        cStat: event.cStat,
        xMotivo: event.xMotivo,
      })),
    ];
    // Same instant: the status row first (the NF-e moved, then the event is shown under it).
    return entries.sort(
      (a, b) =>
        a.at.getTime() - b.at.getTime() ||
        (a.kind === b.kind ? 0 : a.kind === 'status' ? -1 : 1),
    );
  }
}
