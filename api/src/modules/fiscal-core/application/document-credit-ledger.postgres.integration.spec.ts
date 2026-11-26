import { TypeOrmBillingRepository } from '@/modules/billing/infra/typeorm-billing.repository';
import { BillingUsageService } from '@/modules/billing/application/billing-usage.service';
import { TypeOrmCreditTransactionRepository } from '@/modules/credits/infra/typeorm-credit-transaction.repository';
import { Invoice } from '@/modules/invoice/domain/invoice';
import { TypeOrmInvoiceRepository } from '@/modules/invoice/infra/typeorm-invoice.repository';
import { NfeDocument } from '@/modules/nfe/domain/nfe-document';
import { TypeOrmNfeDocumentRepository } from '@/modules/nfe/infra/typeorm-nfe-document.repository';
import { documentParams } from '@/modules/nfe/testing/document-fixture';
import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from '@/modules/nfe/testing/postgres-harness';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { DocumentCreditLedger } from './document-credit-ledger';

describePostgres('DocumentCreditLedger on PostgreSQL', () => {
  let h: PostgresHarness;
  let ledger: DocumentCreditLedger;
  let billing: TypeOrmBillingRepository;
  let nfes: TypeOrmNfeDocumentRepository;
  let invoices: TypeOrmInvoiceRepository;
  let price = 1;

  beforeAll(async () => {
    h = await createPostgresHarness('ledger');
    billing = new TypeOrmBillingRepository(h.runtime, h.transactions);
    ledger = new DocumentCreditLedger(
      new BillingUsageService(billing),
      new TypeOrmCreditTransactionRepository(h.helper),
      { priceOf: () => Promise.resolve(price) },
    );
    nfes = new TypeOrmNfeDocumentRepository(h.helper);
    invoices = new TypeOrmInvoiceRepository(h.helper);
  }, 120000);

  afterAll(async () => {
    await h.close();
  });

  const newNfe = async () => {
    const doc = NfeDocument.create(
      documentParams({
        tenantId: h.tenantId,
        companyId: h.liveCompanyId,
        environment: 'live',
      }),
    );
    await nfes.insert(doc);
    return {
      type: 'nfe' as const,
      id: doc.id,
      tenantId: h.tenantId,
      environment: 'live' as const,
    };
  };

  /** Same wrapper the services use: transaction + tenant lock. */
  const inTransaction = <T>(work: () => Promise<T>) =>
    runWithTenant(h.tenantId, () =>
      h.unitOfWork.execute(() => billing.locked(h.tenantId, work)),
    );

  const rows = (id: string) =>
    h.admin.query<
      Array<{
        amount: number;
        type: string;
        is_reservation: boolean;
        reserved_document_type: string;
      }>
    >(
      `SELECT amount, type, is_reservation, reserved_document_type FROM "${h.schema}".credit_transactions
        WHERE reserved_nfe_document_id = $1 OR related_transaction_id IN (SELECT id FROM "${h.schema}".credit_transactions WHERE reserved_nfe_document_id = $1)
        ORDER BY created_at`,
      [id],
    );

  it('reserves, then authorizing confirms and keeps the debit', async () => {
    const ref = await newNfe();
    await inTransaction(() => ledger.reserve(ref));
    expect(await rows(ref.id)).toEqual([
      {
        amount: -1,
        type: 'invoice_authorized',
        is_reservation: true,
        reserved_document_type: 'nfe',
      },
    ]);
    await inTransaction(() => ledger.settle(ref, 'processing', 'authorized'));
    expect((await rows(ref.id)).map((r) => r.is_reservation)).toEqual([false]);
    await inTransaction(() => ledger.settle(ref, 'authorized', 'cancelling'));
    await inTransaction(() => ledger.settle(ref, 'cancelling', 'cancelled'));
    expect(await rows(ref.id)).toHaveLength(1);
  });

  it('denied gives the credit back; discarding it afterwards does not refund twice', async () => {
    const ref = await newNfe();
    await inTransaction(() => ledger.reserve(ref));
    await inTransaction(() => ledger.settle(ref, 'processing', 'rejected'));
    await inTransaction(() => ledger.settle(ref, 'rejected', 'discarded'));
    const found = await rows(ref.id);
    expect(found.map((r) => r.amount)).toEqual([-1, 1]);
  });

  it('a rejected NF-e that is resubmitted reserves again', async () => {
    const ref = await newNfe();
    await inTransaction(() => ledger.reserve(ref));
    await inTransaction(() => ledger.settle(ref, 'processing', 'rejected'));
    await inTransaction(() => ledger.reserve(ref));
    await inTransaction(() => ledger.settle(ref, 'processing', 'authorized'));
    expect((await rows(ref.id)).map((r) => r.amount)).toEqual([-1, 1, -1]);
  });

  it('refunds what was reserved when the price changed afterwards', async () => {
    const ref = await newNfe();
    price = 1;
    await inTransaction(() => ledger.reserve(ref));
    price = 3;
    await inTransaction(() => ledger.settle(ref, 'processing', 'denied'));
    price = 1;
    expect((await rows(ref.id)).map((r) => r.amount)).toEqual([-1, 1]);
  });

  it('daily usage counts one NFS-e and one NF-e reserved', async () => {
    const today = await runWithTenant(h.tenantId, () =>
      billing.dailyUsage(h.tenantId),
    );
    const ref = await newNfe();
    const invoice = Invoice.create(
      {
        companyId: h.liveCompanyId,
        environment: 'live',
        customer: { taxId: '52998224725', name: 'Cliente' },
        service: {
          description: 'Servico',
          code: '060101',
          municipalityCode: '3550308',
        },
        amount: 50,
        competenceDate: new Date('2026-10-13'),
      },
      h.tenantId,
    );
    await runWithTenant(h.tenantId, () => invoices.insert(invoice, h.tenantId));
    await inTransaction(() => ledger.reserve(ref));
    await inTransaction(() =>
      ledger.reserve({
        type: 'nfse',
        id: invoice.id,
        tenantId: h.tenantId,
        environment: 'live',
      }),
    );
    expect(
      await runWithTenant(h.tenantId, () => billing.dailyUsage(h.tenantId)),
    ).toBe(today + 2);
  });
});
