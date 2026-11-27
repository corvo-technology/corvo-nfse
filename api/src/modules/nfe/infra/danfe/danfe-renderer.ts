import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import type {
  DocumentRenderer,
  RenderOptions,
} from '@/modules/fiscal-core/domain/ports/renderer.port';
import { code128Widths, encodeCode128C } from './code128c';
import { toDanfeView, type DanfeItem, type DanfeView } from './danfe-view';

/**
 * The DANFE (Documento Auxiliar da NF-e), portrait A4, laid out after the Anexo II of the MOC:
 * receipt stub, issuer, Code 128C barcode of the key, nature of the operation, recipient, payment,
 * taxes (all zero in the Simples), transport, the items (page breaks repeat the column header)
 * and the additional data. The fonts are the ones the DANFSe already ships.
 */

const CM = 72 / 2.54;
const cm = (value: number) => value * CM;

const PAGE_W = 21;
const PAGE_H = 29.7;
const LEFT = 0.5;
const WIDTH = 20;
const BOTTOM = 29.0;
const PAD = 0.1;
const LINE = '#444444';
const INK = '#16191c';
const MUTED = '#555b60';
const SHADE = '#eceeef';

const ASSETS = join(__dirname, '../../../invoice/infra/danfse/assets');
const FONT_REGULAR = join(ASSETS, 'LiberationSans-Regular.ttf');
const FONT_BOLD = join(ASSETS, 'LiberationSans-Bold.ttf');

type Doc = InstanceType<typeof PDFDocument>;

export interface DanfeRenderOptions extends RenderOptions {
  /** Draws the CANCELADA mark. */
  cancelled?: boolean;
  /** Draws the SEM VALOR FISCAL mark (homologation). */
  homologation: boolean;
}

interface CellStyle {
  bold?: boolean;
  size?: number;
  align?: 'left' | 'center' | 'right';
  shaded?: boolean;
}

/** One framed cell: a small caption on top and the value below it. */
function cell(
  doc: Doc,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  style: CellStyle = {},
): void {
  if (style.shaded) doc.rect(cm(x), cm(y), cm(w), cm(h)).fill(SHADE);
  doc.lineWidth(0.5).rect(cm(x), cm(y), cm(w), cm(h)).stroke(LINE);
  const inner = cm(w) - 2 * cm(PAD);
  doc.fillColor(MUTED).font('bold').fontSize(5.5);
  doc.text(label, cm(x) + cm(PAD), cm(y) + 2.2, {
    width: inner,
    lineBreak: false,
    ellipsis: true,
  });
  doc
    .fillColor(INK)
    .font(style.bold ? 'bold' : 'regular')
    .fontSize(style.size ?? 8);
  doc.text(value, cm(x) + cm(PAD), cm(y) + 10, {
    width: inner,
    height: Math.max(0, cm(h) - 11),
    align: style.align ?? 'left',
    ellipsis: true,
  });
}

/** A row of cells that share the height; `widths` are in cm and must add up to the content width. */
function row(
  doc: Doc,
  y: number,
  h: number,
  cells: Array<[number, string, string, CellStyle?]>,
): number {
  let x = LEFT;
  for (const [w, label, value, style] of cells) {
    cell(doc, x, y, w, h, label, value, style);
    x += w;
  }
  return y + h;
}

function section(doc: Doc, y: number, title: string): number {
  doc.fillColor(INK).font('bold').fontSize(6.5);
  doc.text(title, cm(LEFT), cm(y) + 1.5, { lineBreak: false });
  return y + 0.38;
}

function drawBarcode(
  doc: Doc,
  digits: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const widths = code128Widths(encodeCode128C(digits));
  const modules = widths.reduce((sum, width) => sum + width, 0);
  const unit = cm(w) / modules;
  let at = cm(x);
  widths.forEach((width, index) => {
    if (index % 2 === 0) doc.rect(at, cm(y), width * unit, cm(h)).fill('#000');
    at += width * unit;
  });
  doc.fillColor(INK);
}

function drawStub(doc: Doc, view: DanfeView, y: number): number {
  const h = 1.6;
  const stubW = 16;
  const text =
    `RECEBEMOS DE ${view.emitter.name} OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA AO LADO. ` +
    `EMISSÃO: ${view.issuedAt}  VALOR TOTAL: R$ ${view.totalValue}  DESTINATÁRIO: ${view.recipient.name}`;
  doc.lineWidth(0.5).rect(cm(LEFT), cm(y), cm(stubW), cm(h)).stroke(LINE);
  doc.fillColor(INK).font('regular').fontSize(6.5);
  doc.text(text, cm(LEFT) + cm(PAD), cm(y) + 3, {
    width: cm(stubW) - 2 * cm(PAD),
    height: cm(0.75),
    ellipsis: true,
  });
  row(doc, y + 0.85, 0.75, [
    [3.5, 'DATA DE RECEBIMENTO', ''],
    [stubW - 3.5, 'IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR', ''],
  ]);
  const boxX = LEFT + stubW;
  doc
    .lineWidth(0.5)
    .rect(cm(boxX), cm(y), cm(WIDTH - stubW), cm(h))
    .stroke(LINE);
  doc.fillColor(INK).font('bold').fontSize(10);
  doc.text('NF-e', cm(boxX), cm(y) + 4, {
    width: cm(WIDTH - stubW),
    align: 'center',
  });
  doc.fontSize(8).text(`Nº ${view.number}`, cm(boxX), cm(y) + 18, {
    width: cm(WIDTH - stubW),
    align: 'center',
  });
  doc.text(`SÉRIE ${view.series}`, cm(boxX), cm(y) + 29, {
    width: cm(WIDTH - stubW),
    align: 'center',
  });
  const cut = y + h + 0.15;
  doc
    .lineWidth(0.5)
    .dash(3, { space: 3 })
    .moveTo(cm(LEFT), cm(cut))
    .lineTo(cm(LEFT + WIDTH), cm(cut))
    .stroke(LINE)
    .undash();
  return cut + 0.25;
}

/** The identification block: issuer, DANFE title and barcode. Returns the y below it. */
function drawHeader(doc: Doc, view: DanfeView, y: number): number {
  const h = 3.3;
  const emitW = 8.3;
  const titleW = 3.9;
  const keyW = WIDTH - emitW - titleW;
  doc.lineWidth(0.5);
  doc.rect(cm(LEFT), cm(y), cm(emitW), cm(h)).stroke(LINE);
  doc.fillColor(MUTED).font('bold').fontSize(5.5);
  doc.text('IDENTIFICAÇÃO DO EMITENTE', cm(LEFT) + cm(PAD), cm(y) + 2.2, {
    lineBreak: false,
  });
  doc.fillColor(INK).font('bold').fontSize(10);
  const nameBottom = doc.y;
  doc.text(view.emitter.name, cm(LEFT) + cm(PAD), nameBottom + 5, {
    width: cm(emitW) - 2 * cm(PAD),
    height: cm(1.1),
    ellipsis: true,
  });
  doc.font('regular').fontSize(7.5);
  doc.text(
    view.emitter.addressLines.join('\n'),
    cm(LEFT) + cm(PAD),
    cm(y) + cm(1.55),
    { width: cm(emitW) - 2 * cm(PAD), height: cm(1.6), ellipsis: true },
  );

  const titleX = LEFT + emitW;
  doc.rect(cm(titleX), cm(y), cm(titleW), cm(h)).stroke(LINE);
  doc.fillColor(INK).font('bold').fontSize(13);
  doc.text('DANFE', cm(titleX), cm(y) + 5, {
    width: cm(titleW),
    align: 'center',
  });
  doc.font('regular').fontSize(6.5);
  doc.text(
    'Documento Auxiliar da Nota Fiscal Eletrônica',
    cm(titleX) + cm(PAD),
    cm(y) + 22,
    { width: cm(titleW) - 2 * cm(PAD), align: 'center' },
  );
  doc.fontSize(6.5).text('0 - ENTRADA', cm(titleX) + cm(0.3), cm(y) + 44, {
    lineBreak: false,
  });
  doc.text('1 - SAÍDA', cm(titleX) + cm(0.3), cm(y) + 52, { lineBreak: false });
  doc
    .rect(cm(titleX + titleW - 1.2), cm(y) + 43, cm(0.7), cm(0.55))
    .stroke(LINE);
  doc.font('bold').fontSize(9);
  doc.text(view.direction, cm(titleX + titleW - 1.2), cm(y) + 46, {
    width: cm(0.7),
    align: 'center',
  });
  doc.fontSize(8).text(`Nº ${view.number}`, cm(titleX), cm(y) + 66, {
    width: cm(titleW),
    align: 'center',
  });
  doc.text(`SÉRIE ${view.series}`, cm(titleX), cm(y) + 77, {
    width: cm(titleW),
    align: 'center',
  });

  const keyX = titleX + titleW;
  doc.rect(cm(keyX), cm(y), cm(keyW), cm(h)).stroke(LINE);
  drawBarcode(doc, view.accessKey, keyX + 0.3, y + 0.2, keyW - 0.6, 1.2);
  doc.fillColor(MUTED).font('bold').fontSize(5.5);
  doc.text('CHAVE DE ACESSO', cm(keyX) + cm(PAD), cm(y) + cm(1.5), {
    lineBreak: false,
  });
  doc.fillColor(INK).font('bold').fontSize(8);
  doc.text(view.accessKeyFormatted, cm(keyX), cm(y) + cm(1.5) + 8, {
    width: cm(keyW),
    align: 'center',
    lineBreak: false,
  });
  doc.font('regular').fontSize(6);
  doc.text(
    'Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora',
    cm(keyX) + cm(PAD),
    cm(y) + cm(2.35),
    { width: cm(keyW) - 2 * cm(PAD), align: 'center' },
  );
  return y + h;
}

/** The slim header of the pages after the first one. Returns the y below it. */
function drawContinuation(doc: Doc, view: DanfeView, y: number): number {
  const h = 1.0;
  doc.lineWidth(0.5).rect(cm(LEFT), cm(y), cm(WIDTH), cm(h)).stroke(LINE);
  doc.fillColor(INK).font('bold').fontSize(8);
  doc.text(`DANFE  -  ${view.emitter.name}`, cm(LEFT) + cm(PAD), cm(y) + 5, {
    width: cm(9.5),
    lineBreak: false,
    ellipsis: true,
  });
  doc.font('regular').fontSize(7);
  doc.text(
    `NF-e Nº ${view.number}  SÉRIE ${view.series}`,
    cm(LEFT) + cm(PAD),
    cm(y) + 15,
    { lineBreak: false },
  );
  doc.text(view.accessKeyFormatted, cm(LEFT + 9.5), cm(y) + 15, {
    width: cm(8),
    align: 'right',
    lineBreak: false,
  });
  return y + h;
}

interface Column {
  label: string;
  width: number;
  align: 'left' | 'right' | 'center';
  value: (item: DanfeItem) => string;
}

const COLUMNS: Column[] = [
  { label: 'CÓDIGO', width: 1.5, align: 'left', value: (i) => i.code },
  {
    label: 'DESCRIÇÃO DO PRODUTO / SERVIÇO',
    width: 4.0,
    align: 'left',
    value: (i) => i.description,
  },
  { label: 'NCM/SH', width: 1.5, align: 'center', value: (i) => i.ncm },
  { label: 'O/CSOSN', width: 1.0, align: 'center', value: (i) => i.cst },
  { label: 'CFOP', width: 0.9, align: 'center', value: (i) => i.cfop },
  { label: 'UN', width: 0.8, align: 'center', value: (i) => i.unit },
  { label: 'QUANT.', width: 1.4, align: 'right', value: (i) => i.quantity },
  { label: 'V. UNIT.', width: 1.4, align: 'right', value: (i) => i.unitPrice },
  { label: 'V. TOTAL', width: 1.4, align: 'right', value: (i) => i.total },
  { label: 'V. DESC.', width: 1.1, align: 'right', value: (i) => i.discount },
  { label: 'BC ICMS', width: 1.3, align: 'right', value: (i) => i.icmsBase },
  { label: 'V. ICMS', width: 1.1, align: 'right', value: (i) => i.icmsValue },
  { label: 'V. IPI', width: 1.0, align: 'right', value: (i) => i.ipiValue },
  { label: 'ALÍQ. ICMS', width: 0.8, align: 'right', value: (i) => i.icmsRate },
  { label: 'ALÍQ. IPI', width: 0.8, align: 'right', value: (i) => i.ipiRate },
];

const TABLE_FONT = 6.3;
const HEAD_H = 0.6;

function drawTableHead(doc: Doc, y: number): number {
  let x = LEFT;
  for (const column of COLUMNS) {
    doc.rect(cm(x), cm(y), cm(column.width), cm(HEAD_H)).fill(SHADE);
    doc
      .lineWidth(0.5)
      .rect(cm(x), cm(y), cm(column.width), cm(HEAD_H))
      .stroke(LINE);
    doc.fillColor(INK).font('bold').fontSize(4.6);
    doc.text(column.label, cm(x) + 1, cm(y) + 4, {
      width: cm(column.width) - 2,
      height: cm(HEAD_H) - 4,
      align: 'center',
      ellipsis: true,
    });
    x += column.width;
  }
  return y + HEAD_H;
}

function itemHeight(doc: Doc, item: DanfeItem): number {
  const description = COLUMNS[1];
  doc.font('regular').fontSize(TABLE_FONT);
  const wrapped = doc.heightOfString(item.description, {
    width: cm(description.width) - 2,
  });
  return Math.max(0.5, (wrapped + 5) / CM);
}

function drawItem(doc: Doc, item: DanfeItem, y: number, h: number): void {
  let x = LEFT;
  doc.fillColor(INK).font('regular').fontSize(TABLE_FONT);
  for (const column of COLUMNS) {
    doc.lineWidth(0.3).rect(cm(x), cm(y), cm(column.width), cm(h)).stroke(LINE);
    doc.text(column.value(item), cm(x) + 1, cm(y) + 2.5, {
      width: cm(column.width) - 2,
      height: cm(h) - 3,
      align: column.align,
      ...(column === COLUMNS[1] ? {} : { lineBreak: false }),
    });
    x += column.width;
  }
}

function drawFooter(doc: Doc, y: number): void {
  doc.fillColor('#8a9096').font('regular').fontSize(5.5);
  doc.text(
    'DANFE gerado por Corvo - documento auxiliar da NF-e',
    cm(LEFT),
    cm(y),
    { width: cm(WIDTH), align: 'center', lineBreak: false },
  );
}

function drawMarks(doc: Doc, marks: string[]): void {
  doc.save();
  doc.rotate(-45, { origin: [cm(PAGE_W / 2), cm(PAGE_H / 2)] });
  doc.fillColor('#b00020').fillOpacity(0.2).font('bold').fontSize(60);
  marks.forEach((mark, index) => {
    const width = doc.widthOfString(mark);
    doc.text(
      mark,
      cm(PAGE_W / 2) - width / 2,
      cm(PAGE_H / 2) - 30 + index * 64,
      { lineBreak: false },
    );
  });
  doc.restore();
  doc.fillOpacity(1).fillColor(INK);
}

/** Parties, payment, taxes and transport: everything above the items. Returns the y below it. */
function drawBody(doc: Doc, view: DanfeView, start: number): number {
  let y = row(doc, start, 0.85, [
    [12, 'NATUREZA DA OPERAÇÃO', view.natOp],
    [8, 'PROTOCOLO DE AUTORIZAÇÃO DE USO', view.protocol],
  ]);
  y = row(doc, y, 0.85, [
    [6.67, 'INSCRIÇÃO ESTADUAL', view.emitter.ie],
    [6.67, 'INSCRIÇÃO ESTADUAL DO SUBST. TRIBUT.', view.emitter.ieSt],
    [6.66, 'CNPJ / CPF', view.emitter.taxId],
  ]);

  y = section(doc, y + 0.1, 'DESTINATÁRIO / REMETENTE');
  const r = view.recipient;
  y = row(doc, y, 0.85, [
    [12, 'NOME / RAZÃO SOCIAL', r.name],
    [4.5, 'CNPJ / CPF', r.taxId],
    [3.5, 'DATA DA EMISSÃO', r.issueDate],
  ]);
  y = row(doc, y, 0.85, [
    [9, 'ENDEREÇO', r.address],
    [4.5, 'BAIRRO / DISTRITO', r.district],
    [3, 'CEP', r.zip],
    [3.5, 'DATA DA SAÍDA / ENTRADA', r.exitDate],
  ]);
  y = row(doc, y, 0.85, [
    [9, 'MUNICÍPIO', r.city],
    [4.5, 'FONE / FAX', r.phone],
    [1.5, 'UF', r.state],
    [3, 'INSCRIÇÃO ESTADUAL', r.ie],
    [2, 'HORA SAÍDA', r.exitTime],
  ]);

  y = section(doc, y + 0.1, 'PAGAMENTO');
  const payments = view.payments.length
    ? view.payments
    : [{ method: '-', value: '-' }];
  for (const payment of payments)
    y = row(doc, y, 0.7, [
      [14, 'FORMA DE PAGAMENTO', payment.method],
      [6, 'VALOR (R$)', payment.value, { align: 'right' }],
    ]);

  y = section(doc, y + 0.1, 'CÁLCULO DO IMPOSTO');
  const right: CellStyle = { align: 'right' };
  const total = view.taxes[10];
  y = row(
    doc,
    y,
    0.8,
    view.taxes
      .slice(0, 5)
      .map((t): [number, string, string, CellStyle] => [
        4,
        t.label,
        t.value,
        right,
      ]),
  );
  y = row(doc, y, 0.8, [
    ...view.taxes
      .slice(5, 10)
      .map((t): [number, string, string, CellStyle] => [
        3.2,
        t.label,
        t.value,
        right,
      ]),
    [4, total.label, total.value, { ...right, bold: true, shaded: true }],
  ]);

  y = section(doc, y + 0.1, 'TRANSPORTADOR / VOLUMES TRANSPORTADOS');
  const [freight, ...others] = view.transport;
  return row(doc, y, 0.8, [
    [others.length > 0 ? 9 : WIDTH, freight.label, freight.value],
    ...others.map((t): [number, string, string] => [
      11 / others.length,
      t.label,
      t.value,
    ]),
  ]);
}

/** The items, breaking the page (and repeating the column header) when a row does not fit. */
function drawItems(doc: Doc, view: DanfeView, start: number): number {
  let y = drawTableHead(
    doc,
    section(doc, start + 0.1, 'DADOS DOS PRODUTOS / SERVIÇOS'),
  );
  for (const item of view.items) {
    const h = itemHeight(doc, item);
    if (y + h > BOTTOM - 0.4) {
      doc.addPage();
      y = drawTableHead(doc, drawContinuation(doc, view, LEFT));
    }
    drawItem(doc, item, y, h);
    y += h;
  }
  return y;
}

function drawAdditional(doc: Doc, view: DanfeView, start: number): void {
  // A note issued in the SVC says so first, before anything the issuer wrote.
  const info =
    [view.contingency, view.additionalInfo].filter(Boolean).join('\n') || '-';
  doc.font('regular').fontSize(7);
  const infoH = Math.min(
    BOTTOM - LEFT - 2,
    Math.max(
      2.4,
      (doc.heightOfString(info, { width: cm(14) - 2 * cm(PAD) }) + 12) / CM,
    ),
  );
  let y = start + 0.1;
  if (y + 0.38 + infoH > BOTTOM) {
    doc.addPage();
    y = drawContinuation(doc, view, LEFT) + 0.1;
  }
  y = section(doc, y, 'DADOS ADICIONAIS');
  row(doc, y, infoH, [
    [14, 'INFORMAÇÕES COMPLEMENTARES', info, { size: 7 }],
    [6, 'RESERVADO AO FISCO', ''],
  ]);
}

/**
 * What needs the page count or sits over everything: "Folha n/N" (in the title block of the first
 * page and in the slim header of the others), the footer and the marks.
 */
function stamp(doc: Doc, headerTop: number, marks: string[]): void {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    doc.fillColor(INK).font('regular').fontSize(7);
    const folio = `Folha ${index + 1}/${range.count}`;
    if (index === 0)
      doc.text(folio, cm(LEFT + 8.3), cm(headerTop) + 85, {
        width: cm(3.9),
        align: 'center',
        lineBreak: false,
      });
    else
      doc.text(folio, cm(LEFT + 15), cm(LEFT) + 5, {
        width: cm(4.9),
        align: 'right',
        lineBreak: false,
      });
    drawFooter(doc, PAGE_H - 0.55);
    if (marks.length > 0) drawMarks(doc, marks);
  }
}

export async function renderDanfe(
  view: DanfeView,
  options: { cancelled: boolean; homologation: boolean },
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    bufferPages: true,
    info: {
      Title: `DANFE NF-e ${view.number}`,
      Author: 'Corvo',
      Producer: 'Corvo NF-e',
    },
  });
  doc.registerFont('regular', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const headerTop = drawStub(doc, view, LEFT);
  let y = drawHeader(doc, view, headerTop);
  y = drawBody(doc, view, y);
  y = drawItems(doc, view, y);
  drawAdditional(doc, view, y);

  const marks: string[] = [];
  if (options.homologation) marks.push('SEM VALOR FISCAL');
  if (options.cancelled) marks.push('CANCELADA');
  stamp(doc, headerTop, marks);
  doc.end();
  return done;
}

export class DanfeRenderer implements DocumentRenderer {
  readonly type = 'nfe' as const;

  render(authorizedXml: string, opts: DanfeRenderOptions): Promise<Buffer> {
    return renderDanfe(toDanfeView(authorizedXml), {
      cancelled: opts.cancelled === true,
      homologation: opts.homologation,
    });
  }
}
