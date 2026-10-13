import { readdir, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';

const command = process.argv[2];
if (!['prepare', 'deploy'].includes(command)) {
  throw new Error('Usage: node scripts/sentry-release.mjs prepare|deploy');
}
for (const key of ['SENTRY_RELEASE', 'SENTRY_AUTH_TOKEN']) {
  if (!process.env[key]?.trim()) throw new Error(`${key} is required.`);
}
const { SentryCli } = createRequire(import.meta.url)('@sentry/cli');
const cli = new SentryCli(null, {
  org: process.env.SENTRY_ORG ?? 'banco-do-brasil',
  project: process.env.SENTRY_PROJECT ?? 'corvo-backend',
});
const release = process.env.SENTRY_RELEASE;
if (command === 'prepare') {
  const dist = new URL('../dist/', import.meta.url);
  const maps = (await readdir(dist, { recursive: true })).filter((file) => file.endsWith('.map'));
  if (!maps.length) throw new Error('No source maps found in dist/. Run yarn build first.');
  await cli.releases.new(release, {});
  await cli.sourceMaps.inject({ paths: ['dist'] });
  await cli.releases.uploadSourceMaps(release, { include: ['dist'], validate: true });
  await cli.releases.finalize(release);
  // Remove maps only after every Sentry operation has succeeded.
  for (const map of maps) await unlink(new URL(map, dist));
} else {
  await cli.releases.newDeploy(release, { env: process.env.SENTRY_ENVIRONMENT ?? 'production' });
}
