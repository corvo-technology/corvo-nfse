import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { DanfceRenderer } from './danfce-renderer';

const xml = readFileSync(
  join(__dirname, '__fixtures__', 'nfce-proc-simples.xml'),
  'utf8',
);
const KEY_GROUPS = '3526 1111 2223 3300 0181 6500 1000 0000 3111 2345 6780';

/** The same NFC-e with `count` items. */
function withItems(count: number): string {
  const det = /<det nItem="1">[\s\S]*?<\/det>/.exec(xml)![0];
  const items = Array.from({ length: count }, (_, index) =>
    det
      .replace('nItem="1"', `nItem="${index + 1}"`)
      .replace(/<xProd>[^<]*<\/xProd>/, `<xProd>Produto ${index + 1}</xProd>`),
  ).join('');
  return xml.replace(det, items);
}

/** pdfkit writes glyph ids, not letters: the text is read where it is drawn. */
async function render(
  source: string,
  options: { layout?: 'a4' | '80mm'; cancelled?: boolean } = {},
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
    const pdf = await new DanfceRenderer().render(source, {
      homologation: true,
      ...options,
    });
    return { pdf, text: drawn.join('\n') };
  } finally {
    spy.mockRestore();
  }
}

const pages = (pdf: Buffer) =>
  pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

const mediaBox = (pdf: Buffer): number[] => {
  const match = /\/MediaBox \[([^\]]+)\]/.exec(pdf.toString('latin1'));
  return match![1].split(/\s+/).map(Number);
};

describe('DanfceRenderer', () => {
  it('is the renderer of the nfce type', () => {
    expect(new DanfceRenderer().type).toBe('nfce');
  });

  it('draws a PDF 80 mm wide with the data of the cupom', async () => {
    const { pdf, text } = await render(xml);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const [, , width, height] = mediaBox(pdf);
    expect(width).toBeCloseTo(226.77, 1);
    expect(height).toBeGreaterThan(300);
    expect(pages(pdf)).toBe(1);
    for (const expected of [
      'Empresa Teste LTDA',
      'CNPJ: 11.222.333/0001-81',
      'CONSUMIDOR NÃO IDENTIFICADO',
      'Consulte pela Chave de Acesso em',
      'https://www.homologacao.nfce.fazenda.sp.gov.br/consulta',
      KEY_GROUPS,
      'Cartão de Crédito',
      'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL',
      '135260000000002',
      'Pedido 1234 & retirada no balcão',
    ])
      expect(text).toContain(expected);
    expect(text).toMatch(/NFC-e n[ºo] 31/);
    expect(text).toContain('Série 1');
  });

  it('keeps one page for 60 items and grows the height with them', async () => {
    const small = await render(xml);
    const big = await render(withItems(60));
    expect(pages(big.pdf)).toBe(1);
    expect(mediaBox(big.pdf)[2]).toBeCloseTo(226.77, 1);
    expect(mediaBox(big.pdf)[3]).toBeGreaterThan(mediaBox(small.pdf)[3] + 1000);
    expect(big.text).toContain('Produto 60');
  });

  it('draws the A4 layout and breaks the page when needed', async () => {
    const { pdf, text } = await render(xml, { layout: 'a4' });
    const [, , width, height] = mediaBox(pdf);
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
    expect(pages(pdf)).toBe(1);
    expect(text).toContain(KEY_GROUPS);
    const long = await render(withItems(80), { layout: 'a4' });
    expect(pages(long.pdf)).toBeGreaterThan(1);
    expect(long.text).toContain('Produto 80');
  });

  it('marks a cancelled note', async () => {
    const { text } = await render(xml, { cancelled: true });
    expect(text).toContain('NFC-e CANCELADA');
  });

  it('defaults to 80 mm', async () => {
    const { pdf } = await render(xml, {});
    expect(mediaBox(pdf)[2]).toBeCloseTo(226.77, 1);
  });
});
