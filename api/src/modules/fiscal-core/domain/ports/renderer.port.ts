import type { DocumentType } from '../document-type';

export interface RenderOptions {
  environment?: 'test' | 'live';
  [option: string]: unknown;
}

export interface DocumentRenderer {
  readonly type: DocumentType;
  render(authorizedXml: string, opts: RenderOptions): Promise<Buffer>;
}
