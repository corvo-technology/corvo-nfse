import { HttpStatusError, NfseClient, NotFoundError } from 'open-nfse';
import { OpenNfseProvider } from './open-nfse.provider';
import type { IIssuePayload } from './nfse-fiscal-provider';

const ID_DPS = 'DPS353470826146948700014000001000000000001767';
const DIGITS = ID_DPS.slice(3);

const credentials = (environment: 'live' | 'test') =>
  ({
    environment,
    pfxBuffer: Buffer.from('pfx'),
    p12Password: 'secret',
  }) as IIssuePayload;

const malformed = () =>
  new HttpStatusError(
    400,
    '{ "erro": { "codigo": "E2400", "descricao": "Identificador mal formado. O ID da DPS deve conter 42 números." } }',
  );

const dpsAnswer = {
  tipoAmbiente: 2,
  versaoAplicativo: 'x',
  dataHoraProcessamento: '2026-11-27T10:00:00-03:00',
  idDps: ID_DPS,
  chaveAcesso: 'K'.repeat(50),
};

function build() {
  return new OpenNfseProvider({} as never, { get: () => undefined } as never);
}

/** What the portal receives: the paths asked through the lib's HTTP client. */
function portalPaths(answer: (path: string) => unknown) {
  const paths: string[] = [];
  const sefin = {
    get: jest.fn((path: string) => {
      paths.push(path);
      const result = answer(path);
      // The lib runs outside the jest realm, so `instanceof Error` cannot tell its errors apart.
      return result instanceof HttpStatusError ||
        result instanceof NotFoundError
        ? Promise.reject(result)
        : Promise.resolve(result);
    }),
  };
  (
    NfseClient.prototype as unknown as { ensureState: () => unknown }
  ).ensureState = jest.fn().mockResolvedValue({ sefin });
  return paths;
}

afterEach(() => jest.restoreAllMocks());

describe('OpenNfseProvider: DPS lookup when the portal wants only the 42 digits', () => {
  beforeEach(() => {
    jest.spyOn(NfseClient.prototype, 'fetchByChave').mockResolvedValue({
      chaveAcesso: 'K'.repeat(50),
      tipoAmbiente: 'HOMOLOGACAO',
      nfse: { infNFSe: { nNFSe: '7' } },
      xmlNfse: '<xml/>',
    } as never);
  });

  it('asks again without the "DPS" prefix after E2400 and remembers it', async () => {
    const provider = build();
    const prefixed = jest
      .spyOn(NfseClient.prototype, 'fetchDpsStatus')
      .mockRejectedValue(malformed());
    const paths = portalPaths(() => dpsAnswer);

    await provider.queryByDps(ID_DPS, credentials('test'));
    expect(paths).toEqual([`/dps/${DIGITS}`]);
    expect(prefixed).toHaveBeenCalledTimes(1);

    // The next lookup goes straight to the digits form.
    await provider.queryByDps(ID_DPS, credentials('test'));
    expect(prefixed).toHaveBeenCalledTimes(1);
    expect(paths).toEqual([`/dps/${DIGITS}`, `/dps/${DIGITS}`]);
  });

  it('keeps the prefix where the portal accepts it', async () => {
    const provider = build();
    const prefixed = jest
      .spyOn(NfseClient.prototype, 'fetchDpsStatus')
      .mockResolvedValue({
        chaveAcesso: 'K'.repeat(50),
        tipoAmbiente: 'HOMOLOGACAO',
      } as never);
    const paths = portalPaths(() => dpsAnswer);
    await provider.queryByDps(ID_DPS, credentials('live'));
    expect(prefixed).toHaveBeenCalledWith(ID_DPS);
    expect(paths).toEqual([]);
  });

  it('a 404 on the digits form still means "no note"', async () => {
    const provider = build();
    jest
      .spyOn(NfseClient.prototype, 'fetchDpsStatus')
      .mockRejectedValue(malformed());
    portalPaths(() => new NotFoundError('nada'));
    await expect(
      provider.queryByDps(ID_DPS, credentials('test')),
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('raises other 400s untouched and does not try the other form', async () => {
    const provider = build();
    const other = new HttpStatusError(400, '{"erro":{"codigo":"E9999"}}');
    jest.spyOn(NfseClient.prototype, 'fetchDpsStatus').mockRejectedValue(other);
    const paths = portalPaths(() => dpsAnswer);
    await expect(provider.queryByDps(ID_DPS, credentials('test'))).rejects.toBe(
      other,
    );
    expect(paths).toEqual([]);
  });
});
