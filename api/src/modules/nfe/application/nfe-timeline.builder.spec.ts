import type { NfeHistoryEntry } from '../domain/nfe-document';
import type { NfeFiscalEvent } from '../domain/nfe-event';
import { buildNfeTimeline } from './nfe-timeline.builder';

const T0 = Date.parse('2026-11-27T17:37:30.817Z');
const at = (ms: number) => new Date(T0 + ms);

const row = (
  ms: number,
  from: NfeHistoryEntry['fromStatus'],
  toStatus: NfeHistoryEntry['toStatus'],
  cStat: string | null = null,
  xMotivo: string | null = null,
) => ({
  tenantId: 't',
  documentId: 'd',
  fromStatus: from,
  toStatus,
  accessKey: null,
  attempt: 1,
  cStat,
  xMotivo,
  createdAt: at(ms),
});

const event = (over: Partial<NfeFiscalEvent>): NfeFiscalEvent => ({
  id: 'e1',
  tenantId: 't',
  documentId: 'd',
  tpEvento: '110111',
  nSeq: 1,
  status: 'registered',
  protocol: null,
  text: 'Pedido cancelado pelo cliente antes da entrega',
  requestXml: null,
  procXml: null,
  xmlPath: null,
  cStat: '135',
  xMotivo: 'Evento registrado e vinculado a NF-e',
  createdAt: at(3935),
  updatedAt: at(4500),
  ...over,
});

const base = [
  row(0, null, 'queued'),
  row(665, 'queued', 'processing'),
  row(694, 'processing', 'authorized', '100', 'Autorizado o uso da NF-e'),
];

const shape = (entries: ReturnType<typeof buildNfeTimeline>) =>
  entries.map((e) => [e.kind, e.status, e.cStat, e.text]);

describe('buildNfeTimeline', () => {
  it('tells an authorized then cancelled NF-e once, in order, with no stale code', () => {
    const history = [
      ...base,
      // Old rows copied the last answer onto the request.
      row(3943, 'authorized', 'cancelling', '100', 'Autorizado o uso da NF-e'),
      row(
        4597,
        'cancelling',
        'cancelled',
        '135',
        'Evento registrado e vinculado a NF-e',
      ),
    ];
    const timeline = buildNfeTimeline(history, [event({})]);
    expect(shape(timeline)).toEqual([
      ['status', 'queued', null, null],
      ['status', 'processing', null, null],
      ['status', 'authorized', '100', null],
      [
        'status',
        'cancelling',
        null,
        'Pedido cancelado pelo cliente antes da entrega',
      ],
      ['status', 'cancelled', '135', null],
    ]);
    expect(timeline[4].xMotivo).toBe('Evento registrado e vinculado a NF-e');
  });

  it('fills the answer into the cancelled row when the row has none', () => {
    const timeline = buildNfeTimeline(
      [
        ...base,
        row(3943, 'authorized', 'cancelling'),
        row(4597, 'cancelling', 'cancelled'),
      ],
      [event({})],
    );
    expect(timeline.at(-1)).toMatchObject({
      status: 'cancelled',
      cStat: '135',
      xMotivo: 'Evento registrado e vinculado a NF-e',
    });
  });

  it('keeps the correction letters as their own rows, between the status rows', () => {
    const cce = event({
      id: 'e2',
      tpEvento: '110110',
      nSeq: 1,
      text: 'Corrigir o endereço de entrega',
      createdAt: at(1000),
    });
    const timeline = buildNfeTimeline(
      [
        ...base,
        row(3943, 'authorized', 'cancelling'),
        row(4597, 'cancelling', 'cancelled', '135', 'x'),
      ],
      [cce, event({})],
    );
    expect(timeline.map((e) => `${e.kind}:${e.status}`)).toEqual([
      'status:queued',
      'status:processing',
      'status:authorized',
      'event:registered',
      'status:cancelling',
      'status:cancelled',
    ]);
    expect(timeline[3]).toMatchObject({
      tpEvento: '110110',
      sequence: 1,
      cStat: '135',
    });
  });

  it('shows a refused cancellation once, with the reason on the row that goes back to authorized', () => {
    const timeline = buildNfeTimeline(
      [
        ...base,
        row(
          3943,
          'authorized',
          'cancelling',
          '100',
          'Autorizado o uso da NF-e',
        ),
        row(4597, 'cancelling', 'authorized'),
      ],
      [
        event({
          status: 'rejected',
          cStat: '501',
          xMotivo: 'Rejeicao: Prazo de cancelamento superior ao previsto',
        }),
      ],
    );
    expect(shape(timeline).slice(2)).toEqual([
      ['status', 'authorized', '100', null],
      [
        'status',
        'cancelling',
        null,
        'Pedido cancelado pelo cliente antes da entrega',
      ],
      ['status', 'authorized', '501', null],
    ]);
    expect(timeline.at(-1)).toMatchObject({
      from: 'cancelling',
      xMotivo: 'Rejeicao: Prazo de cancelamento superior ao previsto',
    });
  });

  it('shows only the request while the cancellation waits for the SEFAZ', () => {
    const timeline = buildNfeTimeline(
      [...base, row(3943, 'authorized', 'cancelling')],
      [event({ status: 'pending', cStat: null, xMotivo: null })],
    );
    expect(timeline.map((e) => e.status)).toEqual([
      'queued',
      'processing',
      'authorized',
      'cancelling',
    ]);
  });

  it('keeps contingency rows without a code and sorts equal times with status first', () => {
    const timeline = buildNfeTimeline(
      [
        row(0, null, 'contingency_pending'),
        row(10, 'contingency_pending', 'processing', '999', 'old'),
        row(20, 'processing', 'authorized', '100', 'Autorizado o uso da NF-e'),
      ],
      [event({ tpEvento: '110110', createdAt: at(20) })],
    );
    expect(timeline.map((e) => `${e.kind}:${e.status}:${e.cStat}`)).toEqual([
      'status:contingency_pending:null',
      'status:processing:null',
      'status:authorized:100',
      'event:registered:135',
    ]);
  });
});
