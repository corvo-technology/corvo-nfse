import type { SigningContext } from '@/modules/fiscal-core/domain/ports/gateway.port';
import { describeGatewayContract } from '@/modules/fiscal-core/testing/gateway-contract.suite';
import { FakeNfeGateway } from './fake-nfe.gateway';
import type { NfeConsultResult, SignedNfe } from './signed-nfe';

const ctx = { tpAmb: 2 } as SigningContext;

let counter = 0;
/** Distinct, well-formed 44-digit keys; the simulator does not check the DV. */
function nfe(cProd: string): SignedNfe {
  counter += 1;
  const accessKey = `3526111234567800019555001${String(counter).padStart(9, '0')}1${String(counter).padStart(8, '0')}0`;
  return {
    accessKey,
    uf: 'SP',
    signedXml: `<NFe><infNFe><det nItem="1"><prod><cProd>${cProd}</cProd></prod></det></infNFe></NFe>`,
  };
}

describeGatewayContract('FakeNfeGateway', () => new FakeNfeGateway(), {
  authorized: nfe('FAKE-100'),
  rejected: nfe('FAKE-225'),
  timeout: nfe('FAKE-TIMEOUT'),
  denied: nfe('FAKE-302'),
  consultKey: nfe('FAKE-100').accessKey,
  ctx,
});

describe('FakeNfeGateway scenarios', () => {
  const clock = () => new Date('2026-11-26T12:00:00Z');
  const make = () => new FakeNfeGateway(clock);

  it('authorizes by default and keeps the protocol for later consultations', async () => {
    const gateway = make();
    const doc = nfe('PROD-ANY');
    const issued = await gateway.issuer.issue(doc, ctx);
    expect(issued.kind).toBe('ok');
    const consulted = await gateway.consult.consultByKey(doc.accessKey, ctx);
    expect(consulted.kind).toBe('ok');
    if (issued.kind === 'ok' && consulted.kind === 'ok') {
      expect(consulted.value.status).toBe('authorized');
      expect(consulted.value.protocol).toBe(issued.value.protocol);
      expect(
        (consulted.value as NfeConsultResult).authorization?.protNFeXml,
      ).toContain(doc.accessKey);
    }
  });

  it.each([
    ['FAKE-225', '225'],
    ['FAKE-539', '539'],
    ['FAKE-778', '778'],
  ])('%s is rejected with code %s and a hint', async (cProd, code) => {
    const outcome = await make().issuer.issue(nfe(cProd), ctx);
    expect(outcome).toMatchObject({ kind: 'rejected', code });
    if (outcome.kind === 'rejected') expect(outcome.hint).toBeTruthy();
  });

  it('denies with 302 and the consultation says denied', async () => {
    const gateway = make();
    const doc = nfe('FAKE-302');
    expect(await gateway.issuer.issue(doc, ctx)).toMatchObject({
      kind: 'denied',
      code: '302',
    });
    const consulted = await gateway.consult.consultByKey(doc.accessKey, ctx);
    expect(consulted).toMatchObject({
      kind: 'ok',
      value: { status: 'denied', cStat: '302' },
    });
  });

  it('a rejected note is not found afterwards (217)', async () => {
    const gateway = make();
    const doc = nfe('FAKE-225');
    await gateway.issuer.issue(doc, ctx);
    expect(
      await gateway.consult.consultByKey(doc.accessKey, ctx),
    ).toMatchObject({
      kind: 'ok',
      value: { status: 'not_found', cStat: '217' },
    });
  });

  it('FAKE-TIMEOUT is uncertain on send and authorized on the next consultation', async () => {
    const gateway = make();
    const doc = nfe('FAKE-TIMEOUT');
    expect(await gateway.issuer.issue(doc, ctx)).toEqual({
      kind: 'uncertain',
      reason: 'timeout',
    });
    const consulted = await gateway.consult.consultByKey(doc.accessKey, ctx);
    expect(consulted).toMatchObject({
      kind: 'ok',
      value: { status: 'authorized', cStat: '100' },
    });
  });

  it('FAKE-204 answers duplicity and the consultation returns the authorization', async () => {
    const gateway = make();
    const doc = nfe('FAKE-204');
    expect(await gateway.issuer.issue(doc, ctx)).toMatchObject({
      kind: 'rejected',
      code: '204',
    });
    expect(
      await gateway.consult.consultByKey(doc.accessKey, ctx),
    ).toMatchObject({ kind: 'ok', value: { status: 'authorized' } });
  });

  it('FAKE-108 is unavailable', async () => {
    expect(await make().issuer.issue(nfe('FAKE-108'), ctx)).toEqual({
      kind: 'unavailable',
    });
  });

  it('consulting an unknown key is not_found', async () => {
    expect(
      await make().consult.consultByKey('9'.repeat(44), ctx),
    ).toMatchObject({ kind: 'ok', value: { status: 'not_found' } });
  });

  it('issuing the same document twice returns the same authorization', async () => {
    const gateway = make();
    const doc = nfe('FAKE-100');
    const first = await gateway.issuer.issue(doc, ctx);
    const second = await gateway.issuer.issue(doc, ctx);
    expect(second).toEqual(first);
  });

  it('events succeed, except FAKE-EVT-REJ which is rejected with 573', async () => {
    const gateway = make();
    const ok = nfe('FAKE-100');
    const bad = nfe('FAKE-EVT-REJ');
    await gateway.issuer.issue(ok, ctx);
    await gateway.issuer.issue(bad, ctx);

    expect(
      await gateway.cancel.cancel(
        {
          accessKey: ok.accessKey,
          reason: 'x',
          justification: 'Erro de digitação do valor total',
        },
        ctx,
      ),
    ).toMatchObject({ kind: 'ok', value: { cStat: '135' } });
    expect(
      await gateway.correct.correct(
        { accessKey: ok.accessKey, correction: 'Corrige texto', sequence: 1 },
        ctx,
      ),
    ).toMatchObject({ kind: 'ok' });
    expect(
      await gateway.inutilize.inutilize(
        {
          uf: 'SP',
          year: 26,
          series: 1,
          startNumber: 5,
          endNumber: 6,
          justification: 'Numeração pulada por falha',
        },
        ctx,
      ),
    ).toMatchObject({ kind: 'ok' });
    expect(
      await gateway.cancel.cancel(
        { accessKey: bad.accessKey, reason: 'x', justification: 'qualquer' },
        ctx,
      ),
    ).toMatchObject({ kind: 'rejected', code: '573' });
  });

  const eventXml = (tpEvento: string, nSeq: number) =>
    `<envEvento><evento><infEvento><tpEvento>${tpEvento}</tpEvento><nSeqEvento>${nSeq}</nSeqEvento></infEvento></evento></envEvento>`;

  it('remembers a cancellation: the consultation says cancelled and lists the event; a repeat is 573', async () => {
    const gateway = make();
    const doc = nfe('FAKE-100');
    await gateway.issuer.issue(doc, ctx);
    const request = {
      accessKey: doc.accessKey,
      reason: 'x',
      justification: 'Cancelamento de teste',
      signedXml: eventXml('110111', 1),
    };
    expect((await gateway.cancel.cancel(request, ctx)).kind).toBe('ok');
    const consulted = await gateway.consult.consultByKey(doc.accessKey, ctx);
    expect(consulted).toMatchObject({
      kind: 'ok',
      value: { status: 'cancelled', cStat: '101' },
    });
    expect((consulted as { value: NfeConsultResult }).value.events).toEqual([
      expect.objectContaining({ tpEvento: '110111', nSeq: 1 }),
    ]);
    expect(await gateway.cancel.cancel(request, ctx)).toMatchObject({
      kind: 'rejected',
      code: '573',
    });
  });

  it('FAKE-EVT-TIMEOUT registers the event but loses the answer', async () => {
    const gateway = make();
    const doc = nfe('FAKE-100');
    await gateway.issuer.issue(doc, ctx);
    expect(
      await gateway.correct.correct(
        {
          accessKey: doc.accessKey,
          correction: 'FAKE-EVT-TIMEOUT correção de teste',
          sequence: 1,
          signedXml: eventXml('110110', 1),
        },
        ctx,
      ),
    ).toEqual({ kind: 'uncertain', reason: 'timeout' });
    const consulted = await gateway.consult.consultByKey(doc.accessKey, ctx);
    expect(
      (consulted as { value: NfeConsultResult }).value.events,
    ).toHaveLength(1);
  });

  it('inutilizing the same range twice is 563', async () => {
    const gateway = make();
    const request = {
      uf: 'SP',
      year: 26,
      series: 1,
      startNumber: 20,
      endNumber: 22,
      justification: 'Numeração pulada por falha',
    };
    expect((await gateway.inutilize.inutilize(request, ctx)).kind).toBe('ok');
    expect(await gateway.inutilize.inutilize(request, ctx)).toMatchObject({
      kind: 'rejected',
      code: '563',
    });
  });

  it('reports the service as up', async () => {
    expect(
      await make().serviceStatus.status({
        uf: 'SP',
        tpAmb: 2,
        model: 55,
        tpEmis: 1,
      }),
    ).toEqual({ kind: 'ok', value: { up: true } });
  });
});
