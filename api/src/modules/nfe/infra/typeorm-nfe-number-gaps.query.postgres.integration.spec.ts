import { randomUUID } from 'node:crypto';
import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from '../testing/postgres-harness';
import { NfeNumberGapsQuery } from './typeorm-nfe-number-gaps.query';

describePostgres('NfeNumberGapsQuery on PostgreSQL', () => {
  let h: PostgresHarness;
  let query: NfeNumberGapsQuery;

  beforeAll(async () => {
    h = await createPostgresHarness('nfegaps');
    query = new NfeNumberGapsQuery(h.helper);
  }, 120000);

  afterAll(async () => {
    await h.close();
  });

  let series = 1;

  /** A document row with just what the gap query reads. */
  const document = async (
    seriesNumber: number,
    number: number,
    status: string,
    companyId = h.companyId,
    environment = 'test',
  ) => {
    await h.admin.query(
      `INSERT INTO "${h.schema}".nfe_documents
         (id, tenant_id, company_id, environment, model, series, number, status, nat_op, id_dest, ind_final, ind_pres, recipient, totals, payment, transport, attempt, idempotency_key, request_hash)
       VALUES ($1,$2,$3,$4,55,$5,$6,$7,'Venda',1,1,1,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,1,gen_random_uuid()::text,'h')`,
      [
        randomUUID(),
        h.tenantId,
        companyId,
        environment,
        seriesNumber,
        number,
        status,
      ],
    );
  };
  const inutilization = async (
    seriesNumber: number,
    start: number,
    end: number,
    status: string,
  ) => {
    await h.admin.query(
      `INSERT INTO "${h.schema}".nfe_inutilizations
         (id, tenant_id, company_id, environment, model, series, start_number, end_number, justification, status)
       VALUES ($1,$2,$3,'test',55,$4,$5,$6,'Numeração pulada por falha',$7)`,
      [randomUUID(), h.tenantId, h.companyId, seriesNumber, start, end, status],
    );
  };
  const sequence = async (
    seriesNumber: number,
    current: number,
    companyId = h.companyId,
  ) => {
    await h.admin.query(
      `INSERT INTO "${h.schema}".nfe_number_sequences (tenant_id, company_id, model, series, current_number) VALUES ($1,$2,55,$3,$4)`,
      [h.tenantId, companyId, seriesNumber, current],
    );
  };

  it('1 authorized, 2 discarded, 3 authorized, 4-5 discarded, 6-7 inutilized: the gaps are 2 and 4-5', async () => {
    const n = series++;
    await document(n, 1, 'authorized');
    await document(n, 2, 'discarded');
    await document(n, 3, 'authorized');
    await document(n, 4, 'discarded');
    await document(n, 5, 'discarded');
    await inutilization(n, 6, 7, 'homologada');
    await sequence(n, 7);
    expect(
      (await query.list(h.tenantId, 'test', h.companyId)).filter(
        (g) => g.series === n,
      ),
    ).toEqual([
      { companyId: h.companyId, series: n, start: 2, end: 2 },
      { companyId: h.companyId, series: n, start: 4, end: 5 },
    ]);
  });

  it('a pending or rejected inutilization does not close a gap', async () => {
    const n = series++;
    await document(n, 1, 'authorized');
    await inutilization(n, 2, 3, 'pending');
    await inutilization(n, 4, 4, 'rejected');
    await sequence(n, 4);
    expect(
      (await query.list(h.tenantId, 'test')).filter((g) => g.series === n),
    ).toEqual([{ companyId: h.companyId, series: n, start: 2, end: 4 }]);
  });

  it('a series without any document is one gap up to the current number; no gap when it is full', async () => {
    const empty = series++;
    await sequence(empty, 3);
    const full = series++;
    await document(full, 1, 'authorized');
    await document(full, 2, 'rejected');
    await sequence(full, 2);
    const found = await query.list(h.tenantId, 'test');
    expect(found.filter((g) => g.series === empty)).toEqual([
      { companyId: h.companyId, series: empty, start: 1, end: 3 },
    ]);
    expect(found.filter((g) => g.series === full)).toEqual([]);
  });

  it('a wide inutilized range raised to the millions costs the same as a short one', async () => {
    const n = series++;
    await document(n, 1, 'authorized');
    await inutilization(n, 2, 900_000_000, 'homologada');
    await sequence(n, 900_000_000);
    expect(
      (await query.list(h.tenantId, 'test')).filter((g) => g.series === n),
    ).toEqual([]);
  });

  it('only the environment and the company asked for', async () => {
    const n = series++;
    await sequence(n, 2);
    await sequence(n, 2, h.liveCompanyId);
    const test = await query.list(h.tenantId, 'test');
    expect(test.filter((g) => g.series === n).map((g) => g.companyId)).toEqual([
      h.companyId,
    ]);
    const live = await query.list(h.tenantId, 'live', h.liveCompanyId);
    expect(live).toEqual([
      { companyId: h.liveCompanyId, series: n, start: 1, end: 2 },
    ]);
    expect(await query.list(h.tenantId, 'test', randomUUID())).toEqual([]);
  });
});
