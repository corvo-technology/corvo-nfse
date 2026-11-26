import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateXML, type XMLFileInfo } from 'xmllint-wasm';
import type {
  SchemaId,
  SchemaIssue,
  SchemaValidator,
} from '@/modules/fiscal-core/domain/ports/xml.port';

/** Official package the vendored schemas come from; see schemas/README.md. */
export const SCHEMA_PACKAGE = 'PL_010h_v1.03';

const SCHEMAS_DIR = join(__dirname, 'schemas', SCHEMA_PACKAGE);

/** Root XSD of each message. */
export const SCHEMA_FILES: Record<SchemaId, string> = {
  nfe: 'nfe_v4.00.xsd',
  enviNFe: 'enviNFe_v4.00.xsd',
  consStatServ: 'consStatServ_v4.00.xsd',
  consSitNFe: 'consSitNFe_v4.00.xsd',
  envEvento: 'envEvento_v1.00.xsd',
  envCCe: 'envCCe_v1.00.xsd',
  inutNFe: 'inutNFe_v4.00.xsd',
};

const MAX_MESSAGE_LENGTH = 300;

let loaded: Map<string, string> | undefined;

/** The XSDs are read from disk once and reused by every validation. */
function schemaFiles(): Map<string, string> {
  if (!loaded) {
    loaded = new Map(
      readdirSync(SCHEMAS_DIR)
        .filter((name) => name.endsWith('.xsd'))
        .map((name) => [name, readFileSync(join(SCHEMAS_DIR, name), 'utf8')]),
    );
  }
  return loaded;
}

/**
 * xmllint quotes the offending value ("The value '123.456.789-09' is not accepted..."), which can
 * be a CPF, a name or an address. The element and the rule stay; the value goes.
 */
export function redactSchemaMessage(message: string): string {
  return message
    .replace(/(The value )'[^']*'/g, "$1'…'")
    .replace(/: '[^']*' is not a valid value/g, ": '…' is not a valid value")
    .slice(0, MAX_MESSAGE_LENGTH);
}

export class XmllintSchemaValidator implements SchemaValidator {
  async validate(
    xml: string,
    schema: SchemaId,
  ): Promise<{ ok: true } | { ok: false; errors: SchemaIssue[] }> {
    const files = schemaFiles();
    const root = SCHEMA_FILES[schema];
    const rootContents = files.get(root);
    if (rootContents === undefined)
      throw new Error(`Schema file ${root} is missing from ${SCHEMA_PACKAGE}`);
    const preload: XMLFileInfo[] = [...files.entries()]
      .filter(([fileName]) => fileName !== root)
      .map(([fileName, contents]) => ({ fileName, contents }));

    const result = await validateXML({
      xml: { fileName: 'document.xml', contents: xml },
      schema: { fileName: root, contents: rootContents },
      preload,
    });
    if (result.valid) return { ok: true };
    return {
      ok: false,
      errors: result.errors.map((e) => ({
        line: e.loc?.lineNumber ?? null,
        message: redactSchemaMessage(e.message),
      })),
    };
  }
}
