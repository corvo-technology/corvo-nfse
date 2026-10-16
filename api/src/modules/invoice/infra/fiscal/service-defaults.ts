import { loadCtribnacCatalogFile } from './ctribnac-catalog.provider';

/**
 * LC 116 item 10.09 (CNAE 7490-1/04): "Representação de qualquer natureza, inclusive
 * comercial". A generic code used when neither the request nor the company defines one.
 */
export const DEFAULT_SERVICE_CODE = '100901';

const GENERIC_DESCRIPTION = 'Prestação de serviços';
let descriptions: ReadonlyMap<string, string> | undefined;

/**
 * Text for the DPS when the request has no description: the catalog name of the
 * service code (without the final period), or a generic phrase for unknown codes.
 */
export function defaultServiceDescription(code: string): string {
  descriptions ??= new Map(
    loadCtribnacCatalogFile().entries.map((entry) => [
      entry.code,
      entry.description.replace(/\.\s*$/, ''),
    ]),
  );
  return descriptions.get(code) ?? GENERIC_DESCRIPTION;
}
