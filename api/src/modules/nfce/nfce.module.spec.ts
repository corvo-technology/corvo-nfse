import { ConfigService } from '@nestjs/config';
import { FiscalDocumentRegistry } from '@/modules/fiscal-core/application/fiscal-document.registry';
import { NfceModule } from './nfce.module';

const start = (values: Record<string, unknown>) => {
  const registry = new FiscalDocumentRegistry();
  const module = new NfceModule(registry, new ConfigService(values));
  module.onModuleInit();
  return { registry, module };
};

describe('NfceModule gateway registration', () => {
  it('registers the simulator as `nfce` with NFE_TEST_PROVIDER=fake, without a correction letter', () => {
    const { registry } = start({ NFE_TEST_PROVIDER: 'fake' });
    expect(registry.has('nfce')).toBe(true);
    expect(registry.get('nfce').type).toBe('nfce');
    expect(registry.get('nfce').correct).toBeUndefined();
    expect(registry.get('nfce').cancel).toBeDefined();
    expect(registry.get('nfce').inutilize).toBeDefined();
  });

  it('registers the SEFAZ gateway otherwise, still with no correction letter', () => {
    const { registry } = start({ NFE_SEFAZ_TIMEOUT_MS: 5000 });
    expect(registry.get('nfce').type).toBe('nfce');
    expect(registry.get('nfce').correct).toBeUndefined();
    expect(registry.get('nfce').issuer).toBeDefined();
  });

  it('starting twice does not throw (the `has` guard of the NfeModule)', () => {
    const { registry, module } = start({ NFE_TEST_PROVIDER: 'fake' });
    expect(() => module.onModuleInit()).not.toThrow();
    expect(registry.has('nfce')).toBe(true);
  });

  it('leaves the `nfe` gateway alone', () => {
    const { registry } = start({ NFE_TEST_PROVIDER: 'fake' });
    expect(registry.has('nfe')).toBe(false);
  });
});
