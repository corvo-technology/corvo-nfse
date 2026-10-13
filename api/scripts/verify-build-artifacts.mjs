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

const distFiles = readdirSync(DIST_DIR);
if (distFiles.length === 0) {
  console.error('ERROR: dist/ directory is empty');
  hasErrors = true;
}

if (hasErrors) {
  process.exit(1);
}

console.log('Build artifacts verified successfully.');
