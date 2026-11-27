import { randomUUID } from 'node:crypto';
import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from '@/modules/nfe/testing/postgres-harness';
import { TypeormInvoiceSummaries } from './typeorm-invoice-summaries';

describePostgres('TypeormInvoiceSummaries on PostgreSQL', () => {
  let h: PostgresHarness;
  let summaries: TypeormInvoiceSummaries;

  beforeAll(async () => {
    h = await createPostgresHarness('invsum');
    summaries = new TypeormInvoiceSummaries(h.helper);
  }, 120000);

  afterAll(async () => {
    await h.close();
  });

  const document = async (model: 55 | 65, number: number): Promise<string> => {
    const id = randomUUID();
    await h.admin.query(
      `INSERT INTO "${h.schema}".nfe_documents
         (id, tenant_id, company_id, environment, model, series, number, status, nat_op, id_dest, ind_final, ind_pres, recipient, totals, payment, transport, attempt, idempotency_key, request_hash)
       VALUES ($1,$2,$3,'test',$4,1,$5,'queued','Venda',1,1,1,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,1,gen_random_uuid()::text,'h')`,
      [id, h.tenantId, h.companyId, model, number],
    );
    return id;
  };

  it('shows model 55 as nfe and model 65 as nfce, and each type filters its own model', async () => {
    const nfe = await document(55, 1);
    const nfce = await document(65, 1);

    const both = await summaries.list(
      { types: ['nfe', 'nfce'], limit: 100 },
      h.tenantId,
      'test',
    );
    expect(
      Object.fromEntries(both.data.map((row) => [row.id, row.type])),
    ).toEqual({ [nfe]: 'nfe', [nfce]: 'nfce' });

    const onlyNfe = await summaries.list(
      { types: ['nfe'], limit: 100 },
      h.tenantId,
      'test',
    );
    expect(onlyNfe.data.map((row) => row.id)).toEqual([nfe]);

    const onlyNfce = await summaries.list(
      { types: ['nfce'], limit: 100 },
      h.tenantId,
      'test',
    );
    expect(onlyNfce.data.map((row) => row.id)).toEqual([nfce]);
  });
});
