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
  get codigo(): string {
    return this.code ?? '';
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
  // eslint-disable-next-line @typescript-eslint/require-await
  async cancelar(_params: any): Promise<any> {
    return { status: 'ok', evento: {} };
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async replayPendingEvents(_store?: any): Promise<any[]> {
    return [];
  }
  async close(): Promise<void> {}
}

const sdk = process
  .getBuiltinModule('module')
  .createRequire(process.cwd() + '/package.json')(
  'open-nfse',
) as typeof import('open-nfse');
export const buildDps = sdk.buildDps;
export const buildDpsXml = sdk.buildDpsXml;
export const buildDpsId = sdk.buildDpsId;
export const validateDpsXml = sdk.validateDpsXml;
export const signDpsXml = sdk.signDpsXml;
export const FinalidadeNFSe = sdk.FinalidadeNFSe;
export const IndicadorDestinatario = sdk.IndicadorDestinatario;
export const IndicadorFinal = sdk.IndicadorFinal;
export const TipoRetISSQN = sdk.TipoRetISSQN;
export const TipoTribISSQN = sdk.TipoTribISSQN;
export const parseNfseXml = sdk.parseNfseXml;
export const gerarDanfse = sdk.gerarDanfse;
export const OpcaoSimplesNacional = sdk.OpcaoSimplesNacional;
export const CodigoNaoNif = sdk.CodigoNaoNif;
export const RegimeApuracaoSimplesNacional = sdk.RegimeApuracaoSimplesNacional;
export const RegimeEspecialTributacao = sdk.RegimeEspecialTributacao;
export const TipoAmbienteDps = sdk.TipoAmbienteDps;
export const ValidationError = sdk.ValidationError;
export const NotFoundError = sdk.NotFoundError;
export const pendingEmissionId = sdk.pendingEmissionId;
export const JustificativaCancelamento = sdk.JustificativaCancelamento;
export const JustificativaSubstituicao = sdk.JustificativaSubstituicao;

// Portal sync: the feed's enums, the events parser and the errors that mean the portal is down.
export const TipoEvento = sdk.TipoEvento;
export const StatusDistribuicao = sdk.StatusDistribuicao;
export const parseEventoXml = sdk.parseEventoXml;
export const HttpStatusError = sdk.HttpStatusError;
export const NetworkError = sdk.NetworkError;
export const ServerError = sdk.ServerError;
export const TimeoutError = sdk.TimeoutError;
export const TooManyRequestsError = sdk.TooManyRequestsError;
