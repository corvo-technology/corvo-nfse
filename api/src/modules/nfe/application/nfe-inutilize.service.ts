import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { dhEmiFor } from '@/infra/external/nfe/sefaz/uf';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { UnitOfWorkPort } from '@/infra/transactions/unit-of-work.port';
import { OutboxService } from '@/modules/invoice/application/outbox.service';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { buildInutilization } from '../domain/builder/inut-nfe.builder';
import type { NfeInutilization } from '../domain/nfe-event';
import { TypeormNfeInutilizations } from '../infra/typeorm-nfe-inutilizations';
import { TypeormNfeNumbering } from '../infra/typeorm-nfe-numbering';
import { checkedJustification } from './nfe-cancel.service';
import {
  nfeIdempotencyKeyInvalid,
  nfeIdempotencyKeyReused,
  nfeInutilizationRangeInUse,
  nfeInutilizationRangeInvalid,
  nfeInutilizationRangeOverlap,
} from './nfe-errors';
import { NfeEventContext } from './nfe-event-context';
import { inutilizeMessage } from './nfe-messages';
import { isValidIdempotencyKey, nfeRequestHash } from './nfe-request-hash';
import { NfeSefazAccess } from './nfe-sefaz-access';

export interface InutilizationInput {
  companyId: string;
  series: number;
  start: number;
  end: number;
  justification: string;
}

export interface InutilizationSubmitted {
  inutilization: NfeInutilization;
  replayed: boolean;
}

const LAST_NUMBER = 999_999_999;

/** Postgres `unique_violation`. */
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === '23505';

/**
 * `POST /v1/invoices/inutilizations`. One transaction: the number sequence of the (company, series) is
 * locked, and raised to the end of the range when the range goes beyond the current number (so
 * the numbers voided can never be emitted afterwards); then the range is refused when an NF-e that
 * is not `discarded` holds a number in it, or when another request (waiting or approved) overlaps
 * it; the signed request is stored as `pending` and `nfe.inutilize` is queued. The send and the
 * SEFAZ answer belong to the handler.
 */
@Injectable()
export class NfeInutilizeService {
  constructor(
    private readonly context: NfeEventContext,
    private readonly access: NfeSefazAccess,
    private readonly inutilizations: TypeormNfeInutilizations,
    private readonly numbering: TypeormNfeNumbering,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly outbox: OutboxService,
  ) {}

  async create(
    tenantId: string,
    environment: ExecutionEnvironment,
    input: InutilizationInput,
    idempotencyKey?: string,
  ): Promise<InutilizationSubmitted> {
    if (idempotencyKey !== undefined && !isValidIdempotencyKey(idempotencyKey))
      throw nfeIdempotencyKeyInvalid();
    const justification = checkedJustification(input.justification);
    if (
      ![input.series, input.start, input.end].every(Number.isInteger) ||
      input.series < 0 ||
      input.series > 999 ||
      input.start < 1 ||
      input.end > LAST_NUMBER ||
      input.start > input.end
    )
      throw nfeInutilizationRangeInvalid();
    this.context.assertEnvironment(environment);

    const requestHash = nfeRequestHash({ ...input, justification });
    if (idempotencyKey) {
      const existing = await this.inutilizations.findByIdempotencyKey(
        idempotencyKey,
        tenantId,
        environment,
      );
      if (existing) return this.replay(existing, requestHash);
    }

    const issuer = await this.context.issuer(
      input.companyId,
      tenantId,
      environment,
    );
    const certificate = await this.context.certificateForRequest(
      input.companyId,
      tenantId,
      environment,
    );
    const now = new Date();
    const built = buildInutilization({
      cUF: issuer.cUF,
      tpAmb: this.access.tpAmb(environment),
      // The year of the issuer's civil time, two digits.
      ano: dhEmiFor(issuer.uf, now).slice(2, 4),
      cnpj: issuer.cnpj,
      model: 55,
      series: input.series,
      start: input.start,
      end: input.end,
      justification,
    });
    const requestXml = this.access.sign(
      built.xml,
      certificate,
      environment,
      built.referenceTag,
    );

    const id = randomUUID();
    const scope = {
      tenantId,
      companyId: input.companyId,
      environment,
      model: 55 as const,
      series: input.series,
    };
    try {
      await runWithTenant(tenantId, () =>
        this.unitOfWork.execute(async () => {
          // Takes the lock of the sequence: no emission can number in the range while it is checked.
          await this.numbering.raiseTo(scope, input.end);
          if (
            await this.inutilizations.overlapping(
              tenantId,
              input.companyId,
              input.series,
              input.start,
              input.end,
            )
          )
            throw nfeInutilizationRangeOverlap();
          if (
            (await this.inutilizations.documentsInRange(
              tenantId,
              input.companyId,
              input.series,
              input.start,
              input.end,
            )) > 0
          )
            throw nfeInutilizationRangeInUse();
          await this.inutilizations.insert({
            id,
            tenantId,
            companyId: input.companyId,
            environment,
            series: input.series,
            start: input.start,
            end: input.end,
            justification,
            requestXml,
            idempotencyKey: idempotencyKey ?? null,
            requestHash,
          });
          await this.outbox.enqueue(
            inutilizeMessage({
              id,
              tenantId,
              companyId: input.companyId,
              environment,
            }),
          );
        }),
      );
    } catch (error) {
      // Two requests with the same key raced: the loser answers with the winner's row.
      if (idempotencyKey && isUniqueViolation(error)) {
        const existing = await this.inutilizations.findByIdempotencyKey(
          idempotencyKey,
          tenantId,
          environment,
        );
        if (existing) return this.replay(existing, requestHash);
      }
      throw error;
    }
    const created = await this.inutilizations.find(id, tenantId);
    if (!created) throw new Error('Inutilization was not saved');
    return { inutilization: created, replayed: false };
  }

  private replay(
    existing: NfeInutilization,
    requestHash: string,
  ): InutilizationSubmitted {
    if (existing.requestHash !== requestHash) throw nfeIdempotencyKeyReused();
    return { inutilization: existing, replayed: true };
  }
}
