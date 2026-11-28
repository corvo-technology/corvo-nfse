import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { NfeIntakeService } from '@/modules/nfe/application/nfe-intake.service';
import { NfeValidateService } from '@/modules/nfe/application/nfe-validate.service';
import { INfeDocumentRepository } from '@/modules/nfe/domain/nfe-document.repository';
import { NfeRequestDto } from '@/modules/nfe/http/nfe.dto';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import { validateDto } from '@/shared/http/validate-dto';

export const SCHEDULE_NFE_PORT = 'SCHEDULE_NFE_PORT';

/** What a schedule needs from the NF-e side: check a note without issuing it, and issue it. */
export interface ScheduleNfePort {
  /** The same checks as `POST /invoices/validate` (body, company, validators, XSD). Writes nothing. */
  validate(
    tenantId: string,
    environment: ExecutionEnvironment,
    body: Record<string, unknown>,
  ): Promise<{ companyId: string }>;
  /**
   * Accepts the NF-e (queued, charged in `live`). The key makes it safe to repeat: a second call
   * with the same key answers with the note the first one created, even if the body changed.
   */
  issue(
    tenantId: string,
    environment: ExecutionEnvironment,
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ id: string }>;
}

@Injectable()
export class ScheduleNfeAdapter implements ScheduleNfePort {
  constructor(
    private readonly validation: NfeValidateService,
    private readonly intake: NfeIntakeService,
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
  ) {}

  async validate(
    tenantId: string,
    environment: ExecutionEnvironment,
    body: Record<string, unknown>,
  ): Promise<{ companyId: string }> {
    const dto = await validateDto(NfeRequestDto, body);
    await this.validation.validate(tenantId, environment, dto, false);
    return { companyId: dto.companyId };
  }

  async issue(
    tenantId: string,
    environment: ExecutionEnvironment,
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ id: string }> {
    const dto = await validateDto(NfeRequestDto, body);
    try {
      const result = await this.intake.submit(
        tenantId,
        environment,
        dto,
        idempotencyKey,
      );
      return { id: result.id };
    } catch (error) {
      // The schedule was edited after an earlier attempt of this same run created the note.
      if (!isKeyReused(error)) throw error;
      const existing = await this.documents.findByIdempotencyKey(
        idempotencyKey,
        tenantId,
        environment,
      );
      if (!existing) throw error;
      return { id: existing.id };
    }
  }
}

function isKeyReused(error: unknown): boolean {
  if (!(error instanceof ConflictException)) return false;
  const body = error.getResponse();
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { code?: unknown }).code === 'IDEMPOTENCY_KEY_REUSED'
  );
}
