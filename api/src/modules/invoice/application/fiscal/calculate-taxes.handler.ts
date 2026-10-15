import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { CompanyService } from '@/modules/company/application/company.service';
import { CompanyFiscalProfileService } from '@/modules/company/application/company-fiscal-profile.service';
import type { FiscalCalculationResult } from '@/modules/invoice/domain/fiscal/fiscal-calculation-result';
import type { OutboxHandler } from '@/modules/invoice/domain/outbox-handler';
import type { OutboxMessage } from '@/modules/invoice/domain/outbox-message';
import {
  INVOICE_REPOSITORY,
  type IInvoiceRepository,
} from '@/modules/invoice/domain/invoice.repository';
import type { Invoice } from '@/modules/invoice/domain/invoice';
import { INVOICE_CALCULATE_TAXES } from '@/modules/invoice/domain/invoice-message-types';
import { OutboxHandlerRegistry } from '@/modules/invoice/application/outbox-handler.registry';
import { FiscalEngineService } from './fiscal-engine.service';
import { FiscalSnapshotService } from './fiscal-snapshot.service';
import { InvoiceLifecycleService } from '../invoice-lifecycle.service';
import { OutboxService } from '../outbox.service';
import { INVOICE_EMIT } from '../invoice-emit.handler';

export { INVOICE_CALCULATE_TAXES };

/**
 * Fiscal step of the outbox pipeline: runs the engine, persists the immutable
 * snapshot and only then releases `invoice.emit`, so the DPS is always built
 * from calculated taxes. Retryable integration failures are rethrown for the
 * relay's backoff (the dead-letter path stays in the relay); terminal fiscal
 * errors reject the invoice (queued → rejected) without rethrowing, completing
 * the message as handled.
 */
@Injectable()
export class CalculateTaxesHandler implements OutboxHandler, OnModuleInit {
  readonly type = INVOICE_CALCULATE_TAXES;

  constructor(
    @Inject(INVOICE_REPOSITORY) private readonly invoices: IInvoiceRepository,
    private readonly companies: CompanyService,
    private readonly profiles: CompanyFiscalProfileService,
    private readonly engine: FiscalEngineService,
    private readonly snapshots: FiscalSnapshotService,
    private readonly outbox: OutboxService,
    private readonly lifecycle: InvoiceLifecycleService,
    private readonly context: TypeOrmTransactionContext,
    @InjectDataSource() private readonly database: DataSource,
    private readonly registry: OutboxHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(message: OutboxMessage): Promise<void> {
    const invoice = await this.invoices.findByIdAndTenantId(
      message.aggregateId,
      message.tenantId,
      message.environment,
    );
    // Idempotent: a redelivery after a crash only completes what is missing.
    if (!invoice || invoice.status !== 'queued') return;
    if (await this.snapshots.findByInvoiceId(invoice.id, invoice.tenantId)) {
      await this.enqueueEmission(invoice);
      return;
    }

    const company = await this.companies.findById(
      invoice.companyId,
      invoice.tenantId,
      invoice.environment,
    );
    const outcome = await this.engine.calculate(invoice, company);
    if (outcome.ok) {
      await this.persistCalculation(invoice, outcome.value, message.attempts);
      return;
    }

    const error = outcome.error;
    if (error.retryable) throw new Error(error.code);
    invoice.setRejected(error.code, error.message);
    await this.lifecycle.transition(
      invoice,
      invoice.transitionTo('rejected', error.message),
    );
  }

  /** Snapshot insert and emission release commit together or not at all. */
  private async persistCalculation(
    invoice: Invoice,
    result: FiscalCalculationResult,
    attempt: number,
  ): Promise<void> {
    const profile = await this.profiles.findEffective(
      invoice.companyId,
      invoice.tenantId,
      invoice.toSnapshot().competenceDate.toISOString().slice(0, 10),
    );
    await this.database.transaction((manager) =>
      this.context.run(manager, async () => {
        await this.snapshots.persist({
          invoiceId: invoice.id,
          tenantId: invoice.tenantId,
          result,
          specialTaxRegime: profile?.specialTaxRegime ?? null,
          attempt,
          trace: result.trace,
        });
        await this.enqueueEmission(invoice);
      }),
    );
  }

  private async enqueueEmission(invoice: Invoice): Promise<boolean> {
    return this.outbox.enqueue({
      tenantId: invoice.tenantId,
      environment: invoice.environment,
      type: INVOICE_EMIT,
      aggregateId: invoice.id,
      payload: {
        invoiceId: invoice.id,
        companyId: invoice.companyId,
        tenantId: invoice.tenantId,
      },
      dedupeKey: `emission:${invoice.id}`,
    });
  }
}
