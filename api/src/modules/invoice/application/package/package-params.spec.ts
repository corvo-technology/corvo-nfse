import { parseInclude, parseMonth } from './invoice-package.service';
import { accountantPackageEmail } from '@/infra/external/email/email-templates';

describe('package request parsing', () => {
  it('turns a month into a pure date range', () => {
    expect(parseMonth('2026-11')).toEqual({
      start: '2026-11-01',
      end: '2026-12-01',
    });
    expect(parseMonth('2026-12')).toEqual({
      start: '2026-12-01',
      end: '2027-01-01',
    });
  });

  it.each(['2026-13', '2026-1', '26-11', '', undefined, '2026-11-01'])(
    'rejects month %p',
    (month) => {
      expect(() => parseMonth(month)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'PACKAGE_MONTH_INVALID' }),
        }),
      );
    },
  );

  it('defaults include to both and accepts one', () => {
    expect(parseInclude(undefined)).toEqual(['xml', 'pdf']);
    expect(parseInclude('pdf')).toEqual(['pdf']);
    expect(parseInclude('xml,pdf')).toEqual(['xml', 'pdf']);
    expect(() => parseInclude('zip')).toThrow();
    expect(() => parseInclude('xml,')).toThrow();
  });
});

describe('accountantPackageEmail', () => {
  it('links to the download, never attaches, and escapes the company name', () => {
    const email = accountantPackageEmail({
      companyName: 'A & <B>',
      companyTaxId: '11222333000181',
      monthLabel: 'outubro de 2026',
      count: 4,
      total: 'R$ 1.000,00',
      downloadUrl: 'https://api.example/v1/invoice-package-links/tok',
      expiresOn: '08/11/2026',
    });
    expect(email.html).toContain('A &amp; &lt;B&gt;');
    expect(email.html).toContain(
      'href="https://api.example/v1/invoice-package-links/tok"',
    );
    expect(email.text).toContain('11.222.333/0001-81');
    expect(email.text).toContain('08/11/2026');
  });
});
