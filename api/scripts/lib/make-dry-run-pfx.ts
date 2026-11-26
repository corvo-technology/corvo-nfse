/**
 * Writes a self-signed test PFX (CNPJ 12345678000195) for `NFE_SPIKE_DRY_RUN=1`, so the build,
 * XSD and signing steps of nfe-spike-authorize.ts can be exercised without a real certificate.
 * Usage: ts-node -r tsconfig-paths/register scripts/lib/make-dry-run-pfx.ts <output.pfx>
 */
import { writeFileSync } from 'node:fs';
import { makeTestA1 } from '../../test/fixtures/nfe/test-a1';

const out = process.argv[2];
if (!out) throw new Error('Informe o arquivo de saída');
const { pfx } = makeTestA1({
  cnpj: '12345678000195',
  password: 'dry-run-pass',
});
writeFileSync(out, pfx);
