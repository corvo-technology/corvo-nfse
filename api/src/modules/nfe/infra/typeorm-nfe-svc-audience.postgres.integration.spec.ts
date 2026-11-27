import { randomUUID } from 'node:crypto';
import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from '../testing/postgres-harness';
import { TypeormNfeSvcAudience } from './typeorm-nfe-svc-audience';

describePostgres('NfeSvcAudience on PostgreSQL', () => {
  let h: PostgresHarness;
  let audience: TypeormNfeSvcAudience;
  let other: string;

  beforeAll(async () => {
    h = await createPostgresHarness('nfesvcaud');
    audience = new TypeormNfeSvcAudience(h.runtime);
    other = randomUUID();
    await h.admin.query(`INSERT INTO "${h.schema}".tenants (id) VALUES ($1)`, [
      other,
    ]);
    await h.admin.query(
      `INSERT INTO "${h.schema}".nfse_companies (id,tenant_id,legal_name,tax_id,environment,address_state) VALUES ($1,$2,'Outra','22334455000186','test','MG')`,
      [randomUUID(), other],
    );
  }, 120000);

  afterAll(async () => {
    await h.close();
  });

  const setState = (companyId: string, state: string) =>
    h.admin.query(
      `UPDATE "${h.schema}".nfse_companies SET address_state = $2 WHERE id = $1`,
      [companyId, state],
    );
  const release = (tenantId: string, on: boolean) =>
    h.admin.query(
      `UPDATE "${h.schema}".tenants SET nfe_enabled_at = ${on ? 'now()' : 'NULL'} WHERE id = $1`,
      [tenantId],
    );

  it('lists only tenants with NF-e released and a company in the UF and environment', async () => {
    await setState(h.companyId, 'SP');
    await setState(h.liveCompanyId, 'SP');
    // Not released yet: nobody hears about it.
    expect(await audience.tenants('SP', 2)).toEqual([]);

    await release(h.tenantId, true);
    expect(await audience.tenants('SP', 2)).toEqual([h.tenantId]);
    // The same tenant has a live company in SP too: once, per environment.
    expect(await audience.tenants('SP', 1)).toEqual([h.tenantId]);
    expect(await audience.tenants('sp', 2)).toEqual([h.tenantId]);
    // Another UF, or a tenant without a company there, does not hear.
    expect(await audience.tenants('RJ', 2)).toEqual([]);
    expect(await audience.tenants('MG', 2)).toEqual([]);
  });

  it('does not list a UF in an environment where the tenant has no company', async () => {
    await setState(h.liveCompanyId, 'RJ');
    expect(await audience.tenants('SP', 1)).toEqual([]);
    expect(await audience.tenants('RJ', 1)).toEqual([h.tenantId]);
  });

  it('lists each released tenant of the UF', async () => {
    await release(other, true);
    expect(await audience.tenants('MG', 2)).toEqual([other]);
    await setState(h.companyId, 'MG');
    expect((await audience.tenants('MG', 2)).sort()).toEqual(
      [h.tenantId, other].sort(),
    );
  });
});
