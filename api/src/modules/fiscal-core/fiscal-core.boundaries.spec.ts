import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const src = resolve(__dirname, '../..');

function sources(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sources(path) : [path];
    });
  } catch {
    return [];
  }
}

function production(directory: string): string[] {
  return sources(resolve(src, directory)).filter(
    (p) => p.endsWith('.ts') && !p.endsWith('.spec.ts'),
  );
}

function imports(path: string): string[] {
  const file = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      found.push(node.moduleSpecifier.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function violations(files: string[], forbidden: RegExp): string[] {
  return files.flatMap((path) =>
    imports(path)
      .filter((dependency) => forbidden.test(dependency))
      .map((dependency) => `${path} -> ${dependency}`),
  );
}

describe('fiscal architecture boundaries', () => {
  it('fiscal-core does not import invoice, nfe or nfce', () => {
    const files = production('modules/fiscal-core');
    expect(files.length).toBeGreaterThan(0);
    expect(
      violations(
        files,
        /^(@\/modules\/(invoice|nfe|nfce)(\/|$)|(\.\.\/)+(invoice|nfe|nfce)(\/|$))/,
      ),
    ).toEqual([]);
  });

  it('nfe and nfce domains do not import infra', () => {
    expect(
      violations(production('modules/nfe/domain'), /^@\/infra(\/|$)/),
    ).toEqual([]);
    expect(
      violations(production('modules/nfce/domain'), /^@\/infra(\/|$)/),
    ).toEqual([]);
  });

  it('the SEFAZ adapter does not import Nest', () => {
    expect(
      violations(production('infra/external/nfe/sefaz'), /^@nestjs\//),
    ).toEqual([]);
  });
});
