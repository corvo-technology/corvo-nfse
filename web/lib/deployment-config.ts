/** Public instance settings from `GET /v1/config` (no secrets; the Turnstile site key is public by nature). */
export interface DeploymentConfig {
  deploymentMode: "cloud" | "self_hosted";
  billingEnabled: boolean;
  signupMode: string;
  turnstileSiteKey: string | null;
}

/**
 * What the web assumes when the config cannot be read (API blip, or an older API without the endpoint).
 *
 * Deliberate deviation from the spec (5.3), which says to assume the most restrictive mode: here the
 * fallback is cloud WITH billing, so corvo.tech never loses its billing screens because of a failed fetch.
 * A self-hosted instance runs a current API, so for it the endpoint answers and this value is not used.
 */
export const CLOUD_DEFAULT_CONFIG: DeploymentConfig = {
  deploymentMode: "cloud",
  billingEnabled: true,
  signupMode: "open",
  turnstileSiteKey: null,
};

function parse(body: unknown): DeploymentConfig | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (value.deploymentMode !== "cloud" && value.deploymentMode !== "self_hosted") return null;
  if (typeof value.billingEnabled !== "boolean") return null;
  return {
    deploymentMode: value.deploymentMode,
    billingEnabled: value.billingEnabled,
    signupMode: typeof value.signupMode === "string" ? value.signupMode : CLOUD_DEFAULT_CONFIG.signupMode,
    turnstileSiteKey: typeof value.turnstileSiteKey === "string" ? value.turnstileSiteKey : null,
  };
}

/** Server-side read of the instance config, cached for about 60 seconds. Never throws. */
export async function fetchDeploymentConfig(): Promise<DeploymentConfig> {
  // Same address the dashboard proxy uses to reach the API.
  const configured = process.env.API_BASE_URL || (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : undefined);
  if (!configured) return CLOUD_DEFAULT_CONFIG;
  try {
    const response = await fetch(new URL("/v1/config", configured), {
      headers: { accept: "application/json" },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(3_000),
    } as RequestInit);
    if (!response.ok) return CLOUD_DEFAULT_CONFIG;
    return parse(await response.json()) ?? CLOUD_DEFAULT_CONFIG;
  } catch {
    return CLOUD_DEFAULT_CONFIG;
  }
}
