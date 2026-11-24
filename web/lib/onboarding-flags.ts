/** Preferences of the first-note banner that live only in this browser. Every access is guarded: storage can be blocked (private window), and the banner must still work. */
export type OnboardingFlag = "noteBannerDismissed";

const key = (tenantId: string, flag: OnboardingFlag) => `corvo:onboarding:${tenantId}:${flag}`;

export function readFlag(tenantId: string, flag: OnboardingFlag): boolean {
  try {
    return window.localStorage.getItem(key(tenantId, flag)) === "1";
  } catch {
    return false;
  }
}

export function writeFlag(tenantId: string, flag: OnboardingFlag): void {
  try {
    window.localStorage.setItem(key(tenantId, flag), "1");
  } catch {
    /* nothing to do: the flag just is not remembered */
  }
}
