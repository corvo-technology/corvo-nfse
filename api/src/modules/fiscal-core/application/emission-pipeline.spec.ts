import type { GatewayOutcome } from '../domain/gateway-outcome';
import type {
  Authorization,
  FiscalDocumentGateway,
  SigningContext,
} from '../domain/ports/gateway.port';
import type { LoadedCertificate, XmlSigner } from '../domain/ports/xml.port';
import {
  EmissionPipeline,
  runValidators,
  type EmissionSteps,
  type PrepareContext,
  type PreSendValidator,
} from './emission-pipeline';

const issue = (field: string) => ({ field, code: 'X', message: field });
const validator = (...fields: string[]): PreSendValidator<string> => ({
  name: fields.join(','),
  validate: () => fields.map(issue),
});

const certificate: LoadedCertificate = {
  certPem: 'c',
  keyPem: 'k',
  cnpj: '11222333000181',
  notAfter: new Date('2030-01-01'),
};
const ctx: PrepareContext = { environment: 'test', certificate };
const signing = {} as SigningContext;
const auth: Authorization = { accessKey: 'K' };

function setup(validators: PreSendValidator<string>[] = []) {
  const calls: string[] = [];
  const steps: EmissionSteps<string> = {
    validators,
    build: jest.fn(() => {
      calls.push('build');
      return { accessKey: 'K', xml: '<x/>', referenceTag: 'infNFe' as const };
    }),
    persistBeforeSend: jest.fn(() => {
      calls.push('persist');
      return Promise.resolve();
    }),
    onAuthorized: jest.fn(() => Promise.resolve()),
  };
  const signer: XmlSigner = {
    sign: jest.fn(() => {
      calls.push('sign');
      return '<x signed/>';
    }),
  };
  return {
    calls,
    steps,
    signer,
    pipeline: new EmissionPipeline(steps, signer),
  };
}

const gatewayReturning = (
  outcome: GatewayOutcome<Authorization>,
): FiscalDocumentGateway<string> => ({
  type: 'nfe',
  issuer: { issue: jest.fn().mockResolvedValue(outcome) },
  consult: { consultByKey: jest.fn() },
});

describe('runValidators', () => {
  it('runs all validators and keeps the order', async () => {
    const issues = await runValidators(
      [validator('a'), validator(), validator('b', 'c')],
      'doc',
      ctx,
    );
    expect(issues.map((i) => i.field)).toEqual(['a', 'b', 'c']);
  });
});

describe('EmissionPipeline', () => {
  it('does not build or persist when validation finds a problem', async () => {
    const { pipeline, steps, signer } = setup([validator('a')]);
    const result = await pipeline.prepare('doc', { series: 1, number: 1 }, ctx);
    expect(result.ok).toBe(false);
    expect(steps.build).not.toHaveBeenCalled();
    expect(signer.sign).not.toHaveBeenCalled();
    expect(steps.persistBeforeSend).not.toHaveBeenCalled();
  });

  it('builds, signs and persists, in that order', async () => {
    const { pipeline, calls } = setup();
    const result = await pipeline.prepare('doc', { series: 1, number: 1 }, ctx);
    expect(calls).toEqual(['build', 'sign', 'persist']);
    expect(result).toMatchObject({
      ok: true,
      signed: { accessKey: 'K', signedXml: '<x signed/>' },
    });
  });

  it('does not call onAuthorized for an uncertain outcome', async () => {
    const { pipeline, steps } = setup();
    const signed = {
      accessKey: 'K',
      xml: '',
      referenceTag: 'infNFe' as const,
      signedXml: '',
    };
    const outcome = await pipeline.send(
      'doc',
      signed,
      gatewayReturning({ kind: 'uncertain', reason: 'timeout' }),
      signing,
    );
    expect(outcome.kind).toBe('uncertain');
    expect(steps.onAuthorized).not.toHaveBeenCalled();
  });

  it('calls onAuthorized once on ok', async () => {
    const { pipeline, steps } = setup();
    const signed = {
      accessKey: 'K',
      xml: '',
      referenceTag: 'infNFe' as const,
      signedXml: '',
    };
    await pipeline.send(
      'doc',
      signed,
      gatewayReturning({ kind: 'ok', value: auth }),
      signing,
    );
    expect(steps.onAuthorized).toHaveBeenCalledTimes(1);
    expect(steps.onAuthorized).toHaveBeenCalledWith('doc', auth);
  });
});
