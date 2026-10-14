import { readFileSync } from 'fs';
import { join } from 'path';
import {
  IFiscalCatalog,
  type CatalogFile,
} from '@/modules/invoice/domain/fiscal/classification/fiscal-catalog.port';
import { JsonFiscalCatalog } from '@/modules/invoice/domain/fiscal/classification/ctribnac-catalog';

const isCatalogFile = (value: unknown): value is CatalogFile => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { kind?: unknown; entries?: unknown };
  return candidate.kind === 'ctribnac' && Array.isArray(candidate.entries);
};

/**
 * Loads the bundled cTribNac catalog. `__dirname` resolves to
 * `src/modules/invoice/infra/fiscal` under ts-node/ts-jest and to
 * `dist/modules/invoice/infra/fiscal` in production, where nest-cli copies the
 * JSON asset preserving the same relative layout.
 */
export const loadCtribnacCatalogFile = (): CatalogFile => {
  const path = join(__dirname, 'catalog', 'ctribnac.json');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isCatalogFile(parsed)) {
    throw new Error(`Bundled cTribNac catalog at ${path} is not a "ctribnac" catalog file`);
  }
  return parsed;
};

export const ctribnacCatalogProvider = {
  provide: IFiscalCatalog,
  useFactory: (): IFiscalCatalog => new JsonFiscalCatalog(loadCtribnacCatalogFile()),
};
