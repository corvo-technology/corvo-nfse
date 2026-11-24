import { Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BrasilApiCnpjClient } from './brasilapi-cnpj-client';
import { BrasilApiCustomerRegistry } from './brasilapi-customer-registry';
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
    ['a 500', () => response(500, {})],
    ['a 429', () => response(429, {})],
    ['a network error', () => Promise.reject(new Error('down'))],
    ['an invalid body', () => response(200, 'nope')],
  ])('returns null on %s and does not cache the failure', async (_n, make) => {
    const fetchFn = jest.fn().mockImplementation(make);
    const registry = new BrasilApiSimplesRegistry({ fetchFn });
    await expect(registry.lookup('11222333000181')).resolves.toBeNull();
    await registry.lookup('11222333000181');
    expect(fetchFn).toHaveBeenCalledTimes(4);
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

  it('keeps a "not found" for 5 minutes only', async () => {
    let now = 0;
    const fetchFn = jest.fn().mockImplementation(() => response(404, {}));
    const registry = new BrasilApiSimplesRegistry({ fetchFn, now: () => now });
    await registry.lookup('11222333000181');
    now += 4 * 60_000;
    await registry.lookupProfile('11222333000181');
    expect(fetchFn).toHaveBeenCalledTimes(2); // both providers, once
    now += 2 * 60_000;
    await registry.lookup('11222333000181');
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('sends a User-Agent and Accept header', async () => {
    const fetchFn = jest.fn().mockReturnValue(response(200, body));
    await new BrasilApiSimplesRegistry({ fetchFn }).lookup('11222333000181');
    const init = (fetchFn.mock.calls as unknown[][])[0]?.[1] as {
      headers: Record<string, string>;
    };
    expect(init.headers['User-Agent']).toMatch(/^corvo-nfse\//);
    expect(init.headers.Accept).toBe('application/json');
  });

  it('asks minhareceita.org when BrasilAPI answers 403, and does not keep the failure', async () => {
    const real = JSON.parse(
      readFileSync(
        join(__dirname, 'fixtures/minhareceita-27125453000109.json'),
        'utf8',
      ),
    ) as unknown;
    let primaryDown = true;
    const fetchFn = jest
      .fn()
      .mockImplementation((url: string) =>
        url.includes('brasilapi') && primaryDown
          ? response(403, {})
          : response(200, real),
      );
    const registry = new BrasilApiSimplesRegistry({ fetchFn });
    await expect(
      registry.lookupProfile('27125453000109'),
    ).resolves.toMatchObject({
      legalName: 'OLD N7 BARBEARIA LTDA',
      simples: true,
      active: true,
    });
    expect((fetchFn.mock.calls as unknown[][])[1]?.[0]).toBe(
      'https://minhareceita.org/27125453000109',
    );
    primaryDown = false;
    await registry.lookup('27125453000109'); // served by the cache
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('answers null and logs a warning when every provider fails', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const fetchFn = jest.fn().mockImplementation(() => response(403, {}));
    await expect(
      new BrasilApiSimplesRegistry({ fetchFn }).lookupProfile('27125453000109'),
    ).resolves.toBeNull();
    const logged = warn.mock.calls.map((c) => String(c[0]));
    expect(logged).toHaveLength(2);
    expect(logged[0]).toContain('HTTP 403');
    expect(logged.join()).not.toContain('27125453000109');
    warn.mockRestore();
  });

  describe('with a real BrasilAPI answer', () => {
    const real = JSON.parse(
      readFileSync(
        join(__dirname, 'fixtures/brasilapi-27125453000109.json'),
        'utf8',
      ),
    ) as unknown;

    it('builds the profile and the Simples info from the same call', async () => {
      const fetchFn = jest.fn().mockImplementation(() => response(200, real));
      const registry = new BrasilApiSimplesRegistry({ fetchFn });
      await expect(registry.lookup('27125453000109')).resolves.toEqual({
        optanteSimples: true,
        optanteMei: false,
        municipalityCode: '3170206',
      });
      await expect(registry.lookupProfile('27125453000109')).resolves.toEqual({
        legalName: 'OLD N7 BARBEARIA LTDA',
        tradeName: 'OLD N7 BARBEARIA',
        address: {
          zip: '38415204',
          street: 'RUA ERMELINDA COSTA SAMPAIO',
          number: '88',
          complement: '',
          district: 'TALISMA (LOTEAMENTO)',
          city: 'UBERLANDIA',
          state: 'MG',
        },
        municipalityCode: '3170206',
        simples: true,
        mei: false,
        active: true,
        situation: 'ATIVA',
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('the customer registry and the company profile share one call', async () => {
      const fetchFn = jest.fn().mockImplementation(() => response(200, real));
      const client = new BrasilApiCnpjClient({ fetchFn });
      await expect(
        new BrasilApiCustomerRegistry({ client }).lookup('27125453000109'),
      ).resolves.toEqual({
        name: 'OLD N7 BARBEARIA LTDA',
        city: 'UBERLANDIA',
        state: 'MG',
      });
      await expect(
        new BrasilApiSimplesRegistry({ client }).lookupProfile(
          '27125453000109',
        ),
      ).resolves.toMatchObject({ legalName: 'OLD N7 BARBEARIA LTDA' });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
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
