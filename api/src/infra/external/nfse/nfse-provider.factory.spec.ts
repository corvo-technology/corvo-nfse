import type { ConfigService } from '@nestjs/config';
import { NfseProviderFactory } from './nfse-provider.factory';
import type { FiscalProvider } from './nfse-fiscal-provider';

describe('NfseProviderFactory', () => {
  let fake: jest.Mocked<FiscalProvider>;
  let real: jest.Mocked<FiscalProvider>;
  let factory: NfseProviderFactory;

  beforeEach(() => {
    fake = {
      issue: jest.fn(),
      queryByAccessKey: jest.fn(),
      retrievePdf: jest.fn(),
      cancel: jest.fn(),
    };
    real = {
      issue: jest.fn(),
      queryByAccessKey: jest.fn(),
      retrievePdf: jest.fn(),
      cancel: jest.fn(),
    };
    factory = build(undefined);
  });

  const build = (testProvider: string | undefined) =>
    new NfseProviderFactory(fake, real, {
      get: (key: string) =>
        key === 'NFSE_TEST_PROVIDER' ? testProvider : undefined,
    } as unknown as ConfigService);

  describe('resolve()', () => {
    it('sends live to the real provider', () => {
      expect(factory.resolve('live')).toBe(real);
    });

    it('sends test to the real provider too (Sefin Produção Restrita) by default', () => {
      expect(factory.resolve('test')).toBe(real);
      expect(factory.resolve(undefined)).toBe(real);
      expect(factory.isSimulated('test')).toBe(false);
    });

    it('keeps test on the simulator when NFSE_TEST_PROVIDER=fake (CI and e2e)', () => {
      factory = build('fake');
      expect(factory.resolve('test')).toBe(fake);
      expect(factory.resolve(undefined)).toBe(fake);
      expect(factory.isSimulated('test')).toBe(true);
    });

    it('never simulates live, whatever NFSE_TEST_PROVIDER says', () => {
      factory = build('fake');
      expect(factory.resolve('live')).toBe(real);
      expect(factory.isSimulated('live')).toBe(false);
    });
  });
});
