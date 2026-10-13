// Mock for open-nfse — used in test environments where ESM imports don't work
export const Ambiente = {
  ProducaoRestrita: 'PRODUCAO_RESTRITA',
  Producao: 'PRODUCAO',
};

export const TipoAmbiente = {
  Producao: 'PRODUCAO',
  Homologacao: 'HOMOLOGACAO',
};

export const AMBIENTE_ENDPOINTS = {};

export class ReceitaRejectionError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ReceitaRejectionError';
  }
}

export function createInMemoryDpsCounter() {
  let counter = 0;
  return {
    next: () => ++counter,
    current: () => counter,
  };
}

export function createInMemoryRetryStore() {
  return {
    get: () => null,
    set: () => undefined,
    delete: () => undefined,
  };
}

export class NfseClient {
  constructor(_config: any) {}
  // eslint-disable-next-line @typescript-eslint/require-await
  async emitir(_params: any) {
    return {
      status: 'ok',
      nfse: { chaveAcesso: 'mock-key', numeroNfse: 1, xml: '<xml/>' },
    };
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async consultar(_params: any) {
    return { status: 'authorized' };
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async obterDanfsePdf(_params: any) {
    return Buffer.from('mock-pdf');
  }
}

const sdk = process
  .getBuiltinModule('module')
  .createRequire(process.cwd() + '/package.json')(
  'open-nfse',
) as typeof import('open-nfse');
export const buildDps = sdk.buildDps;
export const buildDpsXml = sdk.buildDpsXml;
export const buildDpsId = sdk.buildDpsId;
export const parseNfseXml = sdk.parseNfseXml;
export const gerarDanfse = sdk.gerarDanfse;
export const OpcaoSimplesNacional = sdk.OpcaoSimplesNacional;
export const RegimeApuracaoSimplesNacional = sdk.RegimeApuracaoSimplesNacional;
export const RegimeEspecialTributacao = sdk.RegimeEspecialTributacao;
export const TipoAmbienteDps = sdk.TipoAmbienteDps;
export const ValidationError = sdk.ValidationError;
export const NotFoundError = sdk.NotFoundError;
export const pendingEmissionId = sdk.pendingEmissionId;
