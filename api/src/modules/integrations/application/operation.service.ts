import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountAuditRecorder } from '@/modules/account-audit/domain/account-audit';
import { parseCustomerTaxId } from '@/shared/tax-id';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { EventOutcome } from './event-handler';
import type { CustomerAddress } from '../domain/connector';
import type { IntegrationOperation } from '../domain/integration-operation';
import { IIntegrationEventRepository } from '../domain/integration-event.repository';
import { IIntegrationOperationRepository } from '../domain/integration-operation.repository';
import { selectRule } from '../domain/integration-rule';
import { IIntegrationRuleRepository } from '../domain/integration-rule.repository';
import { OperationEmitter } from './operation-emitter.service';

export interface ResolveInput {
  customer?: {
    name?: string;
    taxId: string;
    email?: string;
    address?: CustomerAddress;
  };
  service?: { code?: string; description?: string };
  sendEmail?: boolean;
}

@Injectable()
export class OperationService {
  constructor(
    private readonly operations: IIntegrationOperationRepository,
    private readonly emitter: OperationEmitter,
    private readonly events: IIntegrationEventRepository,
    private readonly rules: IIntegrationRuleRepository,
    private readonly audit: AccountAuditRecorder,
  ) {}

  /** Sales of the workspace that wait for the client, newest first. */
  listNeedingAttention(
    tenantId: string,
    environment: ExecutionEnvironment,
    limit: number,
  ): Promise<IntegrationOperation[]> {
    return this.operations.listNeedingAttention(tenantId, environment, limit);
  }

  /** One sale with the service the connection's rule would put on its invoice. */
  async detail(
    tenantId: string,
    id: string,
    environment?: ExecutionEnvironment,
  ): Promise<{
    operation: IntegrationOperation;
    service: { code: string | null; description: string | null };
    /** What the last attempt said, for a sale that was refused when issuing. */
    lastError: string | null;
    /** Whether the invoice would be e-mailed to the customer (the client's choice for this sale, else the rule's). */
    sendEmail: boolean;
  }> {
    const operation = await this.get(tenantId, id, environment);
    const rules = await this.rules.listByConnection(
      operation.connectionId,
      tenantId,
    );
    const selection = selectRule(rules, operation.snapshot.items);
    const rule = 'rule' in selection ? selection.rule : null;
    const override = operation.snapshot.serviceOverride;
    const recent = await this.events.listByConnection(
      operation.connectionId,
      tenantId,
      50,
    );
    const lastError =
      recent.find((e) => e.operationId === id && e.lastError)?.lastError ??
      null;
    const text = (value: unknown) =>
      typeof value === 'string' && value ? value : null;
    return {
      operation,
      lastError,
      sendEmail:
        operation.snapshot.sendEmailOverride ?? rule?.sendEmail ?? false,
      service: {
        code: override?.code ?? text(rule?.service.code),
        description:
          override?.description ??
          text(rule?.service.description) ??
          operation.snapshot.description ??
          null,
      },
    };
  }

  /**
   * Completes the data of a sale that is waiting and asks for its invoice. The invoice key
   * comes from the sale itself, so pressing the button twice never issues twice.
   */
  async resolve(
    tenantId: string,
    id: string,
    input: ResolveInput,
    environment?: ExecutionEnvironment,
  ): Promise<{ outcome: EventOutcome; operation: IntegrationOperation }> {
    const current = await this.get(tenantId, id, environment);
    if (current.invoiceId)
      throw new ConflictException({
        code: 'OPERATION_HAS_INVOICE',
        message: 'This operation already has an invoice',
      });
    if (
      current.blockReason === 'ignored_by_user' ||
      current.commercialState !== 'paid' ||
      !['needs_attention', 'none'].includes(current.fiscalStatus)
    )
      throw new ConflictException({
        code: 'OPERATION_NOT_RESOLVABLE',
        message: 'This operation is not waiting for data',
      });

    const resolution = this.toResolution(current, input);
    if (
      resolution.customer ||
      resolution.service ||
      resolution.sendEmail !== undefined
    ) {
      const updated = await this.operations.applyResolution(
        id,
        tenantId,
        resolution,
      );
      if (!updated)
        throw new ConflictException({
          code: 'OPERATION_REQUEST_FIXED',
          message: 'The invoice request of this operation is already fixed',
        });
    }
    const outcome = await this.emitter.run(await this.get(tenantId, id));
    const operation = await this.get(tenantId, id);
    await this.audit.record({
      tenantId,
      environment: operation.environment,
      action: 'integration.sale_resolved',
      target: { type: 'integration_sale', id, label: operation.provider },
      metadata: {
        provider: operation.provider,
        outcome: outcome.state,
        changed_customer: Boolean(resolution.customer),
        changed_service: Boolean(resolution.service),
      },
    });
    return { outcome, operation };
  }

  /** The client says this sale needs no invoice. It stays on record, but nothing is issued. */
  async ignore(
    tenantId: string,
    id: string,
    reason: string,
    environment?: ExecutionEnvironment,
  ): Promise<IntegrationOperation> {
    const current = await this.get(tenantId, id, environment);
    if (current.invoiceId)
      throw new ConflictException({
        code: 'OPERATION_HAS_INVOICE',
        message: 'This operation already has an invoice',
      });
    await this.operations.setFiscal(id, tenantId, 'blocked', 'ignored_by_user');
    await this.events.resolveAttention(id, tenantId);
    await this.audit.record({
      tenantId,
      environment: current.environment,
      action: 'integration.sale_ignored',
      target: { type: 'integration_sale', id, label: current.provider },
      metadata: { provider: current.provider, reason: reason.slice(0, 200) },
    });
    return this.get(tenantId, id);
  }

  private toResolution(
    current: IntegrationOperation,
    input: ResolveInput,
  ): Parameters<IIntegrationOperationRepository['applyResolution']>[2] {
    const resolution: Parameters<
      IIntegrationOperationRepository['applyResolution']
    >[2] = {};
    const customer = input.customer;
    if (customer) {
      const taxId = parseCustomerTaxId(customer.taxId);
      if (!taxId)
        throw new BadRequestException({
          code: 'INVALID_TAX_ID',
          message: 'Invalid CPF or CNPJ',
        });
      const { city, state } = customer.address ?? {};
      if (Boolean(city?.trim()) !== Boolean(state?.trim()))
        throw new BadRequestException({
          code: 'INVALID_ADDRESS',
          message: 'Send both city and state of the address, or neither',
        });
      const before = current.snapshot.customer;
      resolution.customer = {
        name: customer.name?.trim() || before?.name || null,
        email: customer.email?.trim() || before?.email || null,
        taxId: taxId.value,
        taxIdMasked: false,
        ...(customer.address ? { address: customer.address } : {}),
      };
    }
    const service = {
      ...(input.service?.code ? { code: input.service.code } : {}),
      ...(input.service?.description?.trim()
        ? { description: input.service.description.trim() }
        : {}),
    };
    if (Object.keys(service).length > 0) resolution.service = service;
    if (input.sendEmail !== undefined) resolution.sendEmail = input.sendEmail;
    return resolution;
  }

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
    if (!taxId)
      throw new BadRequestException({
        code: 'INVALID_TAX_ID',
        message: 'Invalid CPF or CNPJ',
      });
    const current = (await this.get(tenantId, id, environment)).snapshot
      .customer;
    const updated = await this.operations.updateCustomer(id, tenantId, {
      name: input.name ?? current?.name ?? null,
      email: input.email ?? current?.email ?? null,
      taxId: taxId.value,
      taxIdMasked: false,
    });
    if (!updated)
      throw new ConflictException({
        code: 'OPERATION_REQUEST_FIXED',
        message: 'The invoice request of this operation is already fixed',
      });
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
      throw new ConflictException({
        code: 'OPERATION_HAS_INVOICE',
        message: 'This operation already has an invoice',
      });
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
      throw new NotFoundException({
        code: 'OPERATION_NOT_FOUND',
        message: 'Operation not found',
      });
    return operation;
  }
}
