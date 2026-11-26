import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { DanfeRenderer } from './danfe-renderer';
import {
  formatAccessKey,
  formatDecimal,
  formatNumber,
  toDanfeView,
} from './danfe-view';

const xml = readFileSync(
  join(__dirname, '__fixtures__', 'nfe-proc-simples.xml'),
  'utf8',
);
const KEY = '35261111222333000181550010000000101123456783';

/** The same NF-e with `count` items (the first one stays as it is). */
function withItems(count: number): string {
  const det = /<det nItem="1">[\s\S]*?<\/det>/.exec(xml)![0];
  const items = Array.from({ length: count }, (_, index) =>
    det
      .replace('nItem="1"', `nItem="${index + 1}"`)
      .replace('Produto de teste', `Produto de teste item ${index + 1}`),
  ).join('');
  return xml.replace(det, items);
}

/**
 * pdfkit writes glyph ids, not letters, so the text the PDF prints is read where it is drawn:
 * every string handed to `doc.text`.
 */
async function render(
  source: string,
  options: { cancelled?: boolean; homologation?: boolean } = {},
) {
  const drawn: string[] = [];
  const proto = PDFDocument.prototype as unknown as {
    text: (...args: unknown[]) => unknown;
  };
  const original = proto.text;
  const spy = jest.spyOn(proto, 'text').mockImplementation(function (
    this: unknown,
    ...args: unknown[]
  ) {
    drawn.push(String(args[0]));
    return original.apply(this, args);
  });
  try {
    const pdf = await new DanfeRenderer().render(source, {
      homologation: options.homologation ?? true,
      cancelled: options.cancelled,
    });
    return { pdf, text: drawn.join('\n') };
  } finally {
    spy.mockRestore();
  }
}

const pages = (pdf: Buffer) =>
  pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

describe('danfe formatters', () => {
  it('breaks the key in blocks of four and pads the number', () => {
    expect(formatAccessKey(KEY)).toBe(
      '3526 1111 2223 3300 0181 5500 1000 0000 1011 2345 6783',
    );
    expect(formatNumber('10')).toBe('000.000.010');
    expect(formatNumber('123456789')).toBe('123.456.789');
  });

  it('formats money and quantities with the comma', () => {
    expect(formatDecimal('1234.5')).toBe('1.234,50');
    expect(formatDecimal('2', 4)).toBe('2,0000');
    expect(formatDecimal(undefined)).toBe('-');
  });
});

describe('toDanfeView', () => {
  const view = toDanfeView(xml);

  it('reads the key, the number and the protocol of the nfeProc', () => {
    expect(view).toMatchObject({
      accessKey: KEY,
      number: '000.000.010',
      series: '1',
      direction: '1',
      homologation: true,
      protocol: '135260000000001 - 26/11/2026 10:00:05',
      natOp: 'Venda de mercadoria',
      totalValue: '20,00',
      issuedAt: '26/11/2026 10:00:00',
    });
  });

  it('formats the issuer and the recipient (CPF, CEP, address)', () => {
    expect(view.emitter).toMatchObject({
      name: 'Empresa Teste LTDA',
      taxId: '11.222.333/0001-81',
      ie: '110042490114',
    });
    expect(view.emitter.addressLines[0]).toBe('Avenida Paulista, 1000');
    expect(view.recipient).toMatchObject({
      taxId: '123.456.789-09',
      zip: '01001-000',
      address: 'Rua das Flores, 10',
      state: 'SP',
    });
  });

  it('reads the item, the payment, the zeroed taxes and the transport', () => {
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({
      code: 'SKU1',
      ncm: '61091000',
      cst: '0102',
      cfop: '5102',
      quantity: '2,0000',
      unitPrice: '10,0000',
      total: '20,00',
      icmsValue: '0,00',
    });
    expect(view.payments).toEqual([
      { method: 'Pagamento instantâneo (PIX)', value: '20,00' },
    ]);
    expect(view.taxes.find((t) => t.label === 'VALOR DO ICMS')?.value).toBe(
      '0,00',
    );
    expect(view.transport[0].value).toBe('9 - Sem ocorrência de transporte');
    expect(view.additionalInfo).toBe('Pedido 1234 & entrega combinada');
  });

  it('prints "-" for the protocol of a bare NFe and rejects what is not an NF-e', () => {
    const bare = /<NFe[\s\S]*<\/NFe>/.exec(xml)![0];
    expect(toDanfeView(bare).protocol).toBe('-');
    expect(toDanfeView(bare).accessKey).toBe(KEY);
    expect(() => toDanfeView('<outra/>')).toThrow('not an NF-e');
  });
});

describe('DanfeRenderer', () => {
  it('is the renderer of the NF-e', () => {
    expect(new DanfeRenderer().type).toBe('nfe');
  });

  it('draws a one-page A4 DANFE with the key, the marks and the stub', async () => {
    const { pdf, text } = await render(xml);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(pdf)).toBe(1);
    expect(text).toContain(formatAccessKey(KEY));
    expect(text).toContain('SEM VALOR FISCAL');
    expect(text).toContain('DANFE');
    expect(text).toContain('RECEBEMOS DE Empresa Teste LTDA');
    expect(text).toContain('Folha 1/1');
    expect(text).toContain('135260000000001 - 26/11/2026 10:00:05');
    expect(text).not.toContain('CANCELADA');
  });

  it('adds the CANCELADA mark and drops the homologation one when asked', async () => {
    const { text } = await render(xml, {
      cancelled: true,
      homologation: false,
    });
    expect(text).toContain('CANCELADA');
    // What is left is the recipient name the SEFAZ requires in homologation (stub and recipient).
    const marks = (value: string) => value.split('SEM VALOR FISCAL').length - 1;
    expect(marks(text)).toBe(2);
    expect(marks((await render(xml)).text)).toBe(3);
  });

  it('breaks 60 items over two pages, repeating the column header', async () => {
    const { pdf, text } = await render(withItems(60));
    expect(pages(pdf)).toBeGreaterThanOrEqual(2);
    expect(text).toContain('Produto de teste item 60');
    expect(text).toContain(`Folha 2/${pages(pdf)}`);
    expect(text.split('DESCRIÇÃO DO PRODUTO / SERVIÇO').length - 1).toBe(
      pages(pdf),
    );
    expect(text.split(formatAccessKey(KEY)).length - 1).toBe(pages(pdf));
    expect(text).toContain('SEM VALOR FISCAL');
  });
});
