import type {
  AuthorityEndpointResolver,
  AuthorityTarget,
} from '@/modules/fiscal-core/domain/ports/authority.port';
import type { SigningContext } from '@/modules/fiscal-core/domain/ports/gateway.port';
import { FakeNfeGateway } from './fake-nfe.gateway';
import { NfeGateway } from './nfe-gateway';
import type { SchemaValidator } from './schema-validator';
import type { SefazSoapClient } from './soap-client';

const KEY = '35261112345678000195650010000000011234567810';

function build(options?: ConstructorParameters<typeof NfeGateway>[4]) {
  const asked: AuthorityTarget[] = [];
  const resolver: AuthorityEndpointResolver = {
    resolve: (q) => {
      asked.push(q);
      return {
        authority: 'SP',
        url: 'https://example.gov.br/ws',
        soapAction: 'a',
        version: '4.00',
      };
    },
  };
  const soap = {
    call: jest.fn().mockResolvedValue({ kind: 'unavailable' }),
  } as unknown as SefazSoapClient;
  const validator = {
    validate: jest.fn().mockResolvedValue({ ok: true }),
  } as unknown as SchemaValidator;
  return {
    asked,
    gateway: new NfeGateway(soap, resolver, validator, 1000, options),
  };
}

const ctx = { tpAmb: 2, certificate: {} } as unknown as SigningContext;

describe('NfeGateway by model', () => {
  it('serves the NF-e (model 55) by default, with the correction letter', () => {
    const { gateway } = build();
    const registered = gateway.asFiscalGateway();
    expect(registered.type).toBe('nfe');
    expect(registered.correct).toBeDefined();
  });

  it('asks the resolver for model 55 by default', async () => {
    const { gateway, asked } = build();
    await gateway.consult.consultByKey(KEY, ctx);
    expect(asked.map((q) => q.model)).toEqual([55]);
  });

  it('as an NFC-e gateway: type nfce, model 65, and no correction letter', async () => {
    const { gateway, asked } = build({ type: 'nfce' });
    const registered = gateway.asFiscalGateway();
    expect(registered.type).toBe('nfce');
    expect(registered.correct).toBeUndefined();
    expect(registered.inutilize).toBeDefined();
    await gateway.consult.consultByKey(KEY, ctx);
    expect(asked.map((q) => q.model)).toEqual([65]);
  });
});

describe('FakeNfeGateway by type', () => {
  it('has the correction letter as NF-e and not as NFC-e', () => {
    expect(new FakeNfeGateway().correct).toBeDefined();
    const nfce = new FakeNfeGateway(() => new Date(), 'nfce');
    expect(nfce.type).toBe('nfce');
    expect(nfce.correct).toBeUndefined();
    expect(nfce.issuer).toBeDefined();
  });
});
