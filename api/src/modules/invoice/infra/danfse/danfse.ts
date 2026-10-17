import { gerarDanfse, parseNfseXml, type NFSe } from 'open-nfse';
import { Logger } from '@nestjs/common';
import { renderDanfse } from './danfse-renderer';
import { buildDanfseView, type DanfseOptions } from './danfse-view';

type LibraryOptions = Parameters<typeof gerarDanfse>[1];

const logger = new Logger('Danfse');

/** Renders the authorized NFS-e as a DANFSe following NT SE/CGNFS-e 008/2026 (Anexo I). */
export async function generateDanfse(
  nfse: NFSe,
  options: DanfseOptions = {},
): Promise<Buffer> {
  return renderDanfse(buildDanfseView(nfse, options));
}

/**
 * The PDF of an authorized NFS-e: our NT 008/2026 layout, falling back to the library's simpler
 * one if rendering fails, so an invoice never ends up without a PDF.
 */
export async function renderInvoicePdf(
  nfse: NFSe,
  libraryOptions: LibraryOptions,
  options: DanfseOptions = {},
): Promise<Buffer> {
  try {
    return await generateDanfse(nfse, options);
  } catch (error) {
    logger.warn(
      `DANFSe NT 008/2026 rendering failed, using the library layout: ${error instanceof Error ? error.message : String(error)}`,
    );
    return gerarDanfse(nfse, libraryOptions);
  }
}

export function renderInvoicePdfFromXml(
  xml: string,
  libraryOptions: LibraryOptions,
  options: DanfseOptions = {},
): Promise<Buffer> {
  return renderInvoicePdf(parseNfseXml(xml), libraryOptions, options);
}

export type { DanfseOptions } from './danfse-view';
