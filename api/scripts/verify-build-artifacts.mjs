/**
 * Verifies that build artifacts are present and valid.
 * Runs after TypeScript compilation and path alias resolution.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIST_DIR = join(import.meta.dirname, '..', 'dist');
const ENTRY_POINTS = ['main.js', 'main.worker.js'];

let hasErrors = false;

for (const entry of ENTRY_POINTS) {
  const path = join(DIST_DIR, entry);
  if (!existsSync(path)) {
    console.error(`ERROR: Missing build artifact: ${entry}`);
    hasErrors = true;
  }
}

// Runtime assets of the SEFAZ layer (read from __dirname): schemas and the ICP-Brasil chain.
const SEFAZ_ASSETS = [
  'infra/external/nfe/sefaz/schemas/PL_010h_v1.03/nfe_v4.00.xsd',
  'infra/external/nfe/sefaz/schemas/PL_010h_v1.03/leiauteNFe_v4.00.xsd',
  'infra/external/nfe/sefaz/schemas/PL_010h_v1.03/procNFe_v4.00.xsd',
  'infra/external/nfe/sefaz/certs/icp-brasil-chain.pem',
];
for (const asset of SEFAZ_ASSETS) {
  if (!existsSync(join(DIST_DIR, asset))) {
    console.error(`ERROR: Missing build asset: ${asset}`);
    hasErrors = true;
  }
}

// The DANFE and the DANFCE (modules/nfce/infra/danfce) read the fonts of the DANFSe; the DANFCE draws its
// QR Code with rectangles, so it has no other asset.
const FONT_ASSETS = [
  'modules/invoice/infra/danfse/assets/LiberationSans-Regular.ttf',
  'modules/invoice/infra/danfse/assets/LiberationSans-Bold.ttf',
];
for (const asset of FONT_ASSETS) {
  if (!existsSync(join(DIST_DIR, asset))) {
    console.error(`ERROR: Missing build asset: ${asset}`);
    hasErrors = true;
  }
}

const distFiles = readdirSync(DIST_DIR);
if (distFiles.length === 0) {
  console.error('ERROR: dist/ directory is empty');
  hasErrors = true;
}

if (hasErrors) {
  process.exit(1);
}

console.log('Build artifacts verified successfully.');
