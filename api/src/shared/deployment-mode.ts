import 'dotenv/config';

export const DEPLOYMENT_MODES = ['cloud', 'self_hosted'] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

/** Nest DI token for the mode, for the few providers that need to know it. */
export const DEPLOYMENT_MODE = Symbol('DEPLOYMENT_MODE');

/**
 * The mode as read from the environment. Anything that is not `self_hosted` is `cloud`:
 * an invalid value is rejected at startup by the env schema, never here.
 */
export function deploymentModeFromEnv(
  env: Record<string, unknown> = process.env,
): DeploymentMode {
  return env.DEPLOYMENT_MODE === 'self_hosted' ? 'self_hosted' : 'cloud';
}

/**
 * Read once when the module graph is imported. Nest decorators need the answer before the
 * ConfigService exists, so the choice of which providers and controllers to register is made here.
 */
export const IS_SELF_HOSTED = deploymentModeFromEnv() === 'self_hosted';
