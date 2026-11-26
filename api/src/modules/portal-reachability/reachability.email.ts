import {
  details,
  emailLayout,
  note,
  paragraph,
  type RenderedEmail,
} from '@/infra/external/email/email-templates';
import type { PortalHealth } from './reachability.classifier';

/** Plain Portuguese: what is wrong and what to do, per classification. */
const EXPLANATION: Record<Exclude<PortalHealth, 'ok'>, string> = {
  gov_unreachable_from_us:
    'Os servidores da Corvo não alcançam a rede do governo; outros sites funcionam. Provável problema de rede do provedor (Guara).',
  no_internet:
    'Os servidores da Corvo estão sem acesso à internet, nem o governo nem outros sites respondem. Provável problema de rede do provedor (Guara).',
  portal_down:
    'A rede do governo responde, mas o portal da NFS-e não. O portal está fora do ar; o problema não é da Corvo.',
  emission_failures:
    'O teste de conexão está normal, mas as notas de verdade estão falhando por falta de resposta do portal. Pode ser instabilidade só em alguns endereços do governo.',
};

const ACTION: Record<Exclude<PortalHealth, 'ok'>, string> = {
  gov_unreachable_from_us:
    'O que fazer: abra um chamado na Guara dizendo que a saída de rede dos servidores não consegue abrir conexão com sefin.nfse.gov.br, adn.nfse.gov.br e www.gov.br, e informe o IP de saída abaixo.',
  no_internet:
    'O que fazer: confira o painel da Guara e abra um chamado informando que os servidores estão sem saída para a internet.',
  portal_down:
    'O que fazer: nada do nosso lado. Acompanhe o portal nacional; as notas ficam na fila e saem sozinhas quando ele voltar.',
  emission_failures:
    'O que fazer: acompanhe. Se continuar, abra um chamado na Guara com o IP de saída abaixo.',
};

const TITLE: Record<Exclude<PortalHealth, 'ok'>, string> = {
  gov_unreachable_from_us: 'Os servidores da Corvo não alcançam o governo',
  no_internet: 'Os servidores da Corvo estão sem internet',
  portal_down: 'O portal da NFS-e do governo está fora do ar',
  emission_failures: 'As notas estão falhando ao falar com o governo',
};

export const PROBE_LABELS: Record<string, string> = {
  sefin: 'sefin.nfse.gov.br',
  adn: 'adn.nfse.gov.br',
  govControl: 'www.gov.br',
  externalControl: 'site fora do governo',
};

const SAO_PAULO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'medium',
});
const when = (iso: string) => `${SAO_PAULO.format(new Date(iso))} (Brasília)`;

export function formatDuration(fromIso: string, toIso: string): string {
  const minutes = Math.max(
    Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000),
    0,
  );
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export interface PortalDownEmailInput {
  health: Exclude<PortalHealth, 'ok'>;
  since: string;
  /** Notes waiting in the queue or in reconciliation; null when it could not be counted. */
  waitingNotes: number | null;
  egressIp: string | null;
  /** Which tests failed, by their label. */
  failedProbes: string[];
}

export function portalDownEmail(input: PortalDownEmailInput): RenderedEmail {
  const rows: Array<[string, string]> = [
    ['Desde', when(input.since)],
    [
      'Notas esperando na fila',
      input.waitingNotes === null
        ? 'não foi possível contar'
        : String(input.waitingNotes),
    ],
  ];
  if (input.failedProbes.length)
    rows.push(['Não respondem', input.failedProbes.join(', ')]);
  if (input.egressIp) rows.push(['IP de saída dos servidores', input.egressIp]);
  return emailLayout(`[Corvo] ${TITLE[input.health]}`, [
    paragraph(EXPLANATION[input.health]),
    details(rows),
    paragraph(ACTION[input.health]),
    note(
      'Os clientes já veem o aviso no painel e as notas ficam guardadas. Você receberá outro e-mail quando a conexão voltar.',
    ),
  ]);
}

export interface PortalRecoveredEmailInput {
  health: Exclude<PortalHealth, 'ok'>;
  since: string;
  until: string;
}

export function portalRecoveredEmail(
  input: PortalRecoveredEmailInput,
): RenderedEmail {
  return emailLayout('[Corvo] A conexão com o governo voltou', [
    paragraph(
      `A conexão voltou ao normal. Problema: ${TITLE[input.health].toLowerCase()}.`,
    ),
    details([
      ['Começou', when(input.since)],
      ['Voltou', when(input.until)],
      ['Duração', formatDuration(input.since, input.until)],
    ]),
    note(
      'As notas que estavam na fila saem sozinhas, não é preciso fazer nada.',
    ),
  ]);
}
