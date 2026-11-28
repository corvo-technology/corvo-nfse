import type { LoadedCertificate } from '@/modules/fiscal-core/domain/ports/xml.port';
import {
  cadastroEndpointFor,
  cadastroUfs,
  consCadXml,
  lookupCadastro,
  parseRetConsCad,
} from './cadastro';
import type { SoapRequest, SoapResult } from './soap-client';

/** retConsCad as the MOC (Anexo II, consulta cadastro 2.00) lays it out. */
const ret = (body: string) =>
  `<retConsCad xmlns="http://www.portalfiscal.inf.br/nfe" versao="2.00"><infCons>${body}</infCons></retConsCad>`;

const infCad = (ie: string, cSit: string, indCredNFe: string | null = '1') =>
  `<infCad><IE>${ie}</IE><CNPJ>11222333000181</CNPJ><UF>SP</UF><cSit>${cSit}</cSit>` +
  (indCredNFe === null ? '' : `<indCredNFe>${indCredNFe}</indCredNFe>`) +
  '<indCredCTe>4</indCredCTe><xNome>EMPRESA TESTE LTDA</xNome><xRegApur>SIMPLES NACIONAL</xRegApur>' +
  '<CNAE>6201501</CNAE><dIniAtiv>2020-01-10</dIniAtiv><dUltSit>2020-01-10</dUltSit>' +
  '<ender><xLgr>RUA A</xLgr><nro>10</nro><xBairro>CENTRO</xBairro><cMun>3550308</cMun><xMun>SAO PAULO</xMun><CEP>01310100</CEP></ender></infCad>';

const head = (cStat: string, xMotivo: string) =>
  `<verAplic>SP_NFE_PL_009</verAplic><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><UF>SP</UF><CNPJ>11222333000181</CNPJ><dhCons>2026-11-27T10:00:00-03:00</dhCons><cUF>35</cUF>`;

describe('parseRetConsCad', () => {
  it('cStat 111: one registration, enabled and credentialed', () => {
    expect(
      parseRetConsCad(
        ret(
          head('111', 'Consulta cadastro com uma ocorrência') +
            infCad('110.042.490.114', '1'),
        ),
      ),
    ).toEqual({
      kind: 'found',
      registrations: [
        {
          stateRegistration: '110042490114',
          enabled: true,
          nfeCredential: 'yes',
        },
      ],
    });
  });

  it('cStat 112: several registrations, one not enabled and one not credentialed', () => {
    expect(
      parseRetConsCad(
        ret(
          head('112', 'Consulta cadastro com mais de uma ocorrência') +
            infCad('110042490114', '1', '2') +
            infCad('123456785004', '0', '0') +
            infCad('111111111111', '1', '4'),
        ),
      ),
    ).toEqual({
      kind: 'found',
      registrations: [
        {
          stateRegistration: '110042490114',
          enabled: true,
          nfeCredential: 'yes',
        },
        {
          stateRegistration: '123456785004',
          enabled: false,
          nfeCredential: 'no',
        },
        {
          stateRegistration: '111111111111',
          enabled: true,
          nfeCredential: 'unknown',
        },
      ],
    });
  });

  it('a missing indCredNFe is "unknown"', () => {
    const answer = parseRetConsCad(
      ret(head('111', 'ok') + infCad('110042490114', '1', null)),
    );
    expect(answer).toMatchObject({
      registrations: [{ nfeCredential: 'unknown' }],
    });
  });

  it('cStat 259: the CNPJ has no registration in the UF', () => {
    expect(
      parseRetConsCad(
        ret(
          head(
            '259',
            'Rejeição: CNPJ da consulta não cadastrado como contribuinte na UF',
          ),
        ),
      ),
    ).toEqual({ kind: 'not_found' });
  });

  it('a rejection carries the cStat and the reason of the SEFAZ', () => {
    expect(
      parseRetConsCad(ret(head('243', 'Rejeição: XML Mal Formado'))),
    ).toEqual({
      kind: 'rejected',
      cStat: '243',
      reason: 'Rejeição: XML Mal Formado',
    });
    expect(parseRetConsCad(ret(head('656', 'Consumo Indevido')))).toEqual({
      kind: 'rejected',
      cStat: '656',
      reason: 'Consumo Indevido',
    });
  });

  it('finds retConsCad inside a wrapper the unwrapping left', () => {
    const wrapped = `<consultaCadastroResult><nfeResultMsg>${ret(
      head('111', 'ok') + infCad('110042490114', '1'),
    )}</nfeResultMsg></consultaCadastroResult>`;
    expect(parseRetConsCad(wrapped).kind).toBe('found');
    expect(
      parseRetConsCad(`<wrap>${ret(head('243', 'Mal formado'))}</wrap>`),
    ).toMatchObject({ kind: 'rejected', cStat: '243' });
  });

  it('garbage, an empty answer or 111 without IE is unavailable', () => {
    expect(parseRetConsCad('not xml at all')).toEqual({ kind: 'unavailable' });
    expect(parseRetConsCad('<other><x>1</x></other>')).toEqual({
      kind: 'unavailable',
    });
    expect(parseRetConsCad(ret(head('111', 'sem infCad')))).toEqual({
      kind: 'unavailable',
    });
  });
});

describe('consulta endpoints', () => {
  it('SP has its own; a UF served by SVRS goes there; AM and MA have none', () => {
    expect(cadastroEndpointFor('SP')).toMatchObject({
      authority: 'SP',
      url: 'https://nfe.fazenda.sp.gov.br/ws/cadconsultacadastro4.asmx',
      soapAction:
        'http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4/consultaCadastro',
    });
    expect(cadastroEndpointFor('SC')?.authority).toBe('SVRS');
    expect(cadastroEndpointFor('AM')).toBeUndefined();
    expect(cadastroEndpointFor('MA')).toBeUndefined();
  });

  it('every row is https production and names the CadConsultaCadastro4 service', () => {
    for (const uf of cadastroUfs()) {
      const endpoint = cadastroEndpointFor(uf)!;
      expect(endpoint.url).toMatch(/^https:\/\//);
      expect(endpoint.url).not.toMatch(/hom|homolog/i);
      expect(endpoint.soapAction).toMatch(
        /CadConsultaCadastro4\/consultaCadastro4?$/,
      );
    }
  });

  it('builds consCad 2.00 by CNPJ', () => {
    expect(consCadXml('SP', '11222333000181')).toBe(
      '<ConsCad xmlns="http://www.portalfiscal.inf.br/nfe" versao="2.00"><infCons><xServ>CONS-CAD</xServ><UF>SP</UF><CNPJ>11222333000181</CNPJ></infCons></ConsCad>',
    );
  });
});

describe('lookupCadastro', () => {
  const certificate = {
    certPem: '',
    keyPem: '',
    cnpj: '11222333000181',
    notAfter: new Date('2030-01-01'),
  } as LoadedCertificate;
  const soap = (result: SoapResult) => {
    const call = jest.fn<Promise<SoapResult>, [SoapRequest]>(() =>
      Promise.resolve(result),
    );
    return { call };
  };

  it('sends the consulta to the UF endpoint and parses the answer', async () => {
    const client = soap({
      kind: 'ok',
      bodyXml: ret(head('111', 'ok') + infCad('110042490114', '1')),
      durationMs: 5,
    });
    const answer = await lookupCadastro(
      client,
      5000,
      'SP',
      '11222333000181',
      certificate,
    );
    expect(answer.kind).toBe('found');
    const request = client.call.mock.calls[0][0];
    expect(request.endpoint.url).toContain('nfe.fazenda.sp.gov.br');
    expect(request.bodyXml).toContain('<CNPJ>11222333000181</CNPJ>');
  });

  it('is unavailable (and calls nobody) for a UF with no service or a bad CNPJ', async () => {
    const client = soap({ kind: 'unavailable' });
    expect(
      await lookupCadastro(client, 5000, 'AM', '11222333000181', certificate),
    ).toEqual({ kind: 'unavailable' });
    expect(
      await lookupCadastro(client, 5000, 'SP', '123', certificate),
    ).toEqual({ kind: 'unavailable' });
    expect(client.call).not.toHaveBeenCalled();
  });

  it('a network failure is unavailable', async () => {
    const client = soap({ kind: 'uncertain', reason: 'timeout' });
    expect(
      await lookupCadastro(client, 5000, 'SP', '11222333000181', certificate),
    ).toEqual({ kind: 'unavailable' });
  });

  it('logs the kind, cStat and reason, never the CNPJ', async () => {
    const log = jest.fn();
    const client = soap({
      kind: 'ok',
      bodyXml: ret(head('243', 'Rejeição: XML Mal Formado')),
      durationMs: 5,
    });
    await lookupCadastro(
      client,
      5000,
      'SP',
      '11222333000181',
      certificate,
      log,
    );
    expect(log).toHaveBeenCalledWith({
      authority: 'SP',
      service: 'CadConsultaCadastro4',
      kind: 'rejected',
      cStat: '243',
      xMotivo: 'Rejeição: XML Mal Formado',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('11222333000181');
  });

  it('logs only a safe hint (root element and size) for an answer it does not understand', async () => {
    const log = jest.fn();
    const body = '<weird><CNPJ>11222333000181</CNPJ></weird>';
    await lookupCadastro(
      soap({ kind: 'ok', bodyXml: body, durationMs: 5 }),
      5000,
      'SP',
      '11222333000181',
      certificate,
      log,
    );
    expect(log).toHaveBeenCalledWith({
      authority: 'SP',
      service: 'CadConsultaCadastro4',
      kind: 'unavailable',
      hint: `root=weird length=${body.length}`,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('11222333000181');
  });
});
