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

// The platform admin is a read model: its services read through dedicated read
// repositories (PlatformReadSession, READ ONLY) and write only the audit row
// and the tenant lookup of the credit grant. These exact dependencies are the
// whole exemption; any other persistence import in those files still fails.
const platformAdminExemptions: Record<string, string[]> = {
  'platform-admin/application/platform-user-detail.service.ts': [
    '../infra/platform-admin-audit.repository',
    '../infra/read/platform-user-detail.read-repository',
  ],
  'platform-admin/application/platform-credit-grant.service.ts': [
    '@/modules/auth/infra/typeorm-tenant.repository',
    '../infra/platform-admin-audit.repository',
  ],
  'platform-admin/application/platform-nfe-access.service.ts': [
    '../infra/platform-nfe-access.repository',
    '../infra/platform-admin-audit.repository',
  ],
};

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
            !platformAdminExemptions[
              relative(modules, path).replaceAll('\\', '/')
            ]?.includes(dependency) &&
            (/^(typeorm|@nestjs\/typeorm)(\/|$)/.test(dependency) ||
              /(?:\.orm-entit(?:y|ies)|\.mapper)$/.test(dependency) ||
              /(?:^|\/)infra\/.*repository/.test(dependency) ||
              /typeorm-(?:repository\.helper|transaction-context|unit-of-work)$/.test(
                dependency,
              ))
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
