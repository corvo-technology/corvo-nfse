import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/proxy/[...path]/route";

const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
const request = (url: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) => new NextRequest(`http://localhost:4000${url}`, init);

function upstream(status: number, headers: Record<string, string | string[]> = {}, body: string | null = null) {
  const response = new Response(body, { status });
  for (const [name, value] of Object.entries(headers)) {
    for (const item of Array.isArray(value) ? value : [value]) response.headers.append(name, item);
  }
  return Promise.resolve(response);
}

beforeEach(() => {
  vi.stubEnv("API_BASE_URL", "http://api.test");
  vi.stubEnv("APP_ORIGIN", "http://localhost:4000");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("social sign-in through the API proxy", () => {
  it("lets the login screen read which providers are configured", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() => upstream(200, { "content-type": "application/json" }, '{"data":{"google":true,"github":false}}'));
    const res = await GET(request("/api/proxy/v1/auth/oauth/providers"), context(["v1", "auth", "oauth", "providers"]));
    expect(res.status).toBe(200);
    expect(String(fetchSpy.mock.calls[0][0])).toBe("http://api.test/v1/auth/oauth/providers");
  });

  it("passes the redirect to the provider and the state cookie back to the browser", async () => {
    vi.spyOn(global, "fetch").mockImplementation(() =>
      upstream(302, {
        location: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=s",
        "set-cookie": ["gf_oauth_state_dev=abc.def; Path=/; HttpOnly; SameSite=Lax", "tracker=1; Path=/"],
      }),
    );
    const res = await GET(request("/api/proxy/v1/auth/oauth/google/authorize?next=%2Fmcp%2Fauthorize"), context(["v1", "auth", "oauth", "google", "authorize"]));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=s");
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain("gf_oauth_state_dev=");
  });

  it("returns the session cookie on the dashboard origin and resumes on a local path", async () => {
    vi.spyOn(global, "fetch").mockImplementation(() =>
      upstream(302, { location: "/mcp/authorize?client_id=x", "set-cookie": ["gf_session_dev=token; Path=/; HttpOnly; SameSite=Lax"] }),
    );
    const res = await GET(request("/api/proxy/v1/auth/oauth/github/callback?code=c&state=s"), context(["v1", "auth", "oauth", "github", "callback"]));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/mcp/authorize?client_id=x");
    expect(res.headers.getSetCookie()[0]).toContain("gf_session_dev=token");
  });

  it("sends only the session and state cookies to the API, plus the provider query", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() => upstream(302, { location: "/app" }));
    await GET(
      request("/api/proxy/v1/auth/oauth/google/callback?code=c&state=s", { headers: { cookie: "gf_oauth_state_dev=abc.def; analytics=1; other=2" } }),
      context(["v1", "auth", "oauth", "google", "callback"]),
    );
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("http://api.test/v1/auth/oauth/google/callback?code=c&state=s");
    expect(new Headers((init as RequestInit).headers).get("cookie")).toBe("gf_oauth_state_dev=abc.def");
  });

  it.each(["https://evil.example/steal", "//evil.example", "https://accounts.google.com.evil.example/x", "http://accounts.google.com/x"])(
    "refuses to follow a redirect to %s",
    async (location) => {
      vi.spyOn(global, "fetch").mockImplementation(() => upstream(302, { location }));
      const res = await GET(request("/api/proxy/v1/auth/oauth/google/callback?code=c&state=s"), context(["v1", "auth", "oauth", "google", "callback"]));
      expect(res.status).toBe(502);
      expect(res.headers.get("location")).toBeNull();
    },
  );

  it("only exposes the social routes for GET and only for the two providers", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const post = await POST(
      request("/api/proxy/v1/auth/oauth/google/callback", { method: "POST", headers: { origin: "http://localhost:4000" } }),
      context(["v1", "auth", "oauth", "google", "callback"]),
    );
    const other = await GET(request("/api/proxy/v1/auth/oauth/facebook/authorize"), context(["v1", "auth", "oauth", "facebook", "authorize"]));
    expect(post.status).toBe(404);
    expect(other.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
