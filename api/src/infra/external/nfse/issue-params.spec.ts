import { buildDps, TipoAmbienteDps } from 'open-nfse';
import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { IIssuePayload } from './nfse-fiscal-provider';
import { issueParams } from './issue-params';
import { OpenNfseProvider } from './open-nfse.provider';
import { explainRejection } from './rejection-guidance';

const payload: IIssuePayload = {
  invoiceId: 'invoice-1',
  tenantId: 'tenant-1',
  number: 7,
  pfxBuffer: Buffer.alloc(0),
  p12Password: '',
  environment: 'live',
  serie: '1',
  competenceDate: new Date('2026-10-01'),
  issuedAt: new Date('2026-10-16'),
  emitente: {
    cnpj: '11222333000181',
    legalName: 'Empresa Teste',
    codMunicipio: '3550308',
    regime: { opSimpNac: 2, regApTribSN: 1, regEspTrib: 0 },
  },
  servico: { cTribNac: '010101', descricao: 'Consultoria' },
  valores: { vServ: 150 },
};

/** Builds the DPS the same way the providers do. */
const dpsOf = (input: IIssuePayload) => {
  const params = issueParams(input);
  return JSON.stringify(
    buildDps({ ...params, nDPS: params.nDPS!, skipCpfCnpjValidation: true }),
  );
};

describe('issueParams', () => {
  it('marks a live invoice as production only when the Sefin target is production', () => {
    expect(issueParams(payload, 'production').tpAmb).toBe(
      TipoAmbienteDps.Producao,
    );
    expect(issueParams(payload).tpAmb).toBe(TipoAmbienteDps.Producao);
    expect(issueParams(payload, 'restricted').tpAmb).toBe(
      TipoAmbienteDps.Homologacao,
    );
  });

  it('keeps test invoices in homologation whatever the Sefin target is', () => {
    expect(
      issueParams({ ...payload, environment: 'test' }, 'production').tpAmb,
    ).toBe(TipoAmbienteDps.Homologacao);
  });

  it('leaves the provider IM out of the DPS when the company has none (Receita E0120)', () => {
    const xml = dpsOf(payload);
    expect(issueParams(payload).emitente.inscricaoMunicipal).toBeUndefined();
    expect(xml).not.toContain('"IM"');
  });

  it('sends the IM when the company has one', () => {
    const withIm = {
      ...payload,
      emitente: { ...payload.emitente, municipalReg: '12345' },
    };
    expect(dpsOf(withIm)).toContain('"IM"');
  });
});

describe('OpenNfseProvider Sefin target', () => {
  const build = (value?: string) =>
    new OpenNfseProvider(
      {} as DataSource,
      { get: () => value } as unknown as ConfigService,
    );

  it('sends live to production by default', () => {
    expect(build(undefined)['sefinFor']('live')).toBe('production');
    expect(build('production')['sefinFor']('live')).toBe('production');
    expect(build('anything-else')['sefinFor']('live')).toBe('production');
  });

  it('sends live to the Produção Restrita only when asked for', () => {
    expect(build('restricted')['sefinFor']('live')).toBe('restricted');
  });

  it('always sends test to the Produção Restrita', () => {
    expect(build(undefined)['sefinFor']('test')).toBe('restricted');
    expect(build('production')['sefinFor']('test')).toBe('restricted');
  });
});

describe('explainRejection', () => {
  it('adds what to do for E0120 and keeps the original message', () => {
    const message =
      'Rejeição da Receita [E0120]: IM do prestador não deve ser informado, pois não existem informações complementares registradas no CNC NFS-e do município emissor informado na DPS.';
    const explained = explainRejection(message);
    expect(explained.startsWith(message)).toBe(true);
    expect(explained).toContain('Remova a Inscrição Municipal');
  });

  it('leaves other rejections untouched', () => {
    expect(explainRejection('Rejeição da Receita [E0999]: outra')).toBe(
      'Rejeição da Receita [E0999]: outra',
    );
  });
});
