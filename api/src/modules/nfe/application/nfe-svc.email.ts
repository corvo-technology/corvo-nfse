import {
  details,
  emailLayout,
  note,
  paragraph,
  type RenderedEmail,
} from '@/infra/external/email/email-templates';

export interface SvcEmailInput {
  uf: string;
  tpAmb: 1 | 2;
  /** `SVCAN` or `SVCRS`. */
  authority: string;
  /** Who left the SVC by hand (only in the "left" e-mail). */
  by?: string;
}

const rows = (input: SvcEmailInput): Array<[string, string]> => [
  ['Estado', input.uf],
  ['Ambiente', input.tpAmb === 1 ? 'Produção' : 'Homologação'],
  ['SEFAZ Virtual', input.authority === 'SVCAN' ? 'SVC-AN' : 'SVC-RS'],
];

/** To the platform operator: the NF-e of a UF started to go out through the SEFAZ Virtual de Contingência. */
export function svcEnteredEmail(input: SvcEmailInput): RenderedEmail {
  return emailLayout(`[Corvo] NF-e de ${input.uf} passou para a contingência`, [
    paragraph(
      `A SEFAZ de ${input.uf} não está respondendo e a SEFAZ Virtual de Contingência está no ar. As NF-e que ainda não tinham sido enviadas passam a sair pela contingência, com chave nova.`,
    ),
    details(rows(input)),
    note(
      'As notas que já tinham sido enviadas à SEFAZ de origem continuam esperando por ela e são conferidas pela chave. Você receberá outro e-mail quando a NF-e voltar ao normal.',
    ),
  ]);
}

/** To the platform operator: the NF-e of a UF is back to its own SEFAZ. */
export function svcExitedEmail(input: SvcEmailInput): RenderedEmail {
  return emailLayout(`[Corvo] NF-e de ${input.uf} voltou ao normal`, [
    paragraph(
      input.by
        ? `A contingência de ${input.uf} foi encerrada à mão por ${input.by}. As NF-e voltam a sair pela SEFAZ de origem.`
        : `A SEFAZ de ${input.uf} voltou a responder. As NF-e voltam a sair pela SEFAZ de origem.`,
    ),
    details(rows(input)),
    note(
      'As notas emitidas na contingência continuam válidas, não é preciso fazer nada.',
    ),
  ]);
}
