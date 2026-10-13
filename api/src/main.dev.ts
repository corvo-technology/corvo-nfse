import pino from 'pino';
import { bootstrap } from './main';
import { bootstrapWorker } from './main.worker';

/**
 * Starts every local runtime behind a single TypeScript watcher.
 * Production keeps using one process per entrypoint.
 */
export async function bootstrapDevelopment(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DEVELOPMENT_BOOTSTRAP_NOT_ALLOWED_IN_PRODUCTION');
  }

  await Promise.all([bootstrap(), bootstrapWorker()]);
}

if (require.main === module) {
  void bootstrapDevelopment().catch((error) => {
    pino().error({ event: 'development_bootstrap_failed', err: error });
    process.exit(1);
  });
}
