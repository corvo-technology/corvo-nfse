import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { Block, Cell, DanfseView, GridBlock, Row } from './danfse-view';

/** Layout constants from the NT SE/CGNFS-e 008/2026 table (Anexo I), in centimetres. */
const CM = 72 / 2.54;
const cm = (value: number) => value * CM;
const COL_X = [0.3, 5.41, 10.51, 15.62] as const;
const COL_W = 5.09;
const FULL_W = 20.4;
const PAGE_W = 21;
const PAGE_H = 29.7;
const BOTTOM = 29.4;
const ROW_H = 0.63;
const PAD = 0.1;
const SHADE = '#f4f6f5';
const INK = '#16191c';
const MUTED = '#6a7279';
const FAINT = '#a9b0b5';
const HAIR = '#dfe3e2';
const ACCENT = '#1b6b47';
const LABEL_PT = 6;
const VALUE_PT = 8;
const TITLE_PT = 7;

const ASSETS = join(__dirname, 'assets');
const FONT_REGULAR = join(ASSETS, 'LiberationSans-Regular.ttf');
const FONT_BOLD = join(ASSETS, 'LiberationSans-Bold.ttf');
const LOGO = readFileSync(join(ASSETS, 'nfse-logo.png'));

type Doc = InstanceType<typeof PDFDocument>;

const QR_CAPTION =
  'A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e';

function spanWidth(cell: Cell): number {
  const span = cell.span ?? 1;
  return span * COL_W + (span - 1) * 0.0;
}

function textHeight(
  doc: Doc,
  text: string,
  font: string,
  size: number,
  width: number,
): number {
  doc.font(font).fontSize(size);
  return doc.heightOfString(text, { width: width - 2 * cm(PAD) });
}

const valueSize = (cell: Cell) =>
  cell.emphasis ? (cell.shaded ? 12 : 10) : VALUE_PT;

/** Height (cm) a cell needs: label line plus the wrapped value. */
function cellHeight(doc: Doc, cell: Cell): number {
  const width = cm(spanWidth(cell));
  const label = textHeight(doc, cell.label, 'bold', LABEL_PT, width);
  const value = textHeight(doc, cell.value, 'regular', valueSize(cell), width);
  return Math.max(ROW_H, (label + value) / CM + 0.26);
}

function drawCell(doc: Doc, cell: Cell, y: number, height: number): void {
  const x = cm(COL_X[cell.col]);
  const width = cm(spanWidth(cell));
  const dark = cell.emphasis && cell.shaded;
  if (dark) doc.rect(x, cm(y), width, cm(height)).fill(ACCENT);
  const inner = width - 2 * cm(PAD);
  doc.font('bold').fontSize(cell.caps ? TITLE_PT : LABEL_PT);
  const labelHeight = doc.heightOfString(cell.label, { width: inner });
  doc.fillColor(dark ? '#cfe6da' : MUTED);
  doc.text(cell.label, x + cm(PAD), cm(y) + cm(0.1), { width: inner });
  const empty = cell.value === '-';
  doc.font(cell.emphasis ? 'bold' : 'regular').fontSize(valueSize(cell));
  doc.fillColor(
    dark ? '#ffffff' : empty ? FAINT : cell.emphasis ? ACCENT : INK,
  );
  doc.text(cell.value, x + cm(PAD), cm(y) + cm(0.1) + labelHeight + 2, {
    width: inner,
  });
  doc.fillColor(INK);
}

function rowHeight(doc: Doc, row: Row, titleHeight = 0): number {
  return Math.max(
    ROW_H,
    titleHeight,
    ...row.map((cell) => cellHeight(doc, cell)),
  );
}

function hline(doc: Doc, y: number, color = HAIR, width = 0.5): void {
  doc
    .lineWidth(width)
    .moveTo(cm(0.3), cm(y))
    .lineTo(cm(0.3 + FULL_W), cm(y))
    .stroke(color);
}

function drawTitleCell(
  doc: Doc,
  title: string,
  y: number,
  height: number,
): void {
  doc
    .rect(cm(0.3), cm(y) + cm(0.12), cm(0.09), cm(height) - cm(0.24))
    .fill(ACCENT);
  doc.fillColor(ACCENT).font('bold').fontSize(TITLE_PT);
  doc.text(title, cm(COL_X[0] + 0.28), cm(y) + cm(0.2), {
    width: cm(COL_W - 0.4),
  });
  doc.fillColor(INK);
}

/** Draws a grid block at `y` and returns the y below it. */
function drawGrid(doc: Doc, block: GridBlock, y: number): number {
  hline(doc, y, FAINT, 0.6);
  let top = y;
  block.rows.forEach((row, index) => {
    const height = rowHeight(doc, row);
    if (index > 0) hline(doc, top);
    if (index === 0) drawTitleCell(doc, block.title, top, height);
    for (const cell of row) drawCell(doc, cell, top, height);
    top += height;
  });
  return top;
}

function drawMessage(doc: Doc, message: string, y: number): number {
  hline(doc, y, FAINT, 0.6);
  doc.fillColor(MUTED).font('bold').fontSize(7.5);
  const height = Math.max(
    0.32,
    doc.heightOfString(message, { width: cm(FULL_W) }) / CM + 0.28,
  );
  doc.text(message, cm(0.3), cm(y) + cm(0.08), {
    width: cm(FULL_W),
    align: 'center',
  });
  return y + height;
}

function drawBlock(doc: Doc, block: Block, y: number): number {
  return block.kind === 'grid'
    ? drawGrid(doc, block, y)
    : drawMessage(doc, block.message, y);
}

function drawTextBlock(
  doc: Doc,
  label: string,
  text: string,
  y: number,
  minHeight: number,
): number {
  const width = cm(FULL_W - 2 * PAD);
  hline(doc, y, FAINT, 0.6);
  doc.fillColor(MUTED).font('bold').fontSize(LABEL_PT);
  doc.text(label, cm(0.3 + PAD), cm(y) + cm(0.1), { width });
  doc
    .font('regular')
    .fontSize(VALUE_PT)
    .fillColor(text === '-' ? FAINT : INK);
  doc.text(text, cm(0.3 + PAD), cm(y) + cm(0.1) + 10, { width, lineGap: 1.5 });
  doc.fillColor(INK);
  const used =
    (doc.heightOfString(text, { width, lineGap: 1.5 }) + 10) / CM + 0.3;
  return y + Math.max(minHeight, used);
}

function measureTextBlock(doc: Doc, text: string): number {
  doc.font('regular').fontSize(VALUE_PT);
  return (
    (doc.heightOfString(text, { width: cm(FULL_W - 2 * PAD) }) + 8) / CM + 0.2
  );
}

function gridHeight(doc: Doc, block: Block): number {
  if (block.kind === 'message') {
    doc.font('bold').fontSize(VALUE_PT);
    return Math.max(
      0.32,
      doc.heightOfString(block.message, { width: cm(FULL_W) }) / CM + 0.28,
    );
  }
  return block.rows.reduce((sum, row) => sum + rowHeight(doc, row), 0);
}

function drawHeader(doc: Doc, view: DanfseView): void {
  doc.rect(cm(0.15), cm(0.15), cm(PAGE_W - 0.3), cm(1.31)).fill(SHADE);
  doc.image(LOGO, cm(0.49), cm(0.44), { width: cm(4.0) });
  doc.fillColor(INK).font('bold').fontSize(10);
  const titleY = view.header.homologation ? 0.32 : 0.6;
  doc.text('DANFSe v2.0', cm(5.41), cm(titleY), {
    width: cm(10.19),
    align: 'center',
  });
  doc.text('Documento Auxiliar da NFS-e', cm(5.41), cm(titleY) + 10.5, {
    width: cm(10.19),
    align: 'center',
  });
  if (view.header.homologation) {
    doc.fillColor('#c62828').font('bold').fontSize(8.5);
    doc.text('NFS-e SEM VALIDADE JURÍDICA', cm(5.41), cm(titleY) + 22, {
      width: cm(10.19),
      align: 'center',
    });
    doc.fillColor(INK);
  }
  doc
    .fillColor(INK)
    .font('bold')
    .fontSize(8)
    .text(view.header.municipality, cm(15.72), cm(0.36), { width: cm(4.9) });
  doc.font('regular').fontSize(6);
  doc.text(view.header.generator, cm(15.72), cm(0.72), { width: cm(4.9) });
  doc.text(view.header.environment, cm(15.72), cm(1.0), { width: cm(4.9) });
}

async function drawIdentification(
  doc: Doc,
  view: DanfseView,
  y: number,
): Promise<number> {
  hline(doc, y, FAINT, 0.6);
  const keyHeight = 0.9;
  const grouped = view.accessKey.value.replace(/(.{4})(?=.)/g, '$1 ');
  drawCell(doc, { ...view.accessKey, value: grouped, span: 3 }, y, keyHeight);
  let top = y + keyHeight;
  for (const row of view.identification) {
    const height = 0.8;
    hline(doc, top);
    for (const cell of row) drawCell(doc, cell, top, height);
    top += height;
  }
  const qr = await QRCode.toBuffer(view.qrUrl, {
    margin: 0,
    width: 400,
    errorCorrectionLevel: 'M',
  });
  doc.image(qr, cm(17.48), cm(y + 0.25), { width: cm(1.7), height: cm(1.7) });
  doc.fillColor(MUTED).font('regular').fontSize(5.8);
  doc.text(QR_CAPTION, cm(15.8), cm(y + 2.08), {
    width: cm(4.72),
    align: 'center',
  });
  return top;
}

function drawWatermark(doc: Doc, text: string): void {
  doc.save();
  doc.rotate(-45, { origin: [cm(PAGE_W / 2), cm(PAGE_H / 2)] });
  doc.fillColor('#a6a6a6').font('bold').fontSize(80);
  const width = doc.widthOfString(text);
  doc.text(text, cm(PAGE_W / 2) - width / 2, cm(PAGE_H / 2) - 40, {
    lineBreak: false,
  });
  doc.restore();
}

export async function renderDanfse(view: DanfseView): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    info: { Title: view.title, Author: 'Corvo', Producer: 'Corvo NFS-e' },
  });
  doc.registerFont('regular', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.rect(0, 0, cm(PAGE_W), cm(PAGE_H)).fill('#ffffff');
  doc
    .lineWidth(1)
    .rect(cm(0.15), cm(0.15), cm(PAGE_W - 0.3), cm(PAGE_H - 0.3))
    .stroke(FAINT);
  drawHeader(doc, view);
  let y = await drawIdentification(doc, view, 1.48);
  y = Math.max(y, 4.34);
  for (const block of view.parties) y = drawBlock(doc, block, y);
  y = drawGrid(doc, view.service.row, y);

  // Whatever height is left after the fixed blocks goes to the free-text areas (NT 2.3).
  const info = view.additionalInfo.length
    ? view.additionalInfo.join('\n')
    : '-';
  const fixedAfter =
    view.taxation.reduce((sum, block) => sum + gridHeight(doc, block), 0) +
    gridHeight(doc, view.totals);
  const codeLine = measureTextBlock(doc, view.service.codeDescription);
  const descNeed = measureTextBlock(doc, view.service.description);
  const infoNeed = measureTextBlock(doc, info);
  const spare = Math.max(
    0,
    BOTTOM - y - fixedAfter - codeLine - descNeed - infoNeed,
  );
  y = drawTextBlock(
    doc,
    'Descrição do Código de Tributação Nacional',
    view.service.codeDescription,
    y,
    codeLine,
  );
  y = drawTextBlock(
    doc,
    'Descrição do Serviço',
    view.service.description,
    y,
    descNeed + Math.min(spare * 0.25, 1.2),
  );
  for (const block of view.taxation) y = drawBlock(doc, block, y);
  y = drawGrid(doc, view.totals, y);
  y = drawTextBlock(
    doc,
    'Informações Complementares',
    info,
    y,
    Math.max(infoNeed, 2.2),
  );

  doc.fillColor(FAINT).font('regular').fontSize(6);
  doc.text(
    'DANFSe gerado por Corvo - documento auxiliar da NFS-e',
    cm(0.3),
    cm(PAGE_H - 0.7),
    {
      width: cm(FULL_W),
      align: 'center',
    },
  );
  if (view.header.watermark) drawWatermark(doc, view.header.watermark);
  doc.end();
  return done;
}
