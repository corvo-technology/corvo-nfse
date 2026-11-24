/* eslint-disable no-console -- command-line tool */
import 'reflect-metadata';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dump } from 'js-yaml';
import { generatePublicDocument } from './generate-public-document';
import { PUBLIC_API_VERSION, type OpenApiDocument } from './public-document';
import { ADDED_IN_0_3_0 } from './public-operations';

/**
 * Writes the public contract: docs/openapi/openapi.{json,yaml}, a copy for the
 * website (web/public/openapi.json) and the route table of docs/openapi/README.md.
 * Run it through `yarn openapi:generate`: it needs the compiled Swagger plugin.
 */

const TOP_LEVEL = [
  'openapi',
  'info',
  'servers',
  'security',
  'tags',
  'externalDocs',
  'paths',
  'components',
];

/** Sorts object keys so the committed file never changes by accident. */
function sortKeys(value: unknown, top = false): unknown {
  if (Array.isArray(value)) return value.map((item) => sortKeys(item));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    const rank = (key: string) =>
      top && TOP_LEVEL.includes(key) ? TOP_LEVEL.indexOf(key) : 99;
    return Object.fromEntries(
      entries
        .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

const ROUTES_START = '<!-- routes:start -->';
const ROUTES_END = '<!-- routes:end -->';

function routeTable(document: OpenApiDocument): string {
  const rows: { tag: string; line: string }[] = [];
  for (const [path, item] of Object.entries(document.paths))
    for (const [method, operation] of Object.entries(item)) {
      const op = operation as {
        operationId: string;
        tags: string[];
        summary: string;
      };
      const since = ADDED_IN_0_3_0.has(`${method.toUpperCase()} ${path}`)
        ? '0.3.0'
        : '0.2.0';
      rows.push({
        tag: op.tags[0],
        line: `| \`${op.operationId}\` | ${method.toUpperCase()} | \`${path}\` | ${since} | ${op.summary.replace(/\|/g, '/')} |`,
      });
    }
  const tags = (document.tags ?? []).map((tag) => tag.name);
  const lines = [
    '| operationId | Method | Path | Since | Summary |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const tag of tags) {
    const mine = rows.filter((row) => row.tag === tag);
    if (mine.length === 0) continue;
    lines.push(`| **${tag}** | | | | |`);
    lines.push(...mine.map((row) => row.line).sort());
  }
  return lines.join('\n');
}

function withRouteTable(readme: string, document: OpenApiDocument): string {
  const start = readme.indexOf(ROUTES_START);
  const end = readme.indexOf(ROUTES_END);
  if (start === -1 || end === -1)
    throw new Error(
      `docs/openapi/README.md needs ${ROUTES_START} and ${ROUTES_END}`,
    );
  return `${readme.slice(0, start + ROUTES_START.length)}\n\n${routeTable(document)}\n\n${readme.slice(end)}`;
}

async function main() {
  // api/{src,dist}/infra/openapi -> repository root
  const root = join(__dirname, '..', '..', '..', '..');
  const document = await generatePublicDocument(PUBLIC_API_VERSION);
  const sorted = sortKeys(document, true);
  const json = `${JSON.stringify(sorted, null, 2)}\n`;
  const outputs: Record<string, string> = {
    'docs/openapi/openapi.json': json,
    'docs/openapi/openapi.yaml': dump(sorted, { lineWidth: 100, noRefs: true }),
    // Served by the website at https://corvo.tech/openapi.json
    'web/public/openapi.json': json,
  };
  const readme = join(root, 'docs', 'openapi', 'README.md');
  if (existsSync(readme))
    outputs['docs/openapi/README.md'] = withRouteTable(
      readFileSync(readme, 'utf8'),
      document,
    );
  for (const [relative, content] of Object.entries(outputs)) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  console.log(`OpenAPI written: ${Object.keys(outputs).join(', ')}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
