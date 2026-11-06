import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parseCustomerTaxId } from '@/shared/tax-id';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { EventOutcome } from './event-handler';
import type { IntegrationOperation } from '../domain/integration-operation';
import { IIntegrationOperationRepository } from '../domain/integration-operation.repository';
import { OperationEmitter } from './operation-emitter.service';

@Injectable()
export class OperationService {
  constructor(
    private readonly operations: IIntegrationOperationRepository,
    private readonly emitter: OperationEmitter,
  ) {}

  list(
    tenantId: string,
    connectionId: string,
    limit: number,
  ): Promise<IntegrationOperation[]> {
    return this.operations.listByConnection(connectionId, tenantId, limit);
  }

  /** Fills in the customer of an operation that is waiting for it. */
  async completeCustomer(
    tenantId: string,
    id: string,
    input: { name?: string; taxId: string; email?: string },
    environment?: ExecutionEnvironment,
  ): Promise<IntegrationOperation> {
    const taxId = parseCustomerTaxId(input.taxId);
    if (!taxId) throw new BadRequestException('Invalid CPF or CNPJ');
    const current = (await this.get(tenantId, id, environment)).snapshot
      .customer;
    const updated = await this.operations.updateCustomer(id, tenantId, {
      name: input.name ?? current?.name ?? null,
      email: input.email ?? current?.email ?? null,
      taxId: taxId.value,
      taxIdMasked: false,
    });
    if (!updated)
      throw new ConflictException(
        'The invoice request of this operation is already fixed',
      );
    return updated;
  }

  /** Runs the operation again, reusing the stored request when there is one. */
  async retry(
    tenantId: string,
    id: string,
    environment?: ExecutionEnvironment,
  ): Promise<EventOutcome> {
    const operation = await this.get(tenantId, id, environment);
    // An invoice only reopens the sale when asking for its cancellation failed.
    if (operation.invoiceId && operation.blockReason !== 'cancel_failed')
      throw new ConflictException('This operation already has an invoice');
    return this.emitter.run(operation);
  }

  /** An API key only sees operations of its own environment (test or live). */
  private async get(
    tenantId: string,
    id: string,
    environment?: ExecutionEnvironment,
  ): Promise<IntegrationOperation> {
    const operation = await this.operations.findById(id, tenantId);
    if (!operation || (environment && operation.environment !== environment))
      throw new NotFoundException('Operation not found');
    return operation;
  }
}
