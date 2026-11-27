import { toNfeHttpError } from '@/modules/nfe/http/nfe-error-http';
import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from '@/modules/nfe/testing/postgres-harness';
import { createNfeStack, type NfeStack } from '@/modules/nfe/testing/nfe-stack';

const JUSTIFICATION = 'Cancelamento por erro na digitação do pedido';
const RANGE_JUSTIFICATION = 'Numeração pulada por falha do sistema emissor';

describePostgres(
  'NFC-e consultation, cancellation and inutilization on PostgreSQL (simulated SEFAZ)',
  () => {
    let h: PostgresHarness;
    let s: NfeStack;

    beforeAll(async () => {
      h = await createPostgresHarness('nfceevents');
      s = createNfeStack(h);
    }, 120000);

    afterAll(async () => {
      await h.close();
    });

    beforeEach(() => {
      s.redis.values.clear();
      s.redis.sets.clear();
      s.settings.nfceDefaultSeries = 1;
      s.hooks.beforeEvent = undefined;
      s.hooks.afterIssue = undefined;
      s.hooks.consult = undefined;
    });

    const hooks = (type: string, id: string) =>
      s.deliveries.filter(
        (d) => d.eventType === type && d.data.documentId === id,
      );
    const eventsOf = async (id: string) => {
      const rows: Array<Record<string, unknown>> = await h.admin.query(
        `SELECT * FROM "${h.schema}".nfe_document_events WHERE document_id = $1 ORDER BY created_at, id`,
        [id],
      );
      return rows;
    };

    it('cancels an authorized NFC-e: cancelled, with nfce.document.cancelled once, through the nfce gateway', async () => {
      const id = await s.issueNfce();
      const cancel = jest.spyOn(s.fakeNfce.cancel, 'cancel');
      const nfeCancel = jest.spyOn(s.fake.cancel, 'cancel');
      await s.cancelService.cancel(id, h.tenantId, 'test', JUSTIFICATION);
      await s.dispatch('nfe.cancel', id);
      expect((await s.row(id)).status).toBe('cancelled');
      expect((await eventsOf(id))[0]).toMatchObject({
        tp_evento: '110111',
        status: 'registered',
      });
      expect(hooks('nfce.document.cancelled', id)).toHaveLength(1);
      expect(hooks('nfe.document.cancelled', id)).toHaveLength(0);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(nfeCancel).not.toHaveBeenCalled();
      cancel.mockRestore();
      nfeCancel.mockRestore();
    });

    it('cStat 501: back to authorized with nfce.document.cancellation_rejected and the 30-minute hint in lastError', async () => {
      const id = await s.issueNfce();
      s.hooks.beforeEvent = () => ({
        kind: 'rejected',
        code: '501',
        message:
          'Rejeição: Prazo de Cancelamento superior ao previsto na Legislação',
      });
      await s.cancelService.cancel(id, h.tenantId, 'test', JUSTIFICATION);
      await s.dispatch('nfe.cancel', id);

      expect((await s.row(id)).status).toBe('authorized');
      const rejected = hooks('nfce.document.cancellation_rejected', id);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].data).toMatchObject({
        cStat: '501',
        hint: expect.stringContaining('30 minutos'),
      });
      const doc = await s.documents.findById(id, h.tenantId, 'test');
      expect(toNfeHttpError(doc!.toSnapshot())?.error).toMatchObject({
        type: 'validation',
        code: '501',
        hint: expect.stringContaining('30 minutos'),
      });

      // Asking again clears the old reason; once registered, the NFC-e is cancelled with no error.
      s.hooks.beforeEvent = undefined;
      await s.cancelService.cancel(id, h.tenantId, 'test', JUSTIFICATION);
      expect((await s.row(id)).last_error_code).toBeNull();
      await s.dispatch('nfe.cancel', id);
      expect((await s.row(id)).status).toBe('cancelled');
      expect((await s.row(id)).last_error_code).toBeNull();
    });

    it('the same refusal on an NF-e has no hint and no lastError (NF-e unchanged)', async () => {
      const id = await s.issue('FAKE-100');
      s.hooks.beforeEvent = () => ({
        kind: 'rejected',
        code: '501',
        message: 'Rejeição: Prazo de Cancelamento superior ao previsto',
      });
      await s.cancelService.cancel(id, h.tenantId, 'test', JUSTIFICATION);
      await s.dispatch('nfe.cancel', id);
      const rejected = hooks('nfe.document.cancellation_rejected', id);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].data).not.toHaveProperty('hint');
      expect((await s.row(id)).last_error_code).toBeNull();
    });

    it('inutilizes a range of the NFC-e series: model 65 row, nfce gateway, nfce.inutilization.completed', async () => {
      const inutilize = jest.spyOn(s.fakeNfce.inutilize, 'inutilize');
      const nfeInutilize = jest.spyOn(s.fake.inutilize, 'inutilize');
      const { inutilization } = await s.inutilizeService.create(
        h.tenantId,
        'test',
        {
          companyId: h.companyId,
          model: 65,
          series: 5,
          start: 5,
          end: 7,
          justification: RANGE_JUSTIFICATION,
        },
      );
      expect(inutilization).toMatchObject({ model: 65, status: 'pending' });
      const [row]: Array<Record<string, unknown>> = await h.admin.query(
        `SELECT * FROM "${h.schema}".nfe_inutilizations WHERE id = $1`,
        [inutilization.id],
      );
      expect(row.model).toBe(65);
      expect(String(row.request_xml)).toContain('<mod>65</mod>');

      await s.dispatch('nfe.inutilize', inutilization.id);
      const [done]: Array<Record<string, unknown>> = await h.admin.query(
        `SELECT * FROM "${h.schema}".nfe_inutilizations WHERE id = $1`,
        [inutilization.id],
      );
      expect(done).toMatchObject({ status: 'homologada', model: 65 });
      const completed = s.deliveries.filter(
        (d) =>
          d.eventType === 'nfce.inutilization.completed' &&
          d.data.inutilizationId === inutilization.id,
      );
      expect(completed).toHaveLength(1);
      expect(completed[0].data).toMatchObject({ documentType: 'nfce' });
      expect(inutilize).toHaveBeenCalledTimes(1);
      expect(nfeInutilize).not.toHaveBeenCalled();
      // The NFC-e numbering is raised to the end of the range, on model 65 only.
      const [seq]: Array<{ current_number: number }> = await h.admin.query(
        `SELECT current_number FROM "${h.schema}".nfe_number_sequences WHERE company_id = $1 AND model = 65 AND series = 5`,
        [h.companyId],
      );
      expect(seq.current_number).toBe(7);
      inutilize.mockRestore();
      nfeInutilize.mockRestore();
    });

    it('a NFC-e number holds its range (409) and an NF-e number does not', async () => {
      s.settings.nfceDefaultSeries = 9;
      await s.issueNfce();
      const range = (model: 55 | 65) => ({
        companyId: h.companyId,
        model,
        series: 9,
        start: 1,
        end: 1,
        justification: RANGE_JUSTIFICATION,
      });
      await expect(
        s.inutilizeService.create(h.tenantId, 'test', range(65)),
      ).rejects.toMatchObject({
        response: { code: 'INUTILIZATION_RANGE_IN_USE' },
      });
      s.settings.defaultSeries = 9;
      await s.issue('FAKE-100');
      s.settings.defaultSeries = 1;
      // NF-e 9/1 exists, but a NFC-e range 9/2 is free: the models count apart.
      const free = await s.inutilizeService.create(h.tenantId, 'test', {
        ...range(65),
        start: 2,
        end: 2,
      });
      expect(free.inutilization.model).toBe(65);
    });

    it('a NFC-e whose answer was lost is reconciled by key through the nfce gateway', async () => {
      const accepted = await s.nfceIntake.submit(
        h.tenantId,
        'test',
        s.nfceInput('FAKE-100'),
        `lost-${Math.random()}`,
      );
      s.hooks.afterIssue = () => {
        throw new Error('worker killed');
      };
      await expect(
        s.emit.process(accepted.id, h.tenantId, 'test'),
      ).rejects.toThrow('worker killed');
      s.hooks.afterIssue = undefined;
      const sent = await s.row(accepted.id);
      expect(sent.status).toBe('processing');

      await s.emit.process(accepted.id, h.tenantId, 'test');
      expect((await s.row(accepted.id)).status).toBe('reconciliation_required');
      const consult = jest.spyOn(s.fakeNfce.consult, 'consultByKey');
      const nfeConsult = jest.spyOn(s.fake.consult, 'consultByKey');
      const [message] = await s.messages('nfe.reconcile', accepted.id);
      await s.reconcile.handle(message);
      const settled = await s.row(accepted.id);
      expect(settled).toMatchObject({
        status: 'authorized',
        access_key: sent.access_key,
        number: sent.number,
      });
      expect(consult).toHaveBeenCalled();
      expect(nfeConsult).not.toHaveBeenCalled();
      expect(hooks('nfce.document.authorized', accepted.id)).toHaveLength(1);
      consult.mockRestore();
      nfeConsult.mockRestore();
    });

    it('a NFC-e has no correction letter capability in the registry', () => {
      expect(s.registry.get('nfce').correct).toBeUndefined();
      expect(s.registry.get('nfe').correct).toBeDefined();
    });
  },
);
