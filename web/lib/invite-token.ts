/**
 * The e-mail link carries the invitation token in the URL fragment (`#token=…`), which the browser never
 * sends to a server. It is kept in sessionStorage (and removed from the address bar) so it survives the
 * sign-in round trip without sitting in the URL, history or a referrer.
 */
const TOKEN_KEY = "corvo_invite_token";
const NUDGED_KEY = "corvo_invite_nudged";

/** Moves a token found in the address bar into sessionStorage; returns the stored one. */
export function takeInviteToken(): string | null {
  try {
    const fromLink = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (fromLink) {
      sessionStorage.setItem(TOKEN_KEY, fromLink);
      sessionStorage.removeItem(NUDGED_KEY);
      window.history.replaceState(null, "", window.location.pathname);
    }
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function forgetInviteToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(NUDGED_KEY);
  } catch {}
}

/**
 * True once per stored token: a person who opened an invitation but landed in the dashboard (a sign-in
 * that did not come back to the invitation page) is sent back to accept it. Once only, so a person who
 * leaves the invitation page on purpose is never trapped in it.
 */
export function shouldResumeInvite(): boolean {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token || sessionStorage.getItem(NUDGED_KEY) === token) return false;
    sessionStorage.setItem(NUDGED_KEY, token);
    return true;
  } catch {
    return false;
  }
}
