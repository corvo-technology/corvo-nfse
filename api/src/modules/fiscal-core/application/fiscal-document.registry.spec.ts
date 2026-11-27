import type { FiscalDocumentGateway } from '../domain/ports/gateway.port';
import { FiscalDocumentRegistry } from './fiscal-document.registry';

const gateway = (type: 'nfse' | 'nfe'): FiscalDocumentGateway<unknown> => ({
  type,
  issuer: { issue: jest.fn() },
  consult: { consultByKey: jest.fn() },
});

describe('FiscalDocumentRegistry', () => {
  it('returns the registered gateway by type', () => {
    const registry = new FiscalDocumentRegistry();
    const nfse = gateway('nfse');
    registry.register(nfse);
    expect(registry.get('nfse')).toBe(nfse);
    expect(registry.has('nfse')).toBe(true);
    expect(registry.has('nfe')).toBe(false);
  });

  it('refuses to register the same type twice', () => {
    const registry = new FiscalDocumentRegistry();
    registry.register(gateway('nfse'));
    expect(() => registry.register(gateway('nfse'))).toThrow(
      'Fiscal gateway already registered for nfse',
    );
  });

  it('fails clearly when the type has no gateway', () => {
    expect(() => new FiscalDocumentRegistry().get('nfe')).toThrow(
      'No fiscal gateway registered for nfe',
    );
  });
});
