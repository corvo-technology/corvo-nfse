import { BrasilApiSimplesRegistry } from './brasilapi-simples-registry';

const body = {
  opcao_pelo_simples: true,
  opcao_pelo_mei: false,
  codigo_municipio_ibge: 3550308,
};
const response = (status: number, json: unknown) =>
  Promise.resolve({
    ok: status === 200,
    status,
    json: () => Promise.resolve(json),
  });

describe('BrasilApiSimplesRegistry', () => {
  it('maps the public CNPJ answer', async () => {
    const fetchFn = jest.fn().mockReturnValue(response(200, body));
    const registry = new BrasilApiSimplesRegistry({ fetchFn });
    await expect(registry.lookup('11.222.333/0001-81')).resolves.toEqual({
      optanteSimples: true,
      optanteMei: false,
      municipalityCode: '3550308',
    });
    expect((fetchFn.mock.calls as unknown[][])[0]?.[0]).toBe(
      'https://brasilapi.com.br/api/cnpj/v1/11222333000181',
    );
  });

  it('pads short IBGE codes and tolerates missing fields', async () => {
    const fetchFn = jest
      .fn()
      .mockReturnValue(response(200, { codigo_municipio_ibge: 100108 }));
    await expect(
      new BrasilApiSimplesRegistry({ fetchFn }).lookup('11222333000181'),
    ).resolves.toEqual({
      optanteSimples: null,
      optanteMei: null,
      municipalityCode: '0100108',
    });
  });

  it('caches a successful answer for 24 hours', async () => {
    let now = 1_000;
    const fetchFn = jest.fn().mockImplementation(() => response(200, body));
    const registry = new BrasilApiSimplesRegistry({ fetchFn, now: () => now });
    await registry.lookup('11222333000181');
    now += 23 * 3600_000;
    await registry.lookup('11222333000181');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now += 2 * 3600_000;
    await registry.lookup('11222333000181');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a 404', () => response(404, {})],
    ['a 429', () => response(429, {})],
    ['a network error', () => Promise.reject(new Error('down'))],
    ['an invalid body', () => response(200, 'nope')],
  ])('returns null on %s and does not cache the failure', async (_n, make) => {
    const fetchFn = jest.fn().mockImplementation(make);
    const registry = new BrasilApiSimplesRegistry({ fetchFn });
    await expect(registry.lookup('11222333000181')).resolves.toBeNull();
    await registry.lookup('11222333000181');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('gives up after the timeout', async () => {
    const fetchFn = jest.fn().mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const registry = new BrasilApiSimplesRegistry({ fetchFn, timeoutMs: 20 });
    await expect(registry.lookup('11222333000181')).resolves.toBeNull();
  });

  it('keeps the letters of an alphanumeric CNPJ', async () => {
    const fetchFn = jest.fn().mockReturnValue(response(200, body));
    await new BrasilApiSimplesRegistry({ fetchFn }).lookup(
      '12.ABC.345/01DE-35',
    );
    expect((fetchFn.mock.calls as unknown[][])[0]?.[0]).toBe(
      'https://brasilapi.com.br/api/cnpj/v1/12ABC34501DE35',
    );
  });

  describe('lookupProfile', () => {
    const full = {
      razao_social: 'EMPRESA EXEMPLO LTDA',
      nome_fantasia: 'EXEMPLO',
      descricao_situacao_cadastral: 'ATIVA',
      codigo_situacao_cadastral: 2,
      descricao_tipo_de_logradouro: 'RUA',
      logradouro: 'DAS FLORES',
      numero: '123',
      complemento: 'SALA 4',
      bairro: 'CENTRO',
      municipio: 'SAO PAULO',
      uf: 'sp',
      cep: '01310100',
      codigo_municipio_ibge: 3550308,
      opcao_pelo_simples: true,
      opcao_pelo_mei: false,
    };

    it('maps the registration data of the CNPJ', async () => {
      const fetchFn = jest.fn().mockReturnValue(response(200, full));
      const registry = new BrasilApiSimplesRegistry({ fetchFn });
      await expect(registry.lookupProfile('11222333000181')).resolves.toEqual({
        legalName: 'EMPRESA EXEMPLO LTDA',
        tradeName: 'EXEMPLO',
        address: {
          zip: '01310100',
          street: 'RUA DAS FLORES',
          number: '123',
          complement: 'SALA 4',
          district: 'CENTRO',
          city: 'SAO PAULO',
          state: 'SP',
        },
        municipalityCode: '3550308',
        simples: true,
        mei: false,
        active: true,
        situation: 'ATIVA',
      });
    });

    it('flags a CNPJ that is not active', async () => {
      const fetchFn = jest.fn().mockReturnValue(
        response(200, {
          ...full,
          codigo_situacao_cadastral: 8,
          descricao_situacao_cadastral: 'BAIXADA',
        }),
      );
      const profile = await new BrasilApiSimplesRegistry({
        fetchFn,
      }).lookupProfile('11222333000181');
      expect(profile?.active).toBe(false);
      expect(profile?.situation).toBe('BAIXADA');
    });

    it('shares the cache with lookup', async () => {
      const fetchFn = jest.fn().mockImplementation(() => response(200, full));
      const registry = new BrasilApiSimplesRegistry({ fetchFn });
      await registry.lookup('11222333000181');
      await registry.lookupProfile('11222333000181');
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('returns null on failure and on timeout', async () => {
      const down = jest.fn().mockRejectedValue(new Error('down'));
      await expect(
        new BrasilApiSimplesRegistry({ fetchFn: down }).lookupProfile(
          '11222333000181',
        ),
      ).resolves.toBeNull();
      const hang = jest.fn().mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      );
      await expect(
        new BrasilApiSimplesRegistry({
          fetchFn: hang,
          timeoutMs: 20,
        }).lookupProfile('11222333000181'),
      ).resolves.toBeNull();
    });
  });

  it('bounds the cache, dropping the oldest entry', async () => {
    const fetchFn = jest.fn().mockImplementation(() => response(200, body));
    const registry = new BrasilApiSimplesRegistry({ fetchFn });
    for (let i = 0; i < 1001; i++)
      await registry.lookup(String(i).padStart(14, '0'));
    await registry.lookup('00000000000000');
    expect(fetchFn).toHaveBeenCalledTimes(1002);
  });
});
