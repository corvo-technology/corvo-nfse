import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const modules = resolve(__dirname, '../../modules');
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : [path];
  });
}

// Health probes and composition roots are infrastructure; tenant context and
// worker discovery remain supported orchestration utilities in this refactor.
const businessSources = sources(modules).filter((path) => {
  const name = relative(modules, path).replaceAll('\\', '/');
  return (
    name.endsWith('.ts') &&
    !name.endsWith('.spec.ts') &&
    !name.endsWith('.module.ts') &&
    !name.startsWith('health/') &&
    (/(^|\/)(application|domain|jobs)\//.test(name) ||
      /^mcp\/[^/]+\.(service|controller)\.ts$/.test(name))
  );
});

describe('business persistence boundaries', () => {
  it.each(businessSources)(
    '%s uses repository contracts rather than persistence implementations',
    (path) => {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const violations: string[] = [];
      const inspect = (node: ts.Node) => {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          const dependency = node.moduleSpecifier.text;
          if (
            /^(typeorm|@nestjs\/typeorm)(\/|$)/.test(dependency) ||
            /(?:\.orm-entit(?:y|ies)|\.mapper)$/.test(dependency) ||
            /(?:^|\/)infra\/.*repository/.test(dependency) ||
            /typeorm-(?:repository\.helper|transaction-context|unit-of-work)$/.test(
              dependency,
            )
          )
            violations.push(dependency);
        }
        ts.forEachChild(node, inspect);
      };
      inspect(source);
      expect(violations).toEqual([]);
    },
  );
});
