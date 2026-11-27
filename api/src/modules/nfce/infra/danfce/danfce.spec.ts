import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toDanfceView } from './danfce-view';

const xml = readFileSync(
  join(__dirname, '__fixtures__', 'nfce-proc-simples.xml'),
  'utf8',
);
const KEY = '35261111222333000181650010000000311123456780';

const withConsumer = (taxTag: string, value: string, name?: string) =>
  xml.replace(
    '<det nItem="1">',
    `<dest><${taxTag}>${value}</${taxTag}>${name ? `<xNome>${name}</xNome>` : ''}<indIEDest>9</indIEDest></dest><det nItem="1">`,
  );

/** The same NFC-e as an unsigned `NFe` in contingency: no `protNFe`, `tpEmis` 9. */
function offline(source: string): string {
  const bare = source
    .replace(/<protNFe[\s\S]*<\/protNFe>/, '')
    .replace(
      '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">',
      '',
    )
    .replace('</nfeProc>', '')
    .replace('<tpEmis>1</tpEmis>', '<tpEmis>9</tpEmis>');
  return bare;
}

describe('toDanfceView', () => {
  const view = toDanfceView(xml, { homologation: true });

  it('prints "CONSUMIDOR NÃO IDENTIFICADO" without a dest', () => {
    expect(view.consumer).toBe('CONSUMIDOR NÃO IDENTIFICADO');
  });

  it('masks the CPF of the consumer and prints the CNPJ in full', () => {
    expect(
      toDanfceView(withConsumer('CPF', '12345678909'), { homologation: false })
        .consumer,
    ).toBe('CONSUMIDOR - CPF ***.456.789-**');
    expect(
      toDanfceView(withConsumer('CNPJ', '11222333000181', 'Cliente SA'), {
        homologation: false,
      }).consumer,
    ).toBe('CONSUMIDOR - CNPJ 11.222.333/0001-81');
  });

  it('breaks the key in 11 blocks of four', () => {
    const groups = view.consult.accessKeyGroups.split(' ');
    expect(groups).toHaveLength(11);
    expect(groups.every((group) => group.length === 4)).toBe(true);
    expect(groups.join('')).toBe(KEY);
    expect(view.consult.urlChave).toBe(
      'https://www.homologacao.nfce.fazenda.sp.gov.br/consulta',
    );
  });

  it('names the payment methods and sums the change', () => {
    expect(view.payments).toEqual([
      { label: 'Cartão de Crédito', amount: '12,00' },
      { label: 'Dinheiro', amount: '10,00' },
    ]);
    expect(view.totals).toEqual({
      count: 1,
      vProd: '20,00',
      vDesc: '0,00',
      vNF: '20,00',
      vTroco: '2,00',
    });
  });

  it('reads the issuer, the items and the identification', () => {
    expect(view.issuer).toEqual({
      name: 'Empresa Teste LTDA',
      cnpj: '11.222.333/0001-81',
      address: 'Avenida Paulista, 1000, Bela Vista, São Paulo - SP, 01310-100',
    });
    expect(view.items[0]).toMatchObject({
      code: 'SKU1',
      quantity: '2',
      unit: 'UN',
      unitPrice: '10,00',
      total: '20,00',
    });
    expect(view.ident).toEqual({
      number: '31',
      series: '1',
      issuedAt: '26/11/2026 10:00:00',
      protocol: '135260000000002',
      authorizedAt: '26/11/2026 10:00:05',
    });
    expect(view.qrCode).toBe(
      `https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode?p=${KEY}|3|2`,
    );
    expect(view.additionalInfo).toBe('Pedido 1234 & retirada no balcão');
  });

  it('says it is a homologation note and has no fiscal value', () => {
    expect(view.messages).toContain(
      'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL',
    );
    expect(toDanfceView(xml, { homologation: false }).messages).not.toContain(
      'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL',
    );
  });

  it('marks a cancelled note', () => {
    expect(
      toDanfceView(xml, { homologation: false, cancelled: true }).messages,
    ).toContain('NFC-e CANCELADA');
  });

  it('reads an offline NFe without protocol: contingency and pending', () => {
    const pending = toDanfceView(offline(xml), { homologation: false });
    expect(pending.messages).toEqual([
      'EMITIDA EM CONTINGÊNCIA',
      'Pendente de autorização',
    ]);
    expect(pending.ident.protocol).toBe('');
    expect(pending.ident.authorizedAt).toBe('');
    expect(pending.consult.accessKeyGroups.replaceAll(' ', '')).toBe(KEY);
  });

  it('refuses an XML that is not an NFC-e', () => {
    expect(() => toDanfceView('<a/>', { homologation: true })).toThrow(
      'The XML is not an NFC-e',
    );
  });
});
