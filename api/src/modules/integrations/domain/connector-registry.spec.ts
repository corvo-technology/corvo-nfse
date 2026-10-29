import { ConnectorRegistry } from './connector-registry';
import type { Connector } from './connector';

function fakeConnector(id: string): Connector {
  return {
    manifest: {
      id,
      name: id,
      version: '1',
      credentialFields: [{ key: 'token', label: 'Token', secret: true }],
      webhookInstructions: { pt: 'pt', en: 'en' },
      supportedFlows: ['pix'],
    },
    authenticate: () => Promise.resolve({ ok: true }),
    parse: () => ({ kind: 'test' }),
    normalize: () => Promise.reject(new Error('unused')),
    validateConnection: () => Promise.resolve({ externalAccountId: 'acc' }),
  };
}

describe('ConnectorRegistry', () => {
  it('registers a connector and returns it by id', () => {
    const registry = new ConnectorRegistry();
    const connector = fakeConnector('woovi');
    registry.register(connector);
    expect(registry.get('woovi')).toBe(connector);
    expect(registry.has('woovi')).toBe(true);
  });
  it('refuses a duplicate id', () => {
    const registry = new ConnectorRegistry();
    registry.register(fakeConnector('woovi'));
    expect(() => registry.register(fakeConnector('woovi'))).toThrow(
      'already registered',
    );
  });
  it('refuses an id that is not lowercase letters, digits or hyphen', () => {
    expect(() =>
      new ConnectorRegistry().register(fakeConnector('Woovi!')),
    ).toThrow('Invalid connector id');
  });
  it('throws a not-found error for an unknown id', () => {
    expect(() => new ConnectorRegistry().get('nope')).toThrow(
      'Unknown connector: nope',
    );
  });
  it('manifests() exposes the declared fields but no credential values', () => {
    const registry = new ConnectorRegistry();
    registry.register(fakeConnector('woovi'));
    const manifests = registry.manifests();
    expect(manifests).toHaveLength(1);
    expect(manifests[0].credentialFields[0]).toEqual({
      key: 'token',
      label: 'Token',
      secret: true,
    });
  });
});
