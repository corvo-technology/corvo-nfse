/* eslint-disable @typescript-eslint/no-require-imports */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PLATFORM_ADMIN_ONLY } from '@/modules/auth/platform-admin-only.decorator';
import { REQUIRED_TENANT_PERMISSION } from '@/modules/auth/require-permission.decorator';
import { PlatformAdminGuard } from './platform-admin.guard';

const SRC = join(__dirname, '..', '..');
const ADMIN = __dirname;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Source without comments, so prose cannot trigger or hide a match. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const isSpec = (f: string) => /\.spec\.ts$/.test(f);
const adminSources = walk(ADMIN).filter((f) => f.endsWith('.ts') && !isSpec(f));
const readSources = adminSources.filter((f) =>
  f.includes(`${join('infra', 'read')}`),
);
const rel = (f: string) => relative(SRC, f);

describe('platform-admin invariants (source scan)', () => {
  it('tem arquivos de leitura para varrer', () => {
    expect(readSources.length).toBeGreaterThanOrEqual(4);
  });

  it('nada em infra/read tem INSERT/UPDATE/DELETE/TRUNCATE/ALTER/DROP/CREATE', () => {
    const offenders = readSources.filter((f) =>
      /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i.test(code(f)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('nada em infra/read seleciona key_hash, encrypted_, checkout nem usa SELECT *', () => {
    const forbidden =
      /key_hash|encrypted_|\bcheckout\b|SELECT\s+\*|SELECT\s+\w+\.\*|\w\.\*\s*(,|FROM)/i;
    const offenders = readSources.filter((f) => forbidden.test(code(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('as classes de leitura só expõem list/find/snapshot', () => {
    // Public methods of the classes under infra/read (private helpers are fine).
    const method =
      /^ {2}(?!private\b|protected\b|constructor\b)(?:public\s+)?(?:async\s+)?(\w+)\s*\(/gm;
    const classes = readSources.filter((f) => /ReadRepository/.test(code(f)));
    expect(classes.length).toBe(4);
    for (const file of classes) {
      const text = code(file).split('\nexport class ')[1] ?? '';
      const names = [...text.matchAll(method)].map((m) => m[1]);
      expect(names.length).toBeGreaterThan(0);
      for (const name of names)
        expect(['list', 'find', 'snapshot']).toContain(name);
    }
  });

  it('só o módulo de concessão usa runAsPlatformAdminOnTenant ou o CreditsService', () => {
    const grantFiles = new Set([
      'platform-credit-grant.module.ts',
      'platform-credit-grant.service.ts',
    ]);
    const offenders = adminSources.filter(
      (f) =>
        /runAsPlatformAdminOnTenant|CreditsService|CreditsModule/.test(
          code(f),
        ) && !grantFiles.has(f.split('/').pop() as string),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('fora do admin, runAsPlatformAdminOnTenant só existe na definição e na concessão', () => {
    const users = walk(SRC)
      .filter((f) => f.endsWith('.ts') && !isSpec(f))
      .filter((f) => /runAsPlatformAdminOnTenant/.test(code(f)))
      .map(rel)
      .sort();
    expect(users).toEqual([
      'infra/persistence/typeorm/tenant-context.storage.ts',
      'modules/platform-admin/application/platform-credit-grant.service.ts',
    ]);
  });

  it('toda tabela citada em SQL cru passa pelo helper que qualifica o schema', () => {
    // After FROM/JOIN/INTO a table must come from a helper call (`${this.t(..)}`,
    // `${t(..)}`, `${s}name`), a subquery or a CTE name; a bare name would
    // resolve through search_path, which the runtime role does not have.
    const ref = /\b(FROM|JOIN|INTO)\s+(?!LATERAL\b|\$\{|\()([\w".]+)/gi;
    const ctes = /\b(\w+)\s+AS\s*\(/gi;
    const offenders: string[] = [];
    for (const file of adminSources) {
      const text = code(file);
      const cteNames = new Set<string>();
      for (const m of text.matchAll(ctes)) cteNames.add(m[1]);
      for (const m of text.matchAll(ref)) {
        // Prose inside strings ("... from the session") is not SQL.
        if (!/^[a-z_"]+$/i.test(m[2]) || cteNames.has(m[2])) continue;
        if (
          !/^[A-Z]+$/.test(m[1]) // lowercase 'from' / 'into' is prose or code
        )
          continue;
        offenders.push(`${rel(file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('nenhum arquivo do admin (nem spec de integração) mexe em search_path', () => {
    const offenders = walk(ADMIN)
      .filter((f) => f.endsWith('.ts') && f !== __filename)
      .filter((f) => /search_path/i.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('route table invariant', () => {
  const controllerFiles = walk(SRC).filter(
    (f) => f.endsWith('.controller.ts') && !isSpec(f),
  );

  type Ctor = new (...args: never[]) => unknown;
  const controllers = (): Ctor[] =>
    controllerFiles.flatMap((file) =>
      Object.values(require(file) as Record<string, unknown>).filter(
        (v): v is Ctor =>
          typeof v === 'function' &&
          Reflect.getMetadata('path', v) !== undefined,
      ),
    );

  const pathsOf = (cls: Ctor): string[] =>
    ([] as string[]).concat(Reflect.getMetadata('path', cls) as string[]);
  const isPlatform = (cls: Ctor) =>
    pathsOf(cls).some((p) => /^\/?platform(\/|$)/.test(p));

  it('todo controller sob "platform" é admin-only com PlatformAdminGuard e sem permissão de tenant', () => {
    const platform = controllers().filter(isPlatform);
    expect(platform.map((c) => c.name).sort()).toEqual([
      'PlatformAttentionController',
      'PlatformAuditController',
      'PlatformCreditGrantController',
      'PlatformOverviewController',
      'PlatformUserDetailController',
      'PlatformUsersController',
    ]);
    for (const cls of platform) {
      expect(Reflect.getMetadata(PLATFORM_ADMIN_ONLY, cls)).toBe(true);
      expect(Reflect.getMetadata('__guards__', cls)).toContain(
        PlatformAdminGuard,
      );
      expect(
        Reflect.getMetadata(REQUIRED_TENANT_PERMISSION, cls),
      ).toBeUndefined();
      for (const name of Object.getOwnPropertyNames(cls.prototype)) {
        const handler = (cls.prototype as Record<string, unknown>)[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        expect(
          Reflect.getMetadata(REQUIRED_TENANT_PERMISSION, handler),
        ).toBeUndefined();
      }
    }
  });

  it('nenhum controller fora do admin declara PLATFORM_ADMIN_ONLY sem estar sob "platform"', () => {
    const stray = controllers().filter(
      (c) =>
        !isPlatform(c) && Reflect.getMetadata(PLATFORM_ADMIN_ONLY, c) === true,
    );
    expect(stray.map((c) => c.name)).toEqual([]);
  });
});
