/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies and raw SQL rows are untyped */
import { randomBytes, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import PDFDocument from 'pdfkit';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import {
  FISCAL_SITUATION_READER,
  type FiscalSituation,
} from '@/modules/fiscal-core/domain/fiscal-situation';
import {
  apiKeyHeader,
  closeE2eApp,
  createSeededE2eApp,
  type E2eTestApp,
} from './support/e2e-app';

/** The off-line NFC-e (`tpEmis` 9) through `POST /v1/invoices`, against the real app and database. */
const COMPANY_TAX_ID = '11222333000181';

const nfceBody = (companyId: string, extra: Record<string, unknown> = {}) => ({
  type: 'nfce',
  companyId,
  items: [
    {
      code: 'SKU1',
      description: 'Produto de teste',
      ncm: '61091000',
      cfop: '5102',
      unit: 'UN',
      quantity: 2,
      unitPrice: 10,
    },
  ],
  payments: [{ tPag: '17', amount: 20 }],
  ...extra,
});

interface DocRow {
  status: string;
  tp_emis: number;
  number: number;
  signed_xml: string;
  contingency_at: Date | null;
  contingency_reason: string | null;
  transmitted_at: Date | null;
  attempt: number;
}

describe('off-line NFC-e (e2e)', () => {
  let ctx: E2eTestApp;
  let db: DataSource;
  let tenantId: string;
  let key: string;
  const schema = process.env.DB_SCHEMA ?? 'corvo';
  const companyId = randomUUID();
  let situation: FiscalSituation = {
    breakerOpen: false,
    authorityReachable: null,
    network: 'ok',
  };

  const api = (method: 'get' | 'post' | 'put', path: string) =>
    request(ctx.app.getHttpServer())
      [method](`/v1${path}`)
      .set(apiKeyHeader(key));
  const create = (body: unknown, idempotencyKey: string) =>
    api('post', '/invoices')
      .set('Idempotency-Key', idempotencyKey)
      .send(body as object);
  const saveSettings = () =>
    api('put', `/companies/${companyId}/nfe-settings`)
      .send({
        stateRegistration: '110042490114',
        crt: 1,
      })
      .expect(200);

  beforeAll(async () => {
    ctx = await createSeededE2eApp((builder) =>
      builder
        .overrideProvider(FISCAL_SITUATION_READER)
        .useValue({ situation: () => Promise.resolve(situation) }),
    );
    db = ctx.dataSource;
    tenantId = ctx.tenantId;
    const hex = randomBytes(20).toString('hex');
    key = `corvo_test_${hex}`;
    await db.query(
      `INSERT INTO "${schema}".api_keys (id, tenant_id, name, environment, key_prefix, key_hash, scope, created_at)
       VALUES ($1, $2, 'e2e-nfce-offline', 'test', $3, $4, 'full_access', NOW())`,
      [
        randomUUID(),
        tenantId,
        `corvo_test_${hex.substring(0, 12)}`,
        await argon2.hash(key),
      ],
    );
    await db.query(
      `INSERT INTO "${schema}".nfse_companies
         (id, tenant_id, legal_name, tax_id, municipality_code, environment, status,
          address_street, address_number, address_district, address_zip, address_city, address_state,
          created_at, updated_at)
       VALUES ($1, $2, 'Empresa Teste LTDA', $3, '3550308', 'test', 'ready',
          'Avenida Paulista', '1000', 'Bela Vista', '01310100', 'São Paulo', 'SP', NOW(), NOW())`,
      [companyId, tenantId, COMPANY_TAX_ID],
    );
    await saveSettings();
  });

  afterAll(async () => {
    await closeE2eApp(ctx);
  });

  const row = async (id: string): Promise<DocRow> =>
    (
      await db.query<DocRow[]>(
        `SELECT status, tp_emis, number, series, access_key, signed_xml, qr_code, contingency_at, contingency_reason,
                transmitted_at, attempt
         FROM "${schema}".nfe_documents WHERE id = $1`,
        [id],
      )
    )[0];
  const emitMessages = async (id: string): Promise<number> =>
    (
      await db.query(
        `SELECT count(*)::int AS n FROM "${schema}".outbox_messages WHERE aggregate_id = $1 AND type = 'nfe.emit'`,
        [id],
      )
    )[0].n as number;

  it('contingency "offline": 201 at once with the key, the QR Code and the files; nothing was sent to the SEFAZ', async () => {
    const res = await create(
      nfceBody(companyId, { contingency: 'offline' }),
      'off-1',
    );
    expect(res.status).toBe(201);
    const data = res.body.data;
    expect(data).toMatchObject({
      type: 'nfce',
      status: 'contingency_pending',
    });
    expect(data.accessKey).toMatch(/^\d{44}$/);
    expect(data.accessKey[34]).toBe('9');
    expect(data.qrCode).toContain(`?p=${data.accessKey}|3|2|`);
    expect(data.xmlUrl).toBe(`/v1/invoices/${data.id}/xml`);
    expect(data.pdfUrl).toBe(`/v1/invoices/${data.id}/pdf`);

    const stored = await row(data.id as string);
    expect(stored).toMatchObject({
      status: 'contingency_pending',
      tp_emis: 9,
      attempt: 1,
      transmitted_at: null,
      contingency_reason:
        'Emissao em contingencia off-line solicitada pelo emitente',
    });
    expect(stored.number).toBeGreaterThan(0);
    expect(stored.contingency_at).toBeTruthy();
    expect(stored.signed_xml).toContain('<tpEmis>9</tpEmis>');
    expect(stored.signed_xml).toContain('<dhCont>');
    expect(stored.signed_xml).toContain('<xJust>');
    expect(await emitMessages(data.id as string)).toBe(1);

    const detail = await api('get', `/invoices/${data.id as string}`);
    expect(detail.body.data).toMatchObject({
      status: 'contingency_pending',
      contingencyReason:
        'Emissao em contingencia off-line solicitada pelo emitente',
    });
    expect(detail.body.data.contingencyDeadlineAt).toBeTruthy();
    expect(
      new Date(detail.body.data.contingencyDeadlineAt as string).getTime() -
        new Date(detail.body.data.contingencyAt as string).getTime(),
    ).toBe(24 * 3_600_000);

    const xml = await api('get', `/invoices/${data.id as string}/xml`);
    expect(xml.status).toBe(200);
    expect(xml.text).toContain('<tpEmis>9</tpEmis>');
    expect(xml.text).toContain('<infNFeSupl><qrCode>');
  });

  it('the DANFCE says it was issued in contingency', async () => {
    const created = await create(
      nfceBody(companyId, { contingency: 'offline' }),
      'off-pdf',
    );
    const drawn: string[] = [];
    // pdfkit writes glyph ids, not letters: the text is read where it is drawn.
    const proto = PDFDocument.prototype as unknown as {
      text: (...args: unknown[]) => unknown;
    };
    const original = proto.text;
    proto.text = function (this: unknown, ...args: unknown[]) {
      if (typeof args[0] === 'string') drawn.push(args[0]);
      return original.apply(this, args);
    };
    try {
      const pdf = await api(
        'get',
        `/invoices/${created.body.data.id as string}/pdf`,
      ).buffer(true);
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
    } finally {
      proto.text = original;
    }
    expect(drawn.join('\n')).toContain('EMITIDA EM CONTINGÊNCIA');
  });

  it('the same Idempotency-Key answers 200 with the same id and takes no new number', async () => {
    const first = await create(
      nfceBody(companyId, { contingency: 'offline', additionalInfo: 'idem' }),
      'off-idem',
    );
    expect(first.status).toBe(201);
    const [{ current_number: before }] = await db.query(
      `SELECT current_number FROM "${schema}".nfe_number_sequences WHERE company_id = $1 AND model = 65`,
      [companyId],
    );
    const again = await create(
      nfceBody(companyId, { contingency: 'offline', additionalInfo: 'idem' }),
      'off-idem',
    );
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({
      id: first.body.data.id,
      status: 'contingency_pending',
      replayed: true,
    });
    const [{ current_number: after }] = await db.query(
      `SELECT current_number FROM "${schema}".nfe_number_sequences WHERE company_id = $1 AND model = 65`,
      [companyId],
    );
    expect(after).toBe(before);
  });

  describe('automatic off-line contingency (always on)', () => {
    afterAll(() => {
      situation = {
        breakerOpen: false,
        authorityReachable: null,
        network: 'ok',
      };
    });

    it('authority down: 201 off-line, reason "SEFAZ indisponivel"', async () => {
      situation = {
        breakerOpen: true,
        authorityReachable: false,
        network: 'ok',
      };
      const res = await create(nfceBody(companyId), 'off-auto-1');
      expect(res.status).toBe(201);
      expect((await row(res.body.data.id as string)).contingency_reason).toBe(
        'SEFAZ indisponivel',
      );
    });

    it('our network down: 201 off-line, reason "Sem comunicacao com a SEFAZ"', async () => {
      situation = {
        breakerOpen: false,
        authorityReachable: null,
        network: 'gov_unreachable_from_us',
      };
      const res = await create(nfceBody(companyId), 'off-auto-2');
      expect(res.status).toBe(201);
      expect((await row(res.body.data.id as string)).contingency_reason).toBe(
        'Sem comunicacao com a SEFAZ',
      );
    });

    it('everything normal: the normal way (202 queued)', async () => {
      situation = {
        breakerOpen: false,
        authorityReachable: true,
        network: 'ok',
      };
      const res = await create(nfceBody(companyId), 'off-auto-3');
      expect(res.status).toBe(202);
      expect(res.body.data.status).toBe('queued');
    });
  });

  it('a state with no NFC-e addresses (so no off-line QR Code either) answers 422 UF_NOT_ENABLED and saves nothing', async () => {
    const mgCompany = randomUUID();
    await db.query(
      `INSERT INTO "${schema}".nfse_companies
         (id, tenant_id, legal_name, tax_id, municipality_code, environment, status,
          address_street, address_number, address_district, address_zip, address_city, address_state,
          created_at, updated_at)
       VALUES ($1, $2, 'Empresa MG LTDA', '22333444000181', '3106200', 'test', 'ready',
          'Avenida Afonso Pena', '10', 'Centro', '30130000', 'Belo Horizonte', 'MG', NOW(), NOW())`,
      [mgCompany, tenantId],
    );
    await api('put', `/companies/${mgCompany}/nfe-settings`)
      .send({ stateRegistration: '0623079040081', crt: 1 })
      .expect(200);
    const before = await db.query(
      `SELECT count(*)::int AS n FROM "${schema}".nfe_documents WHERE company_id = $1`,
      [mgCompany],
    );
    const res = await create(
      nfceBody(mgCompany, { contingency: 'offline' }),
      'off-mg-1',
    );
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ERROR_UF_NOT_ENABLED');
    const after = await db.query(
      `SELECT count(*)::int AS n FROM "${schema}".nfe_documents WHERE company_id = $1`,
      [mgCompany],
    );
    expect(after[0].n).toBe(before[0].n);
  });

  describe('PUT /invoices/{id} on an off-line NFC-e the SEFAZ rejected', () => {
    const rejectedOffline = async (idem: string) => {
      const created = await create(
        nfceBody(companyId, { contingency: 'offline', additionalInfo: idem }),
        idem,
      );
      const id = created.body.data.id as string;
      await db.query(
        `UPDATE "${schema}".nfe_documents SET status = 'rejected', c_stat = '225' WHERE id = $1`,
        [id],
      );
      return { id, accessKey: created.body.data.accessKey as string };
    };
    const put = (id: string, body: unknown) =>
      api('put', `/invoices/${id}`).send(body as object);

    it('a free field: 202, same key, back to contingency_pending with a new transmit message', async () => {
      const { id, accessKey } = await rejectedOffline('off-put-1');
      const res = await put(
        id,
        nfceBody(companyId, {
          contingency: 'offline',
          additionalInfo: 'texto corrigido',
          items: [
            {
              code: 'SKU1',
              description: 'Camiseta polo',
              ncm: '61091000',
              cfop: '5102',
              unit: 'UN',
              quantity: 2,
              unitPrice: 10,
            },
          ],
        }),
      );
      expect(res.status).toBe(202);
      expect(res.body.data).toMatchObject({
        type: 'nfce',
        id,
        status: 'contingency_pending',
      });
      const stored = await row(id);
      expect(stored).toMatchObject({
        status: 'contingency_pending',
        attempt: 2,
        contingency_reason:
          'Emissao em contingencia off-line solicitada pelo emitente',
      });
      const detail = await api('get', `/invoices/${id}`);
      expect(detail.body.data.accessKey).toBe(accessKey);
      expect(await emitMessages(id)).toBe(2);
    });

    it('a value: 422 NFCE_CONTINGENCY_FIELD_LOCKED with the fields, nothing changes', async () => {
      const { id } = await rejectedOffline('off-put-2');
      const res = await put(
        id,
        nfceBody(companyId, {
          contingency: 'offline',
          additionalInfo: 'off-put-2',
          items: [
            {
              code: 'SKU1',
              description: 'Produto de teste',
              ncm: '61091000',
              cfop: '5102',
              unit: 'UN',
              quantity: 2,
              unitPrice: 11,
            },
          ],
          payments: [{ tPag: '17', amount: 22 }],
        }),
      );
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('ERROR_NFCE_CONTINGENCY_FIELD_LOCKED');
      expect(res.body.details.fields).toEqual(
        expect.arrayContaining(['items[0].unitPrice', 'payment', 'totals']),
      );
      expect((await row(id)).status).toBe('rejected');
    });
  });

  it('refuses a contingency value other than "offline" (400)', async () => {
    const res = await create(
      nfceBody(companyId, { contingency: 'svc' }),
      'off-bad-1',
    );
    expect(res.status).toBe(400);
  });
});
