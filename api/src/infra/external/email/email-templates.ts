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
  return emailLayout('Sua conta no Corvo está pronta', [
    paragraph(
      input.name?.trim()
        ? `Olá, ${input.name.trim()}. Sua conta no Corvo está pronta.`
        : 'Olá. Sua conta no Corvo está pronta.',
    ),
    button(input.dashboardUrl, 'Abrir o Corvo'),
  ]);
}

export function creditsLowEmail(input: {
  planName: string;
  remaining: number;
  total: number;
  billingUrl: string;
  /** Days until the credits run out at the recent pace; left out when there is not enough history. */
  daysLeft?: number | null;
}): RenderedEmail {
  const blocks = [
    paragraph(
      `Restam ${input.remaining} de ${input.total} notas no plano ${input.planName}.`,
    ),
  ];
  if (input.daysLeft != null && input.daysLeft > 0)
    blocks.push(
      paragraph(
        `No ritmo atual, seus créditos acabam em ~${input.daysLeft} ${input.daysLeft === 1 ? 'dia' : 'dias'}.`,
      ),
    );
  blocks.push(button(input.billingUrl, 'Comprar créditos'));
  return emailLayout('Seus créditos estão acabando', blocks);
}

export function scheduleRetryEmail(input: {
  count: number;
  schedules: string;
  reason: string;
  billingUrl: string;
  schedulesUrl: string;
}): RenderedEmail {
  return emailLayout('Notas agendadas não foram emitidas', [
    paragraph(
      `${input.count} ${input.count === 1 ? 'nota agendada não foi emitida' : 'notas agendadas não foram emitidas'}: ${input.reason}`,
    ),
    paragraph(input.schedules),
    button(input.billingUrl, 'Ver plano e créditos'),
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

const LOWERCASE_WORDS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);

/** "PEDRO HENRIQUE DA SILVA" becomes "Pedro Henrique da Silva". Names already in mixed case stay as they are. */
export function toTitleCase(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean !== clean.toLocaleUpperCase('pt-BR')) return clean;
  return clean
    .toLocaleLowerCase('pt-BR')
    .split(' ')
    .map((word, i) =>
      i > 0 && LOWERCASE_WORDS.has(word)
        ? word
        : word.charAt(0).toLocaleUpperCase('pt-BR') + word.slice(1),
    )
    .join(' ');
}

/** One line of plain text: no line breaks or control characters, so nothing can end up in another header. */
function singleLine(value: string): string {
  return Array.from(value)
    .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

const DISPLAY_NAME_MAX = 64;

/** A company name that is safe to show as the sender name: one line, no quotes, brackets or backslashes, at most 64 characters. */
export function senderDisplayName(name: string | null | undefined): string {
  const clean = singleLine(name ?? '')
    .replace(/["<>\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DISPLAY_NAME_MAX)
    .trim();
  return clean || 'Corvo';
}

const NEEDS_QUOTING = /[()<>[\]:;@,."]/;

/** `Greenflow <noreply@corvo.tech>`; the name is quoted (RFC 5322) only when it has special characters. */
export function formatFromHeader(
  displayName: string | null | undefined,
  address: string,
): string {
  const name = senderDisplayName(displayName);
  const shown = NEEDS_QUOTING.test(name) ? `"${name}"` : name;
  return `${shown} <${address}>`;
}

const SERVICE_MAX = 140;

function truncate(value: string, max: number): string {
  const clean = singleLine(value);
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export type InvoiceEmailRow = { label: string; value: string };

/** The e-mail that delivers an invoice to the taker. It looks like it comes from the issuing company, not from Corvo. */
function invoiceEmailLayout(input: {
  subject: string;
  greeting: string;
  headline: string;
  rows: InvoiceEmailRow[];
  service: { description: string; amount: string };
  attachmentsLine: string;
  footer: string;
}): RenderedEmail {
  const rowsHtml = input.rows
    .map(
      (r) =>
        `<tr><td style="padding:4px 16px 4px 0;font-size:14px;color:#6b7280;vertical-align:top;white-space:nowrap">${escapeHtml(r.label)}</td><td style="padding:4px 0;font-size:14px;color:#111827;text-align:right;vertical-align:top;word-break:break-word">${escapeHtml(r.value)}</td></tr>`,
    )
    .join('');
  const divider =
    '<div style="margin:16px 0;border-top:1px solid #ececec"></div>';
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:${FONT}">
<table role="presentation" width="100%" style="background:#f5f5f5"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px">
<tr><td style="padding:28px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px">
<p style="margin:0 0 4px;font-size:16px;line-height:1.5;color:#111827">${escapeHtml(input.greeting)}</p>
<p style="margin:0;font-size:18px;font-weight:700;line-height:1.4;color:#111827">${escapeHtml(input.headline)}</p>
${divider}
<table role="presentation" width="100%" style="border-collapse:collapse">${rowsHtml}</table>
${divider}
<table role="presentation" width="100%" style="border-collapse:collapse"><tr><td style="padding:0 16px 0 0;font-size:14px;font-weight:700;color:#111827;vertical-align:top;word-break:break-word">${escapeHtml(input.service.description)}</td><td style="padding:0;font-size:14px;font-weight:700;color:#111827;text-align:right;vertical-align:top;white-space:nowrap">${escapeHtml(input.service.amount)}</td></tr></table>
<p style="margin:16px 0 0;font-size:14px;line-height:1.5;color:#374151">${escapeHtml(input.attachmentsLine)}</p>
</td></tr>
<tr><td style="padding:16px 8px 0;font-size:12px;line-height:1.5;color:#9ca3af;text-align:center">${escapeHtml(input.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    `${input.greeting}\n${input.headline}`,
    input.rows.map((r) => `${r.label}: ${r.value}`).join('\n'),
    `${input.service.description}: ${input.service.amount}`,
    input.attachmentsLine,
    input.footer,
  ].join('\n\n');
  return { subject: input.subject, html, text };
}

function invoiceFooter(company: string): string {
  return `Este e-mail foi enviado pelo sistema de emissão de nota fiscal Corvo. Em caso de dúvidas, fale direto com ${company}.`;
}

function invoiceGreeting(customerName: string | null | undefined): string {
  const name = toTitleCase(customerName ?? '');
  return name ? `Olá, ${name},` : 'Olá,';
}

export function nfseDocumentsReadyEmail(input: {
  companyName: string;
  customerName: string;
  amount: string;
  number: string;
  issueDate: string;
  description: string;
  /** Authorization protocol, shown only when we have one. */
  protocol?: string | null;
  isTest: boolean;
}): RenderedEmail {
  const company = senderDisplayName(input.companyName);
  const rows: InvoiceEmailRow[] = [
    { label: 'Emitente', value: company },
    { label: 'Número', value: input.number },
    { label: 'Data de emissão', value: input.issueDate },
  ];
  const protocol = input.protocol?.trim();
  if (protocol)
    rows.push({ label: 'Protocolo de autorização', value: protocol });
  const subject = `${company} - Sua nota fiscal nº ${singleLine(input.number)}`;
  return invoiceEmailLayout({
    subject: input.isTest ? `[TESTE] ${subject}` : subject,
    greeting: invoiceGreeting(input.customerName),
    headline: 'Você recebeu uma nota fiscal',
    rows,
    service: {
      description: truncate(input.description, SERVICE_MAX),
      amount: input.amount,
    },
    attachmentsLine: 'O PDF e o XML da nota estão anexados a este e-mail.',
    footer: invoiceFooter(company),
  });
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
    paragraph(
      `Uma nota fiscal foi rejeitada e precisa de revisão. Motivo: ${input.reason}`,
    ),
    button(input.invoiceUrl, 'Revisar nota'),
    note(
      'Se outras notas forem rejeitadas na próxima hora, não enviaremos novos avisos: veja todas no painel.',
    ),
  ]);
}

/** Rejected note, with the reason in plain words and a way back to fix it. */
export function invoiceRejectedHelpEmail(input: {
  reason: string;
  invoiceUrl: string;
}): RenderedEmail {
  return emailLayout('Uma nota foi rejeitada', [
    paragraph('Uma nota fiscal foi rejeitada pelo governo e não foi emitida.'),
    paragraph(`O que aconteceu: ${input.reason}`),
    button(input.invoiceUrl, 'Corrigir e emitir de novo'),
    note(
      'Se outras notas forem rejeitadas na próxima hora, não enviaremos novos avisos: veja todas no painel.',
    ),
  ]);
}

/** Sent once per workspace, when the first live invoice is authorized. */
export function firstInvoiceEmail(input: {
  customerEmailed: boolean;
  integrationsUrl: string;
}): RenderedEmail {
  return emailLayout('Sua primeira nota fiscal saiu', [
    paragraph('Parabéns: sua primeira nota fiscal pelo Corvo foi autorizada.'),
    paragraph(
      input.customerEmailed
        ? 'Ela já foi enviada por e-mail ao seu cliente.'
        : 'Você pode baixar o PDF e o XML na página da nota.',
    ),
    paragraph(
      'Para dar menos trabalho nas próximas, conecte a sua cobrança, agende as notas que se repetem ou cadastre o seu contador.',
    ),
    button(input.integrationsUrl, 'Conectar minha cobrança'),
  ]);
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** First day of the month: what was issued in the month that ended. */
export function monthlySummaryEmail(input: {
  monthLabel: string;
  count: number;
  total: string;
  topCustomers: string[];
  rejected: number;
  creditsRemaining: number;
  hasAccountant: boolean;
  accountantUrl: string;
}): RenderedEmail {
  const blocks = [
    paragraph(
      `Em ${input.monthLabel} você emitiu ${plural(input.count, 'nota', 'notas')}, somando ${input.total}.`,
    ),
  ];
  if (input.topCustomers.length > 0)
    blocks.push(
      paragraph(
        `${input.topCustomers.length === 1 ? 'Cliente' : 'Clientes'} de maior valor: ${input.topCustomers.join(', ')}.`,
      ),
    );
  if (input.rejected > 0)
    blocks.push(
      paragraph(
        `${plural(input.rejected, 'nota foi rejeitada', 'notas foram rejeitadas')} pelo governo e não ${input.rejected === 1 ? 'foi emitida' : 'foram emitidas'}.`,
      ),
    );
  blocks.push(
    paragraph(
      `Ainda restam ${plural(input.creditsRemaining, 'nota', 'notas')} na sua conta.`,
    ),
    button(
      input.accountantUrl,
      input.hasAccountant ? 'Enviar ao contador' : 'Cadastrar contador',
    ),
  );
  return emailLayout(
    `Resumo de ${input.monthLabel}: ${plural(input.count, 'nota emitida', 'notas emitidas')}`,
    blocks,
  );
}

/** One reminder, a day after a checkout was started and not paid. */
export function paymentPendingEmail(input: {
  what: string;
  billingUrl: string;
}): RenderedEmail {
  return emailLayout('Seu pagamento ficou pendente', [
    paragraph(
      `Você começou a comprar ${input.what}, mas o pagamento não foi concluído. Nada foi cobrado.`,
    ),
    button(input.billingUrl, 'Tentar de novo'),
    note(
      'Se desistiu, é só ignorar este e-mail. Não enviaremos outro lembrete desta compra.',
    ),
  ]);
}

/** A sale from a payment platform that could not become an invoice. Reason and next step in plain words. */
export function integrationSaleNeedsAttentionEmail(input: {
  platform: string;
  amount: string;
  date: string;
  buyerName: string | null;
  reasonTitle: string;
  reasonAction: string;
  saleUrl: string;
  pendingCount: number;
}): RenderedEmail {
  const rows: Array<[string, string]> = [
    ['Plataforma', input.platform],
    ['Valor', input.amount],
    ['Data', input.date],
  ];
  if (input.buyerName) rows.push(['Cliente', input.buyerName]);
  return emailLayout('Uma venda está esperando você para virar nota', [
    paragraph(
      `Recebemos uma venda de ${input.platform}, mas ainda não conseguimos emitir a nota fiscal dela.`,
    ),
    details(rows),
    paragraph(`O que aconteceu: ${input.reasonTitle}`),
    paragraph(`O que fazer: ${input.reasonAction}`),
    button(input.saleUrl, 'Resolver esta venda'),
    ...(input.pendingCount > 1
      ? [
          note(
            `Você tem ${input.pendingCount} vendas esperando. Veja todas no painel.`,
          ),
        ]
      : []),
  ]);
}

/** One e-mail a day when many sales wait, instead of one per sale. */
export function integrationSalesDigestEmail(input: {
  count: number;
  listUrl: string;
}): RenderedEmail {
  return emailLayout('Vendas esperando você para virar nota', [
    paragraph(
      `Você tem ${input.count} ${input.count === 1 ? 'venda' : 'vendas'} das integrações que ainda não viraram nota fiscal.`,
    ),
    paragraph('Abra cada uma, complete os dados e emita a nota.'),
    button(input.listUrl, 'Ver vendas pendentes'),
    note(
      'Para não lotar sua caixa de entrada, enviamos no máximo 1 resumo por dia.',
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
      'Você usou todas as notas e não conseguimos emitir uma nota. Adicione notas ou mude de plano para voltar a emitir.',
    ),
    button(input.billingUrl, 'Adicionar créditos'),
  ]);
}

export function paymentFailedEmail(input: {
  billingUrl: string;
}): RenderedEmail {
  return emailLayout('Não conseguimos cobrar sua assinatura', [
    paragraph(
      'O pagamento da sua assinatura falhou. Atualize a forma de pagamento para não perder o plano.',
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
    button(input.acceptUrl, 'Aceitar convite'),
    note(
      'Entre com este mesmo e-mail. O link vale por 7 dias e só pode ser usado uma vez. Se não esperava o convite, ignore este e-mail.',
    ),
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
    button(input.membersUrl, 'Ver membros'),
    note('Se não reconhece essa pessoa, remova o acesso na página de membros.'),
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
  return emailLayout('Um aviso não chegou ao seu sistema', [
    paragraph(
      `Tentamos enviar o aviso "${input.eventType}" ao seu sistema várias vezes e não conseguimos. Envie de novo quando ele voltar a funcionar.`,
    ),
    button(input.webhooksUrl, 'Ver avisos enviados'),
    note('Você recebe no máximo um e-mail por hora para cada webhook.'),
  ]);
}

export function pixExpiredEmail(input: { billingUrl: string }): RenderedEmail {
  return emailLayout('Seu Pix expirou', [
    paragraph(
      'O Pix expirou sem ser pago e nada foi cobrado. Se ainda quiser comprar, gere um novo.',
    ),
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
