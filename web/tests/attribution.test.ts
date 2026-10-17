// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureAttributionCandidate,
  clearAttribution,
  promoteAttributionOnConsent,
  readFbp,
  readStoredAttribution,
} from "@/lib/attribution";

function setUrl(href: string) {
  Object.defineProperty(window, "location", {
    value: new URL(href),
    writable: true,
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie.split(";").forEach((entry) => {
    const name = entry.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
  });
});

afterEach(() => {
  setUrl("http://localhost/");
});

describe("captureAttributionCandidate", () => {
  it("captures utm_* and fbclid from the URL into sessionStorage on first load", () => {
    setUrl("http://localhost/pt?utm_source=meta&utm_campaign=launch&fbclid=abc123");
    captureAttributionCandidate();
    const pending = JSON.parse(sessionStorage.getItem("corvo_attribution_pending") ?? "null");
    expect(pending.utm).toEqual({ source: "meta", campaign: "launch" });
    expect(pending.fbclid).toBe("abc123");
    expect(pending.landingUrl).toBe("http://localhost/pt?utm_source=meta&utm_campaign=launch&fbclid=abc123");
  });

  it("does not overwrite an already-captured first touch within the session", () => {
    setUrl("http://localhost/pt?utm_source=meta&fbclid=first");
    captureAttributionCandidate();
    setUrl("http://localhost/en?utm_source=google&fbclid=second");
    captureAttributionCandidate();
    const pending = JSON.parse(sessionStorage.getItem("corvo_attribution_pending") ?? "null");
    expect(pending.fbclid).toBe("first");
  });

  it("captures nothing when there is no utm_* or fbclid", () => {
    setUrl("http://localhost/pt");
    captureAttributionCandidate();
    expect(sessionStorage.getItem("corvo_attribution_pending")).toBeNull();
  });
});

describe("promoteAttributionOnConsent", () => {
  it("promotes the pending capture to localStorage and builds fbc from fbclid when no _fbc cookie exists", () => {
    setUrl("http://localhost/pt?utm_source=meta&fbclid=xyz789");
    captureAttributionCandidate();
    promoteAttributionOnConsent();
    const stored = readStoredAttribution();
    expect(stored?.utm).toEqual({ source: "meta" });
    expect(stored?.fbc).toMatch(/^fb\.1\.\d+\.xyz789$/);
  });

  it("prefers an existing _fbc cookie over synthesizing one from fbclid", () => {
    document.cookie = "_fbc=fb.1.999.existing; path=/";
    setUrl("http://localhost/pt?fbclid=xyz789");
    captureAttributionCandidate();
    promoteAttributionOnConsent();
    const stored = readStoredAttribution();
    expect(stored?.fbc).toBe("fb.1.999.existing");
  });

  it("is a no-op when a first-touch attribution is already stored", () => {
    localStorage.setItem(
      "corvo_attribution",
      JSON.stringify({ utm: { source: "first-touch" }, capturedAt: Date.now() }),
    );
    setUrl("http://localhost/pt?utm_source=second-touch");
    captureAttributionCandidate();
    promoteAttributionOnConsent();
    expect(readStoredAttribution()?.utm.source).toBe("first-touch");
  });
});

describe("readFbp", () => {
  it("reads the _fbp cookie", () => {
    document.cookie = "_fbp=fb.1.123.456; path=/";
    expect(readFbp()).toBe("fb.1.123.456");
  });

  it("returns undefined when absent", () => {
    expect(readFbp()).toBeUndefined();
  });
});

describe("clearAttribution", () => {
  it("removes both the pending session capture and the stored attribution", () => {
    sessionStorage.setItem("corvo_attribution_pending", JSON.stringify({ utm: {} }));
    localStorage.setItem("corvo_attribution", JSON.stringify({ utm: {}, capturedAt: Date.now() }));
    clearAttribution();
    expect(sessionStorage.getItem("corvo_attribution_pending")).toBeNull();
    expect(localStorage.getItem("corvo_attribution")).toBeNull();
  });
});
