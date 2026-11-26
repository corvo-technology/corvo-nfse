import {
  creditsLowEmail,
  emailLayout,
  nfeAuthorizedEmail,
  nfseDocumentsReadyEmail,
  otpEmail,
  paragraph,
  schedulePausedEmail,
  scheduleRetryEmail,
  welcomeEmail,
} from './email-templates';

const nfse = {
  companyName: 'Acme',
  customerName: 'Ana',
  amount: 'R$ 100,00',
  number: '42',
  issueDate: '07/11/2026',
  description: 'Consultoria',
  accessKey: 'ABC123',
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
    expect(named.text).toContain('Olá, Maria!');
    for (const name of ['', '   ', undefined]) {
      const email = welcomeEmail({ name, dashboardUrl: 'https://x.test' });
      expect(email.text).toContain('Olá! Sua conta');
      expect(email.text).not.toContain('Olá, !');
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

  it('leaves the logo out of the invoice email only', () => {
    expect(
      nfseDocumentsReadyEmail({ ...nfse, isTest: false }).html,
    ).not.toContain('icon-192.png');
  });

  it('writes the NF-e e-mail in plain pt-BR, with the key and the attachments named', () => {
    const nfe = {
      companyName: 'Acme',
      customerName: 'Ana',
      amount: 'R$ 100,00',
      number: '10',
      series: '1',
      issueDate: '26/11/2026',
      accessKey: '35261111222333000181550010000000101123456783',
      isTest: false,
    };
    const live = nfeAuthorizedEmail(nfe);
    expect(live.subject).toBe('Sua nota fiscal eletrônica nº 10 - Acme');
    expect(live.text).toContain('Chave de acesso: 3526');
    expect(live.text).toContain('XML da nota');
    expect(live.text).toContain('DANFE em PDF');
    expect(live.html).not.toContain('icon-192.png');
    expect(live.text).not.toContain('homologação');
    const test = nfeAuthorizedEmail({ ...nfe, isTest: true });
    expect(test.subject).toBe(
      '[TESTE] Sua nota fiscal eletrônica nº 10 - Acme',
    );
    expect(test.text).toContain('não tem valor fiscal');
  });

  it('escapes what the issuer typed in the NF-e e-mail', () => {
    const email = nfeAuthorizedEmail({
      companyName: 'A & B <x>',
      customerName: '"Ana"',
      amount: 'R$ 1,00',
      number: '1',
      series: '1',
      issueDate: '26/11/2026',
      accessKey: '1',
      isTest: false,
    });
    expect(email.html).toContain('A &amp; B &lt;x&gt;');
    expect(email.html).not.toContain('<x>');
  });

  it('lays out plain blocks', () => {
    expect(emailLayout('Oi', [paragraph('a'), paragraph('b')]).text).toBe(
      'a\n\nb',
    );
  });
});
