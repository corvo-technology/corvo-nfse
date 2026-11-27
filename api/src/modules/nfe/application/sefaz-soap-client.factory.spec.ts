import { createSefazSoapClient } from './sefaz-soap-client.factory';

describe('createSefazSoapClient', () => {
  it('builds a client without a selector (always direct)', () => {
    expect(createSefazSoapClient()).toBeDefined();
  });

  it('hands the selector the SEFAZ scope, the certificate pair and the trust roots', async () => {
    const dispatcherFor = jest.fn().mockResolvedValue(undefined);
    const client = createSefazSoapClient({ dispatcherFor });
    const options = (
      client as unknown as {
        options: {
          proxyFor: (
            host: string,
            cert: { keyPem: string; certPem: string },
          ) => Promise<unknown>;
        };
      }
    ).options;
    await options.proxyFor('nfe.fazenda.sp.gov.br', {
      keyPem: 'K',
      certPem: 'C',
    });
    expect(dispatcherFor).toHaveBeenCalledWith(
      'nfe.fazenda.sp.gov.br',
      'sefaz',
      { keyPem: 'K', certPem: 'C' },
      expect.arrayContaining([expect.stringContaining('BEGIN CERTIFICATE')]),
    );
  });
});
