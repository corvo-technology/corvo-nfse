import { Injectable } from '@nestjs/common';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import type { NfeFiscalEvent } from '../domain/nfe-event';
import type { NfeEventStatus } from '../domain/nfe-event-status';
import { NfeDocumentEventOrmEntity } from './nfe-document-event.orm-entity';

/** What an event row can change once it exists (the request itself is immutable, except on a retry). */
export interface NfeEventPatch {
  protocol?: string | null;
  procXml?: string | null;
  cStat?: string | null;
  xMotivo?: string | null;
}

function toEvent(row: NfeDocumentEventOrmEntity): NfeFiscalEvent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    documentId: row.documentId,
    tpEvento: row.tpEvento,
    nSeq: row.nSeq,
    status: row.status as NfeEventStatus,
    protocol: row.protocol,
    text: row.text,
    requestXml: row.requestXml,
    procXml: row.procXml,
    xmlPath: row.xmlPath,
    cStat: row.cStat,
    xMotivo: row.xMotivo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * `nfe_document_events` under the tenant's row security. The methods that write run on the
 * transaction of the caller (the services open it together with the document lock).
 */
@Injectable()
export class TypeormNfeEvents {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private get rows() {
    return this.db.repository(NfeDocumentEventOrmEntity);
  }

  insert(
    event: Pick<
      NfeFiscalEvent,
      | 'id'
      | 'tenantId'
      | 'documentId'
      | 'tpEvento'
      | 'nSeq'
      | 'text'
      | 'requestXml'
    >,
  ): Promise<void> {
    return runWithTenant(event.tenantId, async () => {
      requireTenantId(event.tenantId);
      await this.rows.insert({ ...event, status: 'pending' });
    });
  }

  find(id: string, tenantId: string): Promise<NfeFiscalEvent | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.rows.findOne({ where: { id, tenantId } });
      return row ? toEvent(row) : null;
    });
  }

  findBySequence(
    documentId: string,
    tenantId: string,
    tpEvento: string,
    nSeq: number,
  ): Promise<NfeFiscalEvent | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.rows.findOne({
        where: { documentId, tenantId, tpEvento, nSeq },
      });
      return row ? toEvent(row) : null;
    });
  }

  /** Oldest first: the order the customer lived them. */
  list(documentId: string, tenantId: string): Promise<NfeFiscalEvent[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const rows = await this.rows.find({
        where: { documentId, tenantId },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      return rows.map(toEvent);
    });
  }

  /** Highest `nSeqEvento` already used for the type (0 when none). Call it under the document lock. */
  maxSequence(
    documentId: string,
    tenantId: string,
    tpEvento: string,
  ): Promise<number> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const result: Array<{ max: number | null }> = await this.rows
        .createQueryBuilder('event')
        .select('MAX(event.n_seq)', 'max')
        .where(
          'event.document_id = :documentId AND event.tenant_id = :tenantId AND event.tp_evento = :tpEvento',
          { documentId, tenantId, tpEvento },
        )
        .getRawMany();
      return Number(result[0]?.max ?? 0);
    });
  }

  /**
   * Moves the event to `to` only if it is still in one of `from` (a redelivered message or a racing
   * reconciliation finds it moved and changes nothing). True when this call moved it.
   */
  settle(
    id: string,
    tenantId: string,
    from: NfeEventStatus[],
    to: NfeEventStatus,
    patch: NfeEventPatch = {},
  ): Promise<boolean> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const result = await this.rows
        .createQueryBuilder()
        .update()
        .set({ status: to, ...patch, updatedAt: () => 'now()' })
        .where('id = :id AND tenant_id = :tenantId AND status IN (:...from)', {
          id,
          tenantId,
          from,
        })
        .execute();
      return (result.affected ?? 0) > 0;
    });
  }

  /** Where the `procEventoNFe` was stored: written once, never over a path already there. */
  markStored(id: string, tenantId: string, xmlPath: string): Promise<void> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      await this.rows
        .createQueryBuilder()
        .update()
        .set({ xmlPath, updatedAt: () => 'now()' })
        .where('id = :id AND tenant_id = :tenantId AND xml_path IS NULL', {
          id,
          tenantId,
        })
        .execute();
    });
  }

  /** A new request over a rejected one of the same sequence (a cancellation asked again). */
  restart(
    id: string,
    tenantId: string,
    text: string,
    requestXml: string,
  ): Promise<void> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      await this.rows
        .createQueryBuilder()
        .update()
        .set({
          status: 'pending',
          text,
          requestXml,
          protocol: null,
          procXml: null,
          cStat: null,
          xMotivo: null,
          updatedAt: () => 'now()',
        })
        .where('id = :id AND tenant_id = :tenantId', { id, tenantId })
        .execute();
    });
  }
}
