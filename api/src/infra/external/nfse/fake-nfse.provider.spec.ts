import {
  buildDps,
  FinalidadeNFSe,
  IndicadorDestinatario,
  parseNfseXml,
  type DPS,
} from 'open-nfse';
import { FakeNfseProvider } from './fake-nfse.provider';
import type { IIssuePayload } from './nfse-fiscal-provider';
import { issueParams } from './issue-params';

const payload: IIssuePayload = {
  invoiceId: 'invoice-1',
  tenantId: 'tenant-1',
  number: 7,
  pfxBuffer: Buffer.alloc(0),
  p12Password: '',
  environment: 'test',
  serie: '1',
  competenceDate: new Date('2026-09-01'),
  issuedAt: new Date('2026-10-09'),
  emitente: {
    cnpj: '11222333000181',
    legalName: 'Empresa & Teste',
    codMunicipio: '3550308',
    regime: { opSimpNac: 2, regApTribSN: 1, regEspTrib: 0 },
  },
  tomador: { documento: { CPF: '52998224725' }, nome: 'Cliente <Teste>' },
  servico: {
    cTribNac: '010101',
    descricao: 'Consultoria & implantação <teste>',
  },
  valores: { vServ: 150.25 },
};

describe('Offline test invoices with the installed XML/PDF SDK', () => {
  const provider = new FakeNfseProvider();
  it('produces complete escaped XML with the requested competence and monetary value', async () => {
    const result = await provider.issue(payload);
    const nfse = parseNfseXml(result.xmlAuthorized!);
    expect(nfse.infNFSe.DPS.infDPS.valores.vServPrest.vServ).toBe(150.25);
    expect(nfse.infNFSe.DPS.infDPS.dCompet.toISOString()).toContain(
      '2026-09-01',
    );
    expect(nfse.infNFSe.DPS.infDPS.toma?.xNome).toBe('Cliente <Teste>');
    expect(result.xmlAuthorized).toContain('SIMULAÇÃO SEM VALIDADE FISCAL');
    expect(result.accessKey).toMatch(/^\d{50}$/);
  });
  it('retries deterministically and separates different invoice identities', async () => {
    const a = await provider.issue(payload);
    expect((await new FakeNfseProvider().issue(payload)).accessKey).toBe(
      a.accessKey,
    );
    expect(
      (await provider.issue({ ...payload, invoiceId: 'invoice-2' })).accessKey,
    ).not.toBe(a.accessKey);
  });
  it('renders a real PDF from test XML without a certificate', async () => {
    const result = await provider.issue(payload);
    const pdf = await provider.retrievePdf(result.accessKey!, 'test', payload);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2000);
  });
  it('refuses to simulate a live invoice', async () => {
    await expect(
      provider.issue({ ...payload, environment: 'live' }),
    ).rejects.toThrow('only in test');
  });
});

describe('Offline test invoices with a prebuilt DPS (preparedDps)', () => {
  const provider = new FakeNfseProvider();

  /** DPS already assembled by the fiscal engine, carrying the RTC IBSCBS group. */
  const preparedDps = (): DPS => {
    const base = buildDps({
      ...issueParams(payload),
      nDPS: String(payload.number ?? 1),
      skipCpfCnpjValidation: true,
    });
    return {
      ...base,
      infDPS: {
        ...base.infDPS,
        IBSCBS: {
          finNFSe: FinalidadeNFSe.Regular,
          cIndOp: '000000',
          indDest: IndicadorDestinatario.TomadorEhDestinatario,
          valores: { trib: { gIBSCBS: { CST: '000', cClassTrib: '060101' } } },
        },
      },
    };
  };

  it('issues the authorized XML from preparedDps with the IBSCBS group that parseNfseXml accepts', async () => {
    const result = await provider.issue({
      ...payload,
      preparedDps: preparedDps(),
    });

    expect(result.success).toBe(true);
    const xml = result.xmlAuthorized ?? '';
    expect(xml).toContain('IBSCBS');
    expect(xml).toContain('<cClassTrib>060101</cClassTrib>');
    const nfse = parseNfseXml(xml);
    expect(
      nfse.infNFSe.DPS.infDPS.IBSCBS?.valores.trib.gIBSCBS.cClassTrib,
    ).toBe('060101');
    expect(nfse.infNFSe.DPS.infDPS.valores.vServPrest.vServ).toBe(150.25);
    expect(nfse.infNFSe.DPS.infDPS.toma?.xNome).toBe('Cliente <Teste>');
  });

  it('keeps the access key deterministic when the same preparedDps is issued again', async () => {
    const dps = preparedDps();
    const first = await provider.issue({ ...payload, preparedDps: dps });
    const second = await provider.issue({ ...payload, preparedDps: dps });

    expect(second.accessKey).toBe(first.accessKey);
  });
});
