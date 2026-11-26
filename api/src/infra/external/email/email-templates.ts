/**
 * Corvo's transactional emails, written as plain TypeScript.
 * One function per email; the layout and blocks below keep them all alike.
 */

/** E-mail de contato exibido nos e-mails; self-hosted pode trocar via SUPPORT_EMAIL. */
export const supportEmail = (): string =>
  process.env.SUPPORT_EMAIL?.trim() || 'contato@corvo.tech';

export type RenderedEmail = { subject: string; html: string; text: string };

const LOGO_URL = 'https://www.corvo.tech/icon-192.png';
const GREEN = '#2f7a55';
const FONT = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** A piece of an email: the html to show and the same thing as plain text. */
type Block = { html: string; text: string };

export const paragraph = (value: string): Block => ({
  html: `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#3f3f46">${escapeHtml(value)}</p>`,
  text: value,
});

export const heading = (value: string): Block => ({
  html: `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#18181b">${escapeHtml(value)}</h1>`,
  text: value,
});

export const note = (value: string): Block => ({
  html: `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#71717a">${escapeHtml(value)}</p>`,
  text: value,
});

export const code = (value: string): Block => ({
  html: `<p style="margin:0 0 16px;padding:16px;text-align:center;font-size:36px;font-weight:700;letter-spacing:0.3em;color:${GREEN};background:#eaf6ee;border:1px solid #c9e6d3;border-radius:12px;font-family:ui-monospace,Menlo,Consolas,monospace">${escapeHtml(value)}</p>`,
  text: value,
});

export const button = (url: string, label: string): Block => ({
  html: `<p style="margin:0 0 16px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;background:${GREEN};border-radius:10px;text-decoration:none">${escapeHtml(label)}</a></p>`,
  text: `${label}: ${url}`,
});

/** Label/value lines, e.g. the details of an invoice. */
export const details = (rows: Array<[string, string]>): Block => ({
  html: `<table role="presentation" style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46">${rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:2px 16px 2px 0;color:#71717a;vertical-align:top">${escapeHtml(label)}</td><td style="padding:2px 0;word-break:break-all">${escapeHtml(value)}</td></tr>`,
    )
    .join('')}</table>`,
  text: rows.map(([label, value]) => `${label}: ${value}`).join('\n'),
});

/** The frame: grey background, logo and name on top, a white card with the content. */
export function emailLayout(
  subject: string,
  blocks: Block[],
  options: { logo?: boolean } = {},
): RenderedEmail {
  const { logo = true } = options;
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#fafafa;font-family:${FONT}">
<table role="presentation" width="100%" style="background:#fafafa"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px">
${
  logo
    ? `<tr><td style="padding:0 0 16px"><img src="${LOGO_URL}" width="32" height="32" alt="Corvo" style="vertical-align:middle;border-radius:8px"> <span style="vertical-align:middle;margin-left:8px;font-size:18px;font-weight:700;color:#18181b">Corvo</span></td></tr>`
    : ''
}
<tr><td style="padding:28px;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px">${blocks.map((b) => b.html).join('')}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text: blocks.map((b) => b.text).join('\n\n') };
}

export function otpEmail(input: {
  code: string;
  expiresInMinutes: number;
}): RenderedEmail {
  return emailLayout('Seu código de acesso ao Corvo', [
    paragraph('Digite este código para entrar no Corvo:'),
    code(input.code),
    note(
      `O código expira em ${input.expiresInMinutes} minutos. Se não foi você, ignore este e-mail.`,
    ),
  ]);
}

export function welcomeEmail(input: {
  name?: string;
  dashboardUrl: string;
}): RenderedEmail {
  return emailLayout('Bem-vindo ao Corvo', [
    paragraph(
      input.name?.trim()
        ? `Olá, ${input.name.trim()}! Sua conta no Corvo está pronta.`
        : 'Olá! Sua conta no Corvo está pronta.',
    ),
    button(input.dashboardUrl, 'Abrir o Corvo'),
  ]);
}

export function creditsLowEmail(input: {
  planName: string;
  remaining: number;
  total: number;
  billingUrl: string;
}): RenderedEmail {
  return emailLayout('Seus créditos estão acabando', [
    paragraph(
      `Restam ${input.remaining} de ${input.total} notas no plano ${input.planName}.`,
    ),
    button(input.billingUrl, 'Ver plano e créditos'),
  ]);
}

export function scheduleRetryEmail(input: {
  count: number;
  schedules: string;
  reason: string;
  billingUrl: string;
  schedulesUrl: string;
}): RenderedEmail {
  return emailLayout('Notas agendadas aguardando créditos', [
    paragraph(
      `${input.count} nota(s) agendada(s) não puderam ser emitidas: ${input.reason}`,
    ),
    paragraph(input.schedules),
    button(input.billingUrl, 'Ver plano e créditos'),
    note(`Também dá para revisar em ${input.schedulesUrl}`),
  ]);
}

export function schedulePausedEmail(input: {
  companyName: string;
  amount: string;
  reason: string;
  schedulesUrl: string;
}): RenderedEmail {
  return emailLayout('Uma nota recorrente foi pausada', [
    paragraph(
      `A nota recorrente de ${input.amount} da empresa ${input.companyName} foi pausada: ${input.reason}`,
    ),
    button(input.schedulesUrl, 'Ver notas agendadas'),
  ]);
}

export function nfseDocumentsReadyEmail(input: {
  companyName: string;
  customerName: string;
  amount: string;
  number: string;
  issueDate: string;
  description: string;
  accessKey: string;
  isTest: boolean;
}): RenderedEmail {
  const subject = `Sua nota fiscal nº ${input.number} - ${input.companyName}`;
  const email = emailLayout(
    subject,
    [
      heading('Sua nota fiscal está disponível'),
      paragraph(
        `Olá, ${input.customerName}! A empresa ${input.companyName} emitiu uma nota fiscal de serviços para você.`,
      ),
      details([
        ['Valor do serviço', input.amount],
        ['Número da nota', input.number],
        ['Data de emissão', input.issueDate],
        ['Serviço', input.description],
        ['Chave de acesso', input.accessKey],
      ]),
      paragraph(
        'Os documentos fiscais seguem anexados a este e-mail: NFS-e.pdf e NFS-e.xml. Este e-mail é apenas informativo, você não precisa fazer nada.',
      ),
      note(
        `Enviado automaticamente em nome de ${input.companyName}. Não responda este e-mail; em caso de dúvidas, entre em contato diretamente com o emissor da nota.`,
      ),
    ],
    { logo: false },
  );
  return input.isTest ? { ...email, subject: `[TESTE] ${subject}` } : email;
}

/** The NF-e (model 55) sent to the customer: same layout as the NFS-e one, with the key and series. */
export function nfeAuthorizedEmail(input: {
  companyName: string;
  customerName: string;
  amount: string;
  number: string;
  series: string;
  issueDate: string;
  accessKey: string;
  isTest: boolean;
}): RenderedEmail {
  const subject = `Sua nota fiscal eletrônica nº ${input.number} - ${input.companyName}`;
  const email = emailLayout(
    subject,
    [
      heading('Sua nota fiscal eletrônica está disponível'),
      paragraph(
        `Olá, ${input.customerName}! A empresa ${input.companyName} emitiu uma NF-e para você.`,
      ),
      details([
        ['Valor da nota', input.amount],
        ['Número', input.number],
        ['Série', input.series],
        ['Data de emissão', input.issueDate],
        ['Chave de acesso', input.accessKey],
      ]),
      paragraph(
        'Seguem anexos o XML da nota e o DANFE em PDF. Guarde o XML: ele é o documento fiscal. Este e-mail é apenas informativo, você não precisa fazer nada.',
      ),
      ...(input.isTest
        ? [
            note(
              'Nota emitida em ambiente de teste (homologação): não tem valor fiscal.',
            ),
          ]
        : []),
      note(
        `Enviado automaticamente em nome de ${input.companyName}. Não responda este e-mail; em caso de dúvidas, entre em contato diretamente com o emissor da nota.`,
      ),
    ],
    { logo: false },
  );
  return input.isTest ? { ...email, subject: `[TESTE] ${subject}` } : email;
}

/** The e-mail of an authorized NFC-e to the consumer who gave an address: the cupom (DANFCE) and the XML. */
export function nfceAuthorizedEmail(input: {
  companyName: string;
  customerName: string;
  amount: string;
  number: string;
  series: string;
  issueDate: string;
  accessKey: string;
  isTest: boolean;
}): RenderedEmail {
  const subject = `Sua NFC-e nº ${input.number} - ${input.companyName}`;
  const email = emailLayout(
    subject,
    [
      heading('Sua NFC-e está disponível'),
      paragraph(
        `${input.customerName ? `Olá, ${input.customerName}!` : 'Olá!'} A empresa ${input.companyName} emitiu uma NFC-e (nota fiscal de consumidor) para você.`,
      ),
      details([
        ['Valor da nota', input.amount],
        ['Número', input.number],
        ['Série', input.series],
        ['Data de emissão', input.issueDate],
        ['Chave de acesso', input.accessKey],
      ]),
      paragraph(
        'Seguem anexos o cupom (DANFCE) em PDF e o XML da nota. Guarde o XML: ele é o documento fiscal. Este e-mail é apenas informativo, você não precisa fazer nada.',
      ),
      ...(input.isTest
        ? [
            note(
              'Nota emitida em ambiente de teste (homologação): não tem valor fiscal.',
            ),
          ]
        : []),
      note(
        `Enviado automaticamente em nome de ${input.companyName}. Não responda este e-mail; em caso de dúvidas, entre em contato diretamente com o emissor da nota.`,
      ),
    ],
    { logo: false },
  );
  return input.isTest ? { ...email, subject: `[TESTE] ${subject}` } : email;
}

export function creditsAddedEmail(input: {
  units: number;
  billingUrl: string;
}): RenderedEmail {
  return emailLayout('Créditos adicionados', [
    paragraph(
      `${input.units} ${input.units === 1 ? 'nota foi adicionada' : 'notas foram adicionadas'} à sua conta.`,
    ),
    button(input.billingUrl, 'Ver créditos'),
  ]);
}

export function invoiceRejectedEmail(input: {
  reason: string;
  invoiceUrl: string;
}): RenderedEmail {
  return emailLayout('Uma nota foi rejeitada', [
    paragraph('Uma nota fiscal foi rejeitada e precisa de revisão.'),
    paragraph(`Motivo: ${input.reason}`),
    button(input.invoiceUrl, 'Revisar nota'),
    note(
      'Se outras notas forem rejeitadas na próxima hora, não enviaremos novos avisos: veja todas no painel.',
    ),
  ]);
}

export function apiKeyCreatedEmail(input: {
  name: string;
  keysUrl: string;
}): RenderedEmail {
  return emailLayout('Nova chave de API criada', [
    paragraph(
      `Uma chave de API de produção chamada "${input.name}" foi criada na sua conta.`,
    ),
    button(input.keysUrl, 'Ver chaves de API'),
    note('Se não foi você ou alguém da sua equipe, revogue a chave agora.'),
  ]);
}

export function mcpConnectedEmail(input: {
  clientName: string;
  connectionsUrl: string;
}): RenderedEmail {
  return emailLayout('Novo aplicativo conectado', [
    paragraph(`${input.clientName} foi conectado à sua conta em produção.`),
    button(input.connectionsUrl, 'Ver conexões'),
    note('Se não reconhece essa conexão, desconecte-a agora.'),
  ]);
}

export function creditsExhaustedEmail(input: {
  billingUrl: string;
}): RenderedEmail {
  return emailLayout('Seus créditos acabaram', [
    paragraph(
      'Você usou todas as notas disponíveis e não conseguimos emitir uma nota.',
    ),
    paragraph('Adicione notas ou mude de plano para voltar a emitir.'),
    button(input.billingUrl, 'Adicionar créditos'),
  ]);
}

export function paymentFailedEmail(input: {
  billingUrl: string;
}): RenderedEmail {
  return emailLayout('Não conseguimos cobrar sua assinatura', [
    paragraph('O pagamento da sua assinatura do Corvo falhou.'),
    paragraph(
      'Atualize a forma de pagamento para não perder o acesso ao plano.',
    ),
    button(input.billingUrl, 'Atualizar pagamento'),
  ]);
}

export function subscriptionCanceledEmail(input: {
  billingUrl: string;
}): RenderedEmail {
  return emailLayout('Sua assinatura foi cancelada', [
    paragraph(
      'Sua assinatura do Corvo foi cancelada. Veja seu plano e seus créditos na página de cobrança.',
    ),
    button(input.billingUrl, 'Ver planos'),
  ]);
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'administrador',
  developer: 'desenvolvedor',
  billing: 'cobrança',
};

export function memberInvitedEmail(input: {
  name?: string;
  role: string;
  inviterName?: string;
  acceptUrl: string;
}): RenderedEmail {
  const who = input.inviterName
    ? `${input.inviterName} convidou você`
    : 'Você foi convidado';
  return emailLayout('Convite para uma conta no Corvo', [
    ...(input.name?.trim() ? [paragraph(`Olá, ${input.name.trim()}.`)] : []),
    paragraph(
      `${who} para uma conta no Corvo como ${ROLE_LABELS[input.role] ?? input.role}.`,
    ),
    paragraph(
      'Entre com este mesmo e-mail e aceite o convite. O link vale por 7 dias e só pode ser usado uma vez.',
    ),
    button(input.acceptUrl, 'Aceitar convite'),
    paragraph('Se você não esperava este convite, ignore este e-mail.'),
  ]);
}

export function memberJoinedEmail(input: {
  name: string;
  email: string;
  role: string;
  membersUrl: string;
}): RenderedEmail {
  return emailLayout('Convite aceito', [
    paragraph(
      `${input.name || input.email} (${input.email}) aceitou o convite e já tem acesso à conta como ${ROLE_LABELS[input.role] ?? input.role}.`,
    ),
    paragraph(
      'Se não reconhece essa pessoa, remova o acesso na página de membros.',
    ),
    button(input.membersUrl, 'Ver membros'),
  ]);
}

export function certificateExpiringEmail(input: {
  companyName: string;
  stage: 30 | 7 | 0;
  validUntil: string;
  certificateUrl: string;
}): RenderedEmail {
  if (input.stage === 0)
    return emailLayout('Certificado digital vencido', [
      paragraph(
        `O certificado digital da empresa ${input.companyName} venceu em ${input.validUntil}. Enquanto não for trocado, não é possível emitir notas.`,
      ),
      button(input.certificateUrl, 'Enviar novo certificado'),
    ]);
  return emailLayout(`Certificado digital vence em ${input.stage} dias`, [
    paragraph(
      `O certificado digital da empresa ${input.companyName} vence em ${input.validUntil}. Depois dessa data não será possível emitir notas.`,
    ),
    button(input.certificateUrl, 'Enviar novo certificado'),
  ]);
}

/** `NFS-e 123`, or just "A nota" when the number is not known. */
function invoiceLabel(nfseNumber: number | null): string {
  return nfseNumber ? `A NFS-e ${nfseNumber}` : 'Uma nota';
}

export function invoiceCancelledOnPortalEmail(input: {
  nfseNumber: number | null;
  reason: string | null;
  invoiceUrl: string;
}): RenderedEmail {
  return emailLayout('Uma nota foi cancelada no portal', [
    paragraph(
      `${invoiceLabel(input.nfseNumber)} foi cancelada direto no portal nacional da NFS-e, não pelo Corvo. Ela já aparece como cancelada no painel.`,
    ),
    ...(input.reason ? [paragraph(`Motivo informado: ${input.reason}`)] : []),
    button(input.invoiceUrl, 'Ver nota'),
  ]);
}

export function invoiceRejectedByTakerEmail(input: {
  nfseNumber: number | null;
  reason: string | null;
  invoiceUrl: string;
}): RenderedEmail {
  return emailLayout('O cliente rejeitou uma nota', [
    paragraph(
      `${invoiceLabel(input.nfseNumber)} foi rejeitada pelo tomador no portal nacional. Ela continua autorizada, mas vale conversar com o cliente.`,
    ),
    ...(input.reason ? [paragraph(`Motivo informado: ${input.reason}`)] : []),
    button(input.invoiceUrl, 'Ver nota'),
  ]);
}

export function invoiceBlockedOnPortalEmail(input: {
  nfseNumber: number | null;
  invoiceUrl: string;
}): RenderedEmail {
  return emailLayout('Uma nota foi bloqueada pelo município', [
    paragraph(
      `${invoiceLabel(input.nfseNumber)} foi bloqueada pelo município por ofício. Ela continua autorizada, mas procure a prefeitura para entender o motivo.`,
    ),
    button(input.invoiceUrl, 'Ver nota'),
  ]);
}

/** A webhook gave up after every retry. No url, secret or body: only which event, and where to look. */
export function webhookDeliveryFailedEmail(input: {
  eventType: string;
  webhooksUrl: string;
}): RenderedEmail {
  return emailLayout('Um aviso (webhook) não chegou ao seu sistema', [
    paragraph(
      `Tentamos enviar o aviso "${input.eventType}" ao seu sistema várias vezes e não conseguimos. Por isso paramos de tentar.`,
    ),
    paragraph(
      'Veja o que aconteceu e envie de novo quando seu sistema estiver funcionando.',
    ),
    note('Você recebe no máximo um e-mail por hora para cada webhook.'),
    button(input.webhooksUrl, 'Ver avisos enviados'),
  ]);
}

export function pixExpiredEmail(input: { billingUrl: string }): RenderedEmail {
  return emailLayout('Seu Pix expirou', [
    paragraph(
      'O Pix que você gerou no Corvo expirou sem ser pago, e nada foi cobrado.',
    ),
    paragraph('Se ainda quiser comprar, gere um novo Pix.'),
    button(input.billingUrl, 'Gerar novo Pix'),
  ]);
}

export function paymentMismatchEmail(input: {
  billingUrl: string;
}): RenderedEmail {
  return emailLayout('Recebemos um valor diferente no seu Pix', [
    paragraph(
      'O valor pago no Pix é diferente do valor da cobrança, por isso não liberamos os créditos nem o plano.',
    ),
    paragraph(
      `Escreva para ${supportEmail()} para resolvermos, ou gere um novo Pix com o valor correto.`,
    ),
    button(input.billingUrl, 'Ver cobrança'),
  ]);
}

/** The month package for the accountant: a download link, never an attachment. */
export function accountantPackageEmail(input: {
  companyName: string;
  companyTaxId: string;
  /** "novembro de 2026" */
  monthLabel: string;
  count: number;
  /** "R$ 12.345,67" */
  total: string;
  downloadUrl: string;
  /** "18/11/2026" */
  expiresOn: string;
}): RenderedEmail {
  const cnpj =
    input.companyTaxId.length === 14
      ? input.companyTaxId.replace(
          /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
          '$1.$2.$3/$4-$5',
        )
      : input.companyTaxId;
  return emailLayout(
    `Notas fiscais de ${input.companyName}, ${input.monthLabel}`,
    [
      paragraph(
        `${input.companyName} (CNPJ ${cnpj}) enviou o pacote das notas fiscais de serviço (NFS-e) de ${input.monthLabel}.`,
      ),
      details([
        ['Notas', String(input.count)],
        ['Valor total', input.total],
      ]),
      paragraph(
        'O pacote traz o XML e o PDF de cada nota e uma planilha de resumo (resumo.csv). O valor total não inclui as notas canceladas.',
      ),
      button(input.downloadUrl, 'Baixar o pacote'),
      note(
        `O link vale até ${input.expiresOn} e abre sem login. Não o encaminhe a quem não deva ver essas notas.`,
      ),
    ],
  );
}

function formatTaxId(taxId: string): string {
  return taxId.length === 14
    ? taxId.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : taxId;
}

/** Sent once to an accountant's address when a company sets it, so a wrong address is noticed. */
export function accountantWelcomeEmail(input: {
  companyName: string;
  companyTaxId: string;
}): RenderedEmail {
  return emailLayout('Você vai receber as notas fiscais de uma empresa', [
    paragraph(
      `A empresa ${input.companyName} (CNPJ ${formatTaxId(input.companyTaxId)}) vai enviar as notas fiscais do mês para este e-mail todo dia 1º pela Corvo.`,
    ),
    note('Se não for você, ignore este e-mail e avise a empresa.'),
  ]);
}

export function accountantPackageEmptyEmail(input: {
  companyName: string;
  monthLabel: string;
  companyUrl: string;
}): RenderedEmail {
  return emailLayout('Não enviamos o pacote ao contador', [
    paragraph(
      `Não enviamos ao seu contador o pacote de ${input.monthLabel} da empresa ${input.companyName} porque não houve notas no mês.`,
    ),
    paragraph(
      'Se você emitiu notas por outro meio, avise o contador por conta própria.',
    ),
    button(input.companyUrl, 'Abrir a empresa'),
  ]);
}

export function accountantPackageTooLargeEmail(input: {
  companyName: string;
  monthLabel: string;
  count: number;
  limit: number;
  companyUrl: string;
}): RenderedEmail {
  return emailLayout('O pacote do contador ficou grande demais', [
    paragraph(
      `Não enviamos ao seu contador o pacote de ${input.monthLabel} da empresa ${input.companyName}: o mês teve ${input.count} notas e o pacote comporta até ${input.limit}.`,
    ),
    paragraph(
      `Escreva para ${supportEmail()} que enviamos o pacote em partes.`,
    ),
    button(input.companyUrl, 'Abrir a empresa'),
  ]);
}

export function accountantPackageFailedEmail(input: {
  companyName: string;
  monthLabel: string;
  companyUrl: string;
}): RenderedEmail {
  return emailLayout('Não conseguimos enviar o pacote ao contador', [
    paragraph(
      `Não conseguimos enviar ao seu contador o pacote de ${input.monthLabel} da empresa ${input.companyName}.`,
    ),
    paragraph(
      'Você pode baixar o pacote no painel ou tentar o envio de novo pela página da empresa.',
    ),
    button(input.companyUrl, 'Abrir a empresa'),
  ]);
}
