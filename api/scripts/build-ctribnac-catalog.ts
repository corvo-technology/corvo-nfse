import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CatalogFile } from '../src/modules/invoice/domain/fiscal/classification/fiscal-catalog.port';

export interface BuildArgs {
  input: string;
  sourceUrl: string;
  publishedAt: string;
  version: string;
  codeColumn: number;
  descriptionColumn: number;
  delimiter: string;
}

function requireValue(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing required argument: ${flag}`);
  return value;
}

function optionalValue(argv: string[], flag: string, fallback: string): string {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value ?? fallback;
}

function optionalInt(argv: string[], flag: string, fallback: number): number {
  const raw = optionalValue(argv, flag, String(fallback));
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed))
    throw new Error(`Invalid integer for ${flag}: ${raw}`);
  return parsed;
}

export function parseArgs(argv: string[]): BuildArgs {
  return {
    input: requireValue(argv, '--input'),
    sourceUrl: requireValue(argv, '--source-url'),
    publishedAt: requireValue(argv, '--published-at'),
    version: requireValue(argv, '--version'),
    codeColumn: optionalInt(argv, '--code-column', 0),
    descriptionColumn: optionalInt(argv, '--description-column', 1),
    delimiter: optionalValue(argv, '--delimiter', ';'),
  };
}

export function buildCatalog(args: BuildArgs): {
  file: CatalogFile;
  ignoredLines: number;
} {
  const raw = readFileSync(args.input, 'utf8');
  const checksum = createHash('sha256').update(raw).digest('hex');
  const lines = raw.split(/\r?\n/);
  const entries: Array<{ code: string; description: string }> = [];
  const seen = new Set<string>();
  let ignoredLines = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const columns = line.split(args.delimiter);
    const code = (columns[args.codeColumn] ?? '').trim();
    const description = (columns[args.descriptionColumn] ?? '').trim();
    if (i === 0 || !/^\d{6}$/.test(code)) {
      ignoredLines += 1;
      continue;
    }
    if (seen.has(code))
      throw new Error(`Duplicate cTribNac code in source: ${code}`);
    seen.add(code);
    entries.push({ code, description });
  }
  if (entries.length === 0)
    throw new Error('No valid cTribNac entries found in input');
  entries.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const file: CatalogFile = {
    kind: 'ctribnac',
    version: args.version,
    sourceUrl: args.sourceUrl,
    publishedAt: args.publishedAt,
    checksum,
    entries,
  };
  return { file, ignoredLines };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = join(
    __dirname,
    '../src/modules/invoice/infra/fiscal/catalog/ctribnac.json',
  );
  const { file, ignoredLines } = buildCatalog(args);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `Wrote ${file.entries.length} cTribNac entries to ${outputPath}\n` +
      `checksum (sha256): ${file.checksum}\n` +
      `ignored lines: ${ignoredLines}\n`,
  );
}

if (require.main === module) {
  main();
}
