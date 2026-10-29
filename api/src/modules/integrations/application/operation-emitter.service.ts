import { Injectable } from '@nestjs/common';
import { QuotaExceededError } from '@/modules/plans/application/quota.service';
import { IdempotencyConflictError } from '@/modules/invoice/domain/errors';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import {
  CompanyBlockedError,
  CompanyNotReadyError,
} from '@/modules/company/domain/errors';
import {
  CertificateExpiredError,
  CertificateInvalidError,
  CertificateNotFoundError,
  CertificateTaxIdMismatchError,
} from '@/modules/certificate/domain/errors';
import type { CreateInvoiceDto } from '@/modules/invoice/http/invoice.dto';
import { planEmission } from '../domain/emission-planner';
import type {
  BlockReason,
  IntegrationOperation,
} from '../domain/integration-operation';
import { IIntegrationOperationRepository } from '../domain/integration-operation.repository';
import { IIntegrationRuleRepository } from '../domain/integration-rule.repository';
import { InvoiceIssuancePort } from '../domain/invoice-issuance.port';
import type { EventOutcome } from './event-handler';
import { ConnectionService } from './connection.service';

const COMMERCIAL_BLOCK: Record<string, BlockReason> = {
  refunded: 'refunded',
  disputed: 'disputed',
  pending: 'not_paid',
  canceled: 'not_paid',
};

/** Decides what an operation needs now and, when eligible, asks for the invoice. */
@Injectable()
export class OperationEmitter {
  constructor(
    private readonly connections: ConnectionService,
    private readonly operations: IIntegrationOperationRepository,
    private readonly rules: IIntegrationRuleRepository,
    private readonly issuance: InvoiceIssuancePort,
  ) {}

  /** Throws on unexpected errors so the caller retries; the frozen request makes a retry safe. */
  async run(operation: IntegrationOperation): Promise<EventOutcome> {
    const { id, tenantId } = operation;
    const connection = await this.connections.get(
      tenantId,
      operation.connectionId,
    );

    if (operation.invoiceId) {
      if (
        operation.commercialState === 'refunded' ||
        operation.commercialState === 'disputed'
      )
        await this.operations.setFiscal(
          id,
          tenantId,
          'submitted',
          'refund_after_invoice',
        );
      return { state: 'processed', operationId: id };
    }

    let frozen = operation.emissionRequest ? operation : null;
    if (!frozen) {
      const rules = await this.rules.listByConnection(
        operation.connectionId,
        tenantId,
      );
      const plan = planEmission({
        tenantId,
        provider: operation.provider,
        connection: {
          id: connection.id,
          companyId: connection.companyId,
          state: connection.state,
          activeFrom: connection.activeFrom,
          environment: connection.environment,
          externalAccountId: operation.externalAccountId,
        },
        operation: {
          snapshot: operation.snapshot,
          commercialState: operation.commercialState,
        },
        rules,
      });
      if (plan.kind === 'blocked')
        return this.stop(operation, 'blocked', plan.reason);
      if (plan.kind === 'needs_attention')
        return this.stop(operation, 'needs_attention', plan.reason);
      frozen = await this.operations.freezeEmission(id, tenantId, {
        ruleId: plan.ruleId,
        request: plan.request as unknown as Record<string, unknown>,
        requestHash: plan.requestHash,
        idempotencyKey: plan.idempotencyKey,
      });
    } else if (connection.state !== 'active') {
      return this.stop(operation, 'blocked', 'connection_inactive');
    } else if (operation.commercialState !== 'paid') {
      return this.stop(
        operation,
        'blocked',
        COMMERCIAL_BLOCK[operation.commercialState],
      );
    }

    try {
      const { invoiceId } = await this.issuance.issue({
        tenantId,
        environment: operation.environment,
        request: frozen.emissionRequest as unknown as CreateInvoiceDto,
        idempotencyKey: frozen.idempotencyKey!,
      });
      await this.operations.setFiscal(
        id,
        tenantId,
        'submitted',
        null,
        invoiceId,
      );
      return { state: 'processed', operationId: id };
    } catch (error) {
      // These fail before any invoice exists under the key, so the request can be released and re-planned.
      if (error instanceof FiscalValidationError) {
        await this.operations.unfreezeEmission(id, tenantId);
        return this.stop(
          operation,
          'needs_attention',
          'invoice_rejected',
          error.message,
        );
      }
      if (
        error instanceof CompanyNotReadyError ||
        error instanceof CompanyBlockedError ||
        error instanceof CertificateNotFoundError ||
        error instanceof CertificateInvalidError ||
        error instanceof CertificateExpiredError ||
        error instanceof CertificateTaxIdMismatchError
      ) {
        await this.operations.unfreezeEmission(id, tenantId);
        return this.stop(
          operation,
          'needs_attention',
          'company_not_ready',
          error.message,
        );
      }
      if (error instanceof IdempotencyConflictError)
        return this.stop(
          operation,
          'needs_attention',
          'invoice_rejected',
          error.message,
        );
      if (error instanceof QuotaExceededError)
        return this.stop(
          operation,
          'needs_attention',
          'quota_exceeded',
          error.message,
        );
      throw error;
    }
  }

  private async stop(
    operation: IntegrationOperation,
    status: 'blocked' | 'needs_attention',
    reason: BlockReason,
    detail?: string,
  ): Promise<EventOutcome> {
    await this.operations.setFiscal(
      operation.id,
      operation.tenantId,
      status,
      reason,
    );
    return status === 'blocked'
      ? { state: 'processed', operationId: operation.id }
      : {
          state: 'needs_attention',
          operationId: operation.id,
          lastError: detail ?? reason,
        };
  }
}
