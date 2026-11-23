import { parseEventoXml, TipoEvento } from 'open-nfse';
import type { PortalFlag } from '@/modules/invoice/domain/portal-flag';

/** What a portal event does to an invoice Corvo issued. */
export type PortalEventEffect =
  | { kind: 'cancel' }
  /** Badge on the invoice, and a notice to the workspace. */
  | { kind: 'flag'; flag: PortalFlag }
  /** Takes the badge away, when it is the one this event answers. */
  | { kind: 'clear'; flag: PortalFlag }
  /** Stored only. */
  | { kind: 'ignore' };

const EFFECTS: Partial<Record<TipoEvento, PortalEventEffect>> = {
  [TipoEvento.Cancelamento]: { kind: 'cancel' },
  [TipoEvento.CancelamentoPorSubstituicao]: { kind: 'cancel' },
  [TipoEvento.CancelamentoDeferidoAnaliseFiscal]: { kind: 'cancel' },
  [TipoEvento.CancelamentoPorOficio]: { kind: 'cancel' },
  [TipoEvento.RejeicaoTomador]: { kind: 'flag', flag: 'taker_rejected' },
  [TipoEvento.RejeicaoIntermediario]: { kind: 'flag', flag: 'taker_rejected' },
  [TipoEvento.BloqueioPorOficio]: { kind: 'flag', flag: 'blocked' },
  [TipoEvento.ConfirmacaoTomador]: { kind: 'clear', flag: 'taker_rejected' },
  [TipoEvento.ConfirmacaoTacita]: { kind: 'clear', flag: 'taker_rejected' },
  [TipoEvento.AnulacaoRejeicao]: { kind: 'clear', flag: 'taker_rejected' },
  [TipoEvento.DesbloqueioPorOficio]: { kind: 'clear', flag: 'blocked' },
};

/** The effect of a portal event type; any type Corvo does not act on is only stored. */
export function effectOf(eventType: string): PortalEventEffect {
  return EFFECTS[eventType as TipoEvento] ?? { kind: 'ignore' };
}

/**
 * The reason written in the event (`xMotivo`), when the XML can be read and carries one.
 * Best effort: the event type already says what to do, so an unreadable XML only loses the text.
 */
export function eventReason(xml: string): string | null {
  try {
    const detail = parseEventoXml(xml).infEvento.pedRegEvento.infPedReg
      .detalhe as Record<string, { xMotivo?: unknown } | undefined>;
    const reason = Object.values(detail)[0]?.xMotivo;
    return typeof reason === 'string' && reason.trim()
      ? reason.trim().slice(0, 255)
      : null;
  } catch {
    return null;
  }
}
