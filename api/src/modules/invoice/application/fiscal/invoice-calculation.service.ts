import { recordCalculate } from './fiscal.metrics';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { CreateInvoiceDto } from '../../http/invoice.dto';
import type { FiscalError } from '../../domain/fiscal/fiscal-error';
import { InvoiceIntakeService } from '../invoice-intake.service';
import {
  FiscalEngineService,
  toNormalizedInvoice,
} from './fiscal-engine.service';
import {
  toCalculationResponse,
  type InvoiceCalculationResponse,
} from './calculation-response';

@Injectable()
export class InvoiceCalculationService {
  constructor(
    private readonly intake: InvoiceIntakeService,
    private readonly engine: FiscalEngineService,
  ) {}

  async calculate(
    dto: CreateInvoiceDto,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<
    { response: InvoiceCalculationResponse } | { httpError: FiscalError }
  > {
    const startedAt = performance.now();
    let status: 'ready' | 'blocked' | 'error' = 'error';
    try {
      const prepared = await this.intake.prepare(dto, tenantId, environment, {
        allowFutureCompetence: true,
      });
      const normalized = toNormalizedInvoice(
        prepared.normalized,
        prepared.company,
        tenantId,
        environment,
        randomUUID(),
      );
      const partial = await this.engine.calculatePartial(normalized);
      if (
        partial.error?.category === 'INTEGRATION' ||
        partial.error?.category === 'INTERNAL'
      )
        return { httpError: partial.error };
      const calculated = toCalculationResponse(partial);
      status = calculated.status;
      // Non blocking findings of the intake (for example a stale Simples rate).
      const response =
        prepared.warnings.length === 0
          ? calculated
          : {
              ...calculated,
              warnings: [
                ...calculated.warnings,
                ...prepared.warnings.map(({ code, message }) => ({
                  code,
                  message,
                  step: 'Intake',
                })),
              ],
            };
      return { response };
    } finally {
      recordCalculate(status, performance.now() - startedAt);
    }
  }
}
