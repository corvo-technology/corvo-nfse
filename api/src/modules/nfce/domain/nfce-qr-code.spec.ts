import { nfceQrCodeOnline } from './nfce-qr-code';

const KEY = '35261112223330001815565001000000010112345678'.slice(0, 44);

describe('nfceQrCodeOnline', () => {
  it('is base?p=key|3|tpAmb', () => {
    expect(nfceQrCodeOnline('https://x.gov.br/qrcode', KEY, 2)).toBe(
      `https://x.gov.br/qrcode?p=${KEY}|3|2`,
    );
  });

  it('refuses an empty base, a base with a query and a bad key', () => {
    expect(() => nfceQrCodeOnline('', KEY, 2)).toThrow();
    expect(() => nfceQrCodeOnline('https://x.gov.br/q?a=1', KEY, 2)).toThrow();
    expect(() =>
      nfceQrCodeOnline('https://x.gov.br/qrcode', '123', 2),
    ).toThrow();
  });

  it('refuses a result under 60 characters', () => {
    expect(() => nfceQrCodeOnline('http://a', KEY, 1)).toThrow(/60/);
  });
});
