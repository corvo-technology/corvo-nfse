import 'reflect-metadata';
import { InvoiceModule } from './invoice.module';

/**
 * Nest refuses to boot when a module exports a provider it does not own
 * ("cannot export a provider that is not part of the module"). Nothing else in
 * CI boots AppModule, so this guards the wiring statically.
 */
describe('InvoiceModule wiring', () => {
  it('only exports providers it declares or modules it imports', () => {
    const meta = (key: string): unknown[] =>
      (Reflect.getMetadata(key, InvoiceModule) as unknown[] | undefined) ?? [];
    const providerTokens = new Set<unknown>(
      meta('providers').map((p) =>
        typeof p === 'object' && p !== null && 'provide' in p ? p.provide : p,
      ),
    );
    const importedModules = new Set<unknown>(
      meta('imports').map((i) =>
        typeof i === 'object' && i !== null && 'module' in i ? i.module : i,
      ),
    );

    const orphans = meta('exports')
      .map((e) =>
        typeof e === 'object' && e !== null && 'provide' in e ? e.provide : e,
      )
      .filter((e) => !providerTokens.has(e) && !importedModules.has(e));

    expect(
      orphans.map((o) => String((o as { name?: string }).name ?? String(o))),
    ).toEqual([]);
  });
});
