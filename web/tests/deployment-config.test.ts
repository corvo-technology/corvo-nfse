import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOUD_DEFAULT_CONFIG, fetchDeploymentConfig } from "@/lib/deployment-config";

const selfHosted = { deploymentMode: "self_hosted", billingEnabled: false, signupMode: "closed", turnstileSiteKey: null };

describe("fetchDeploymentConfig", () => {
  beforeEach(() => { vi.stubEnv("API_BASE_URL", "http://api.test"); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("reads GET /v1/config from the API, cached for 60 seconds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(selfHosted), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchDeploymentConfig()).resolves.toEqual(selfHosted);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://api.test/v1/config");
    expect(init.next).toEqual({ revalidate: 60 });
  });

  it("falls back to cloud with billing when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(fetchDeploymentConfig()).resolves.toEqual(CLOUD_DEFAULT_CONFIG);
    expect(CLOUD_DEFAULT_CONFIG.billingEnabled).toBe(true);
    expect(CLOUD_DEFAULT_CONFIG.deploymentMode).toBe("cloud");
  });

  it("falls back to cloud with billing on 404 (older API) and other errors", async () => {
    for (const status of [404, 500]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status })));
      await expect(fetchDeploymentConfig()).resolves.toEqual(CLOUD_DEFAULT_CONFIG);
    }
  });

  it("falls back on a malformed body and when the API address is not configured", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ hello: 1 }), { status: 200 })));
    await expect(fetchDeploymentConfig()).resolves.toEqual(CLOUD_DEFAULT_CONFIG);
    vi.stubEnv("API_BASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchDeploymentConfig()).resolves.toEqual(CLOUD_DEFAULT_CONFIG);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
