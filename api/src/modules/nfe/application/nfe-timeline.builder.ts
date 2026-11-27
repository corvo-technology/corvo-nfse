import type { NfeHistoryEntry } from '../domain/nfe-document';
import { CANCEL_TP_EVENTO, type NfeFiscalEvent } from '../domain/nfe-event';
import type { NfeTimelineEntry } from '../http/nfe-event.dto';

type HistoryRow = NfeHistoryEntry & { createdAt: Date };

/** Moves that are a request or a wait: the SEFAZ answers nothing on them (old rows copied the last answer). */
const NO_ANSWER = new Set([
  'queued',
  'contingency_pending',
  'processing',
  'cancelling',
  'retry_pending',
]);

/**
 * Joins the status history and the fiscal events into what the customer reads. The cancellation
 * (110111) is told once, on the status rows: `cancelling` is the request (with the justification),
 * `cancelled` carries the SEFAZ answer and a refused one carries the reason on the row that goes
 * back to `authorized`. Correction letters (110110) change no status and keep their own row.
 */
export function buildNfeTimeline(
  history: HistoryRow[],
  events: NfeFiscalEvent[],
): NfeTimelineEntry[] {
  const rows: NfeTimelineEntry[] = history.map((row) => ({
    kind: 'status',
    at: row.createdAt,
    status: row.toStatus,
    from: row.fromStatus,
    tpEvento: null,
    sequence: null,
    eventId: null,
    text: null,
    cStat: NO_ANSWER.has(row.toStatus) ? null : row.cStat,
    xMotivo: NO_ANSWER.has(row.toStatus) ? null : row.xMotivo,
  }));
  const last = (match: (row: NfeTimelineEntry) => boolean) =>
    [...rows].reverse().find(match);
  const extra: NfeTimelineEntry[] = [];
  for (const event of events) {
    if (event.tpEvento === CANCEL_TP_EVENTO) {
      const request = last((r) => r.status === 'cancelling');
      if (request) request.text = event.text;
      const answer =
        event.status === 'registered'
          ? last((r) => r.status === 'cancelled')
          : event.status === 'rejected'
            ? last((r) => r.status === 'authorized' && r.from === 'cancelling')
            : undefined;
      if (answer) {
        answer.cStat = event.cStat ?? answer.cStat;
        answer.xMotivo = event.xMotivo ?? answer.xMotivo;
      }
      const waiting =
        event.status !== 'registered' && event.status !== 'rejected';
      // Folded into its status rows (or still waiting for the answer): nothing more to show.
      if (answer || (request && waiting)) continue;
    }
    extra.push({
      kind: 'event',
      at: event.createdAt,
      status: event.status,
      from: null,
      tpEvento: event.tpEvento,
      sequence: event.nSeq,
      eventId: event.id,
      text: event.text,
      cStat: event.cStat,
      xMotivo: event.xMotivo,
    });
  }
  // Same instant: the status row first; then the order they were written (the sort is stable).
  return [...rows, ...extra].sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      (a.kind === b.kind ? 0 : a.kind === 'status' ? -1 : 1),
  );
}
