import { TipoEvento } from 'open-nfse';
import {
  BROKEN_XML,
  CANCELLATION_WITHOUT_REASON_XML,
  CANCELLATION_XML,
  TAKER_REJECTION_XML,
} from '../__fixtures__/portal-events';
import { effectOf, eventReason } from './portal-event';

describe('effectOf', () => {
  it.each([
    TipoEvento.Cancelamento,
    TipoEvento.CancelamentoPorSubstituicao,
    TipoEvento.CancelamentoDeferidoAnaliseFiscal,
    TipoEvento.CancelamentoPorOficio,
  ])('%s cancels the invoice', (type) => {
    expect(effectOf(type)).toEqual({ kind: 'cancel' });
  });

  it('a taker or intermediary rejection raises the taker badge', () => {
    expect(effectOf(TipoEvento.RejeicaoTomador)).toEqual({
      kind: 'flag',
      flag: 'taker_rejected',
    });
    expect(effectOf(TipoEvento.RejeicaoIntermediario)).toEqual({
      kind: 'flag',
      flag: 'taker_rejected',
    });
  });

  it('a block by the municipality raises the blocked badge, and the unblock lowers it', () => {
    expect(effectOf(TipoEvento.BloqueioPorOficio)).toEqual({
      kind: 'flag',
      flag: 'blocked',
    });
    expect(effectOf(TipoEvento.DesbloqueioPorOficio)).toEqual({
      kind: 'clear',
      flag: 'blocked',
    });
  });

  it.each([
    TipoEvento.ConfirmacaoTomador,
    TipoEvento.ConfirmacaoTacita,
    TipoEvento.AnulacaoRejeicao,
  ])('%s lowers the taker badge', (type) => {
    expect(effectOf(type)).toEqual({ kind: 'clear', flag: 'taker_rejected' });
  });

  it.each([
    TipoEvento.ConfirmacaoPrestador,
    TipoEvento.SolicitacaoCancelamentoAnaliseFiscal,
    TipoEvento.TributosNfseRecolhidos,
    'SOMETHING_NEW',
  ])('%s is only stored', (type) => {
    expect(effectOf(type)).toEqual({ kind: 'ignore' });
  });
});

describe('eventReason', () => {
  it('reads the reason of a cancellation and of a rejection', () => {
    expect(eventReason(CANCELLATION_XML)).toBe('Erro de digitação no valor');
    expect(eventReason(TAKER_REJECTION_XML)).toBe('Serviço não contratado');
  });

  it('is null when the event carries no reason', () => {
    expect(eventReason(CANCELLATION_WITHOUT_REASON_XML)).toBeNull();
  });

  it('is null, not an error, when the XML cannot be read', () => {
    expect(eventReason(BROKEN_XML)).toBeNull();
    expect(eventReason('')).toBeNull();
  });
});
