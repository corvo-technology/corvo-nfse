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
    factory = new NfseProviderFactory(fake, real);
  });

  describe('resolve()', () => {
    it('returns FakeProvider when apiKeyEnvironment is "test"', () => {
      expect(factory.resolve('test')).toBe(fake);
    });

    it('returns RealProvider when apiKeyEnvironment is "live"', () => {
      expect(factory.resolve('live')).toBe(real);
    });

    it('returns FakeProvider for the default test environment', () => {
      expect(factory.resolve(undefined)).toBe(fake);
    });
  });
});
