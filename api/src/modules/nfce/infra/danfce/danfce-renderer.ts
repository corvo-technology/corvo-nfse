import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import type {
  DocumentRenderer,
  RenderOptions,
} from '@/modules/fiscal-core/domain/ports/renderer.port';
import { toDanfceView, type DanfceView } from './danfce-view';
import { qrMatrix } from './qr-matrix';

/**
 * The DANFCE (Documento Auxiliar da NFC-e): a thermal-printer-like cupom, 80 mm wide with the height
 * the content needs (one page), or the same cupom in a 80 mm column on an A4 page that breaks when
 * it must. The QR Code is drawn with rectangles (`qrMatrix`), no image.
 *
 * Layout after the Manual de Orientação do Contribuinte (MOC) and the Manual do DANFE NFC-e e QR
 * Code [conferir na homologação: a ordem dos blocos e os textos fixos seguem a memória do manual,
 * que não foi lido para este código]. The fonts are the ones the DANFSe already ships.
 */

export type DanfceLayout = 'a4' | '80mm';

const MM = 72 / 25.4;
/** 80 mm in points. */
export const WIDTH_80MM = 226.77;
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 8;
const A4_MARGIN = 36;
const INK = '#000000';
const MUTED = '#444444';
const BODY = 7.5;
const SMALL = 6.5;
const GAP = 2;
const QR_SIZE = 38 * MM;
/** Height of the measuring page: it never breaks, so a long cupom is measured in one piece. */
const MEASURE_H = 200_000;

const ASSETS = join(__dirname, '../../../invoice/infra/danfse/assets');
const FONT_REGULAR = join(ASSETS, 'LiberationSans-Regular.ttf');
const FONT_BOLD = join(ASSETS, 'LiberationSans-Bold.ttf');

type Doc = InstanceType<typeof PDFDocument>;

export interface DanfceRenderOptions extends RenderOptions {
  homologation?: boolean;
  cancelled?: boolean;
  layout?: DanfceLayout;
}

interface Frame {
  /** Left edge of the cupom column. */
  x: number;
  /** Width of the column inside the margins. */
  width: number;
  /** First and last y of a page; `null` as the bottom: the page grows (no breaks). */
  top: number;
  bottom: number | null;
}

/** A pen that walks down the cupom and starts a page when the next block does not fit. */
class Pen {
  y: number;
  constructor(
    readonly doc: Doc,
    readonly frame: Frame,
  ) {
    this.y = frame.top;
  }

  /** Makes room for `height` points: a new page (A4) when it does not fit. */
  ensure(height: number): void {
    const { bottom, top } = this.frame;
    if (bottom !== null && this.y + height > bottom && this.y > top) {
      this.doc.addPage();
      this.y = top;
    }
  }

  gap(height = GAP): void {
    this.y += height;
  }

  text(
    value: string,
    style: {
      bold?: boolean;
      size?: number;
      align?: 'left' | 'center' | 'right';
      muted?: boolean;
    } = {},
  ): void {
    const { doc, frame } = this;
    doc
      .fillColor(style.muted ? MUTED : INK)
      .font(style.bold ? 'bold' : 'regular')
      .fontSize(style.size ?? BODY);
    const options = { width: frame.width, align: style.align ?? 'left' };
    const height = doc.heightOfString(value, options);
    this.ensure(height);
    doc.text(value, frame.x, this.y, options);
    this.y += height + 1;
  }

  /** Label on the left and value on the right of the same line. */
  pair(
    label: string,
    value: string,
    style: { bold?: boolean; size?: number } = {},
  ): void {
    const { doc, frame } = this;
    doc
      .fillColor(INK)
      .font(style.bold ? 'bold' : 'regular')
      .fontSize(style.size ?? BODY);
    const valueW = doc.widthOfString(value) + 2;
    const labelW = frame.width - valueW;
    const height = Math.max(
      doc.heightOfString(label, { width: labelW }),
      doc.heightOfString(value, { width: valueW }),
    );
    this.ensure(height);
    doc.text(label, frame.x, this.y, { width: labelW });
    doc.text(value, frame.x + labelW, this.y, {
      width: valueW,
      align: 'right',
    });
    this.y += height + 1;
  }

  rule(): void {
    this.ensure(GAP * 3);
    this.y += GAP;
    this.doc
      .lineWidth(0.5)
      .strokeColor(MUTED)
      .dash(1.5, { space: 1.5 })
      .moveTo(this.frame.x, this.y)
      .lineTo(this.frame.x + this.frame.width, this.y)
      .stroke()
      .undash();
    this.y += GAP * 2;
  }

  qr(text: string, size: number): void {
    const matrix = qrMatrix(text);
    this.ensure(size + GAP);
    const unit = size / matrix.length;
    const left = this.frame.x + (this.frame.width - size) / 2;
    this.doc.fillColor('#000000');
    matrix.forEach((line, row) => {
      let col = 0;
      while (col < line.length) {
        if (!line[col]) {
          col += 1;
          continue;
        }
        // A run of dark modules is one rectangle: no hairline seams between neighbours.
        const start = col;
        while (col < line.length && line[col]) col += 1;
        this.doc
          .rect(
            left + start * unit,
            this.y + row * unit,
            (col - start) * unit,
            unit,
          )
          .fill();
      }
    });
    this.doc.fillColor(INK);
    this.y += size + GAP;
  }
}

function paint(pen: Pen, view: DanfceView): void {
  pen.text(view.issuer.name, { bold: true, size: 8.5, align: 'center' });
  pen.text(`CNPJ: ${view.issuer.cnpj}`, { align: 'center' });
  pen.text(view.issuer.address, { align: 'center', size: SMALL });
  pen.rule();
  pen.text(
    'DANFE NFC-e - Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica',
    {
      bold: true,
      align: 'center',
    },
  );
  pen.text('Não permite aproveitamento de crédito de ICMS', {
    align: 'center',
    size: SMALL,
  });
  pen.rule();

  pen.text('Código  Descrição', { bold: true, size: SMALL });
  pen.pair('Qtd  Un  x  Vl Unit', 'Vl Total', { bold: true, size: SMALL });
  for (const item of view.items) {
    pen.text(`${item.code}  ${item.description}`);
    pen.pair(`${item.quantity} ${item.unit} x ${item.unitPrice}`, item.total);
    pen.gap();
  }
  pen.rule();

  pen.pair('Qtde. total de itens', String(view.totals.count));
  if (view.totals.vDesc !== '0,00') {
    pen.pair('Valor dos produtos R$', view.totals.vProd);
    pen.pair('Desconto R$', view.totals.vDesc);
  }
  pen.pair('Valor total R$', view.totals.vNF, { bold: true, size: 9 });
  pen.gap();
  pen.pair('Forma de pagamento', 'Valor pago R$', { bold: true, size: SMALL });
  for (const payment of view.payments) pen.pair(payment.label, payment.amount);
  if (view.totals.vTroco !== '0,00') pen.pair('Troco R$', view.totals.vTroco);
  pen.rule();

  if (view.messages.length > 0) {
    for (const message of view.messages)
      pen.text(message, { bold: true, align: 'center' });
    pen.rule();
  }

  pen.text('Consulte pela Chave de Acesso em', {
    align: 'center',
    size: SMALL,
  });
  pen.text(view.consult.urlChave, { align: 'center', size: SMALL });
  pen.text('CHAVE DE ACESSO', { bold: true, align: 'center', size: SMALL });
  pen.text(view.consult.accessKeyGroups, { align: 'center' });
  pen.rule();

  pen.text(view.consumer, { bold: true, align: 'center' });
  pen.text(
    `NFC-e nº ${view.ident.number} Série ${view.ident.series} ${view.ident.issuedAt}`,
    { align: 'center' },
  );
  pen.text('Via Consumidor', { align: 'center', size: SMALL });
  if (view.ident.protocol) {
    pen.text(`Protocolo de autorização: ${view.ident.protocol}`, {
      align: 'center',
      size: SMALL,
    });
    pen.text(`Data de autorização: ${view.ident.authorizedAt}`, {
      align: 'center',
      size: SMALL,
    });
  }
  pen.gap(4);
  if (view.qrCode) pen.qr(view.qrCode, QR_SIZE);

  if (view.additionalInfo) {
    pen.rule();
    pen.text('Informações de interesse do contribuinte', {
      bold: true,
      size: SMALL,
    });
    pen.text(view.additionalInfo, { size: SMALL });
  }
}

function open(
  size: [number, number],
  view: DanfceView,
  record?: Buffer[],
): { doc: Doc; done: Promise<Buffer> } {
  const doc = new PDFDocument({
    size,
    margin: 0,
    info: {
      Title: `DANFCE NFC-e ${view.ident.number}`,
      Author: 'Corvo',
      Producer: 'Corvo NFC-e',
    },
  });
  doc.registerFont('regular', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);
  const chunks = record ?? [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  return { doc, done };
}

export async function renderDanfce(
  view: DanfceView,
  layout: DanfceLayout,
): Promise<Buffer> {
  if (layout === 'a4') {
    const { doc, done } = open([A4_W, A4_H], view);
    const column = WIDTH_80MM - 2 * MARGIN;
    const pen = new Pen(doc, {
      x: (A4_W - column) / 2,
      width: column,
      top: A4_MARGIN,
      bottom: A4_H - A4_MARGIN,
    });
    paint(pen, view);
    doc.end();
    return done;
  }

  const frame = (): Frame => ({
    x: MARGIN,
    width: WIDTH_80MM - 2 * MARGIN,
    top: MARGIN,
    bottom: null,
  });
  // The height is the content's: lay it out once on a tall page to measure it, then draw it again
  // on a page of exactly that height (same fonts, same widths: the same y).
  const probe = open([WIDTH_80MM, MEASURE_H], view);
  const measure = new Pen(probe.doc, frame());
  paint(measure, view);
  const height = Math.ceil(measure.y + MARGIN);
  probe.doc.end();
  await probe.done;

  const { doc, done } = open([WIDTH_80MM, height], view);
  paint(new Pen(doc, frame()), view);
  doc.end();
  return done;
}

export class DanfceRenderer implements DocumentRenderer {
  readonly type = 'nfce' as const;

  render(authorizedXml: string, opts: DanfceRenderOptions): Promise<Buffer> {
    const view = toDanfceView(authorizedXml, {
      homologation: opts.homologation === true,
      cancelled: opts.cancelled === true,
    });
    return renderDanfce(view, opts.layout === 'a4' ? 'a4' : '80mm');
  }
}
