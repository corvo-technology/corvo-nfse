/**
 * Corvo's transactional emails, written as plain TypeScript.
 * One function per email; the layout and blocks below keep them all alike.
 */

export type RenderedEmail = { subject: string; html: string; text: string };

const LOGO_URL = 'https://corvo.tech/icon-192.png';
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
  name: string;
  dashboardUrl: string;
}): RenderedEmail {
  return emailLayout('Bem-vindo ao Corvo', [
    paragraph(`Olá, ${input.name}! Sua conta no Corvo está pronta.`),
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
      'Sua assinatura do Corvo foi cancelada e sua conta voltou ao plano gratuito.',
    ),
    button(input.billingUrl, 'Ver planos'),
  ]);
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'administrador',
  developer: 'desenvolvedor',
  billing: 'cobrança',
};

export function memberAddedEmail(input: {
  role: string;
  appUrl: string;
}): RenderedEmail {
  return emailLayout('Você foi adicionado a uma conta no Corvo', [
    paragraph(
      `Você foi adicionado a uma conta no Corvo como ${ROLE_LABELS[input.role] ?? input.role}.`,
    ),
    paragraph(
      'Entre com este e-mail para acessar. Enviaremos um código de acesso.',
    ),
    button(input.appUrl, 'Entrar no Corvo'),
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
