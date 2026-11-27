import {
  creditsLowEmail,
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
