import {
  creditsLowEmail,
  firstInvoiceEmail,
  invoiceRejectedHelpEmail,
  monthlySummaryEmail,
  paymentPendingEmail,
  emailLayout,
  formatFromHeader,
  nfseDocumentsReadyEmail,
  otpEmail,
  paragraph,
  schedulePausedEmail,
  scheduleRetryEmail,
  senderDisplayName,
  toTitleCase,
  welcomeEmail,
} from './email-templates';

const nfse = {
  companyName: 'Acme',
  customerName: 'Ana',
  amount: 'R$ 100,00',
  number: '42',
  issueDate: '07/11/2026',
  description: 'Consultoria',
};

describe('email templates', () => {
  it('wraps every email with the Corvo logo', () => {
    expect(otpEmail({ code: '123456', expiresInMinutes: 10 }).html).toContain(
      'https://www.corvo.tech/icon-192.png',
    );
  });

  it('shows the code in html and text', () => {
    const email = otpEmail({ code: '382815', expiresInMinutes: 10 });
    expect(email.html).toContain('382815');
    expect(email.text).toContain('382815');
    expect(email.text).toContain('10 minutos');
  });

  it('greets by name when there is one, and never invents one when there is not', () => {
    const named = welcomeEmail({
      name: 'Maria',
      dashboardUrl: 'https://x.test',
    });
    expect(named.text).toContain('Olá, Maria.');
    for (const name of ['', '   ', undefined]) {
      const email = welcomeEmail({ name, dashboardUrl: 'https://x.test' });
      expect(email.text).toContain('Olá. Sua conta');
      expect(email.text).not.toContain('Olá, .');
    }
  });

  it('escapes user-provided text', () => {
    const email = welcomeEmail({
      name: '<script>x</script>',
      dashboardUrl: 'https://corvo.tech/app',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('keeps the link in the button and in the text', () => {
    const email = creditsLowEmail({
      planName: 'Pro',
      remaining: 3,
      total: 100,
      billingUrl: 'https://corvo.tech/app/billing',
    });
    expect(email.html).toContain('href="https://corvo.tech/app/billing"');
    expect(email.text).toContain('https://corvo.tech/app/billing');
    expect(email.html).toContain('Comprar créditos');
  });

  it('says in how many days the credits end, only when it is known', () => {
    const base = {
      planName: 'Pro',
      remaining: 3,
      total: 100,
      billingUrl: 'https://corvo.tech/app/billing',
    };
    expect(creditsLowEmail({ ...base, daysLeft: 4 }).text).toContain(
      'No ritmo atual, seus créditos acabam em ~4 dias.',
    );
    expect(creditsLowEmail({ ...base, daysLeft: 1 }).text).toContain('~1 dia.');
    expect(creditsLowEmail(base).text).not.toContain('No ritmo atual');
    expect(creditsLowEmail({ ...base, daysLeft: null }).text).not.toContain(
      'No ritmo atual',
    );
  });

  it('explains a rejected invoice and links to the fix', () => {
    const email = invoiceRejectedHelpEmail({
      reason: 'Tire o número do cadastro.',
      invoiceUrl: 'https://corvo.tech/app/invoices/i1',
    });
    expect(email.subject).toBe('Uma nota foi rejeitada');
    expect(email.text).toContain('O que aconteceu: Tire o número do cadastro.');
    expect(email.html).toContain('href="https://corvo.tech/app/invoices/i1"');
    expect(email.html).toContain('Corrigir e emitir de novo');
    expect(email.text).not.toContain('!');
  });

  it('congratulates on the first invoice and points to the billing integration', () => {
    const sent = firstInvoiceEmail({
      customerEmailed: true,
      integrationsUrl: 'https://corvo.tech/app/integrations',
    });
    expect(sent.subject).toBe('Sua primeira nota fiscal saiu');
    expect(sent.text).toContain('enviada por e-mail ao seu cliente');
    expect(sent.text).toContain('agende as notas que se repetem');
    expect(sent.text).toContain('cadastre o seu contador');
    expect(sent.html).toContain('href="https://corvo.tech/app/integrations"');
    expect(sent.html).toContain('Conectar minha cobrança');
    expect(sent.text).not.toContain('!');
    expect(
      firstInvoiceEmail({
        customerEmailed: false,
        integrationsUrl: 'https://x/i',
      }).text,
    ).toContain('baixar o PDF e o XML');
  });

  it('summarizes the month with the accountant button that fits', () => {
    const input = {
      monthLabel: 'outubro de 2026',
      count: 12,
      total: 'R$ 3.450,00',
      topCustomers: ['Ana Silva', 'Beta Ltda', 'Casa Verde'],
      rejected: 2,
      creditsRemaining: 38,
      accountantUrl: 'https://corvo.tech/app/companies/c1',
    };
    const withAccountant = monthlySummaryEmail({
      ...input,
      hasAccountant: true,
    });
    expect(withAccountant.subject).toBe(
      'Resumo de outubro de 2026: 12 notas emitidas',
    );
    expect(withAccountant.text).toContain('12 notas, somando R$ 3.450,00');
    expect(withAccountant.text).toContain(
      'Clientes de maior valor: Ana Silva, Beta Ltda, Casa Verde.',
    );
    expect(withAccountant.text).toContain('2 notas foram rejeitadas');
    expect(withAccountant.text).toContain('Ainda restam 38 notas');
    expect(withAccountant.html).toContain('Enviar ao contador');
    expect(withAccountant.html).toContain(
      'href="https://corvo.tech/app/companies/c1"',
    );
    const without = monthlySummaryEmail({
      ...input,
      count: 1,
      rejected: 0,
      topCustomers: ['Ana Silva'],
      hasAccountant: false,
    });
    expect(without.subject).toBe('Resumo de outubro de 2026: 1 nota emitida');
    expect(without.html).toContain('Cadastrar contador');
    expect(without.text).toContain('Cliente de maior valor: Ana Silva.');
    expect(without.text).not.toContain('rejeitada');
    expect(without.text).not.toContain('!');
  });

  it('reminds about an unpaid purchase and says nothing was charged', () => {
    const email = paymentPendingEmail({
      what: '50 notas',
      billingUrl: 'https://corvo.tech/app/billing',
    });
    expect(email.subject).toBe('Seu pagamento ficou pendente');
    expect(email.text).toContain('comprar 50 notas');
    expect(email.text).toContain('Nada foi cobrado');
    expect(email.html).toContain('href="https://corvo.tech/app/billing"');
    expect(email.html).toContain('Tentar de novo');
    expect(email.text).not.toContain('!');
  });

  it('builds the schedule emails', () => {
    expect(
      scheduleRetryEmail({
        count: 2,
        schedules: 'Mensal',
        reason: 'sem créditos',
        billingUrl: 'https://x/b',
        schedulesUrl: 'https://x/s',
      }).text,
    ).toContain('sem créditos');
    expect(
      schedulePausedEmail({
        companyName: 'Acme',
        amount: 'R$ 10,00',
        reason: 'falhou',
        schedulesUrl: 'https://x/s',
      }).subject,
    ).toBe('Uma nota recorrente foi pausada');
  });

  it('marks only test invoices with [TESTE]', () => {
    expect(nfseDocumentsReadyEmail({ ...nfse, isTest: true }).subject).toMatch(
      /^\[TESTE\] /,
    );
    expect(
      nfseDocumentsReadyEmail({ ...nfse, isTest: false }).subject,
    ).not.toContain('[TESTE]');
  });

  it('writes the invoice email as the issuing company, not as Corvo', () => {
    const email = nfseDocumentsReadyEmail({
      ...nfse,
      companyName: 'Greenflow',
      customerName: 'PEDRO HENRIQUE DA SILVA',
      amount: 'R$ 1.500,00',
      isTest: false,
    });
    expect(email.subject).toBe('Greenflow - Sua nota fiscal nº 42');
    expect(email.text).toContain('Olá, Pedro Henrique da Silva,');
    expect(email.text).toContain('Você recebeu uma nota fiscal');
    expect(email.text).toContain('Emitente: Greenflow');
    expect(email.text).toContain('Número: 42');
    expect(email.text).toContain('Data de emissão: 07/11/2026');
    expect(email.text).toContain('Consultoria: R$ 1.500,00');
    expect(email.text).toContain(
      'Este e-mail foi enviado pelo sistema de emissão de nota fiscal Corvo. Em caso de dúvidas, fale direto com Greenflow.',
    );
    expect(email.html).not.toContain('icon-192.png');
    expect(email.html).not.toContain('#2f7a55');
    expect(email.text).not.toContain('!');
    expect(email.text).not.toContain('Chave de acesso');
    expect(email.text).not.toContain('Protocolo');
  });

  it('shows the protocol only when there is one, and greets without a name', () => {
    const withProtocol = nfseDocumentsReadyEmail({
      ...nfse,
      customerName: '  ',
      protocol: '123456',
      isTest: false,
    });
    expect(withProtocol.text).toContain('Protocolo de autorização: 123456');
    expect(withProtocol.text.startsWith('Olá,\n')).toBe(true);
  });

  it('cuts a long service description', () => {
    const email = nfseDocumentsReadyEmail({
      ...nfse,
      description: 'x'.repeat(300),
      isTest: false,
    });
    expect(email.text).not.toContain('x'.repeat(141));
    expect(email.text).toContain('…');
  });

  it('turns ALL CAPS names into Title Case and leaves mixed case alone', () => {
    expect(toTitleCase('MARIA DAS GRAÇAS E SILVA')).toBe(
      'Maria das Graças e Silva',
    );
    expect(toTitleCase('DA SILVA')).toBe('Da Silva');
    expect(toTitleCase('Ana de Souza')).toBe('Ana de Souza');
    expect(toTitleCase('  ')).toBe('');
  });

  it('cleans the sender name and quotes it only when needed', () => {
    expect(formatFromHeader('Greenflow', 'noreply@corvo.tech')).toBe(
      'Greenflow <noreply@corvo.tech>',
    );
    expect(formatFromHeader('Acme Ltda.', 'noreply@corvo.tech')).toBe(
      '"Acme Ltda." <noreply@corvo.tech>',
    );
    expect(formatFromHeader('', 'noreply@corvo.tech')).toBe(
      'Corvo <noreply@corvo.tech>',
    );
    expect(senderDisplayName('x'.repeat(100))).toHaveLength(64);
  });

  it('does not let a company name inject headers or addresses', () => {
    const evil = 'Evil"\r\nBcc: x@y.com <a@b.com>';
    const name = senderDisplayName(evil);
    expect(name).not.toMatch(/["<>\r\n]/);
    const from = formatFromHeader(evil, 'noreply@corvo.tech');
    expect(from).not.toMatch(/[\r\n]/);
    expect(from.endsWith(' <noreply@corvo.tech>')).toBe(true);
    const email = nfseDocumentsReadyEmail({
      ...nfse,
      companyName: evil,
      isTest: false,
    });
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it('lays out plain blocks', () => {
    expect(emailLayout('Oi', [paragraph('a'), paragraph('b')]).text).toBe(
      'a\n\nb',
    );
  });
});
