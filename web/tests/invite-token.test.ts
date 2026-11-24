// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { forgetInviteToken, shouldResumeInvite, takeInviteToken } from "@/lib/invite-token";

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/accept-invite");
});

describe("invitation token across sign-in", () => {
  it("moves the token from the link into sessionStorage and out of the address bar", () => {
    window.history.replaceState(null, "", "/accept-invite#token=abc");
    expect(takeInviteToken()).toBe("abc");
    expect(window.location.hash).toBe("");
    // A later visit without the fragment (back from sign-in) still finds it.
    expect(takeInviteToken()).toBe("abc");
  });

  it("sends a signed-in person who landed in the dashboard back to accept, only once", () => {
    window.history.replaceState(null, "", "/accept-invite#token=abc");
    takeInviteToken();
    expect(shouldResumeInvite()).toBe(true);
    expect(shouldResumeInvite()).toBe(false);
  });

  it("does nothing when there is no pending invitation", () => {
    expect(shouldResumeInvite()).toBe(false);
  });

  it("a new link restarts the nudge and forgetting clears everything", () => {
    window.history.replaceState(null, "", "/accept-invite#token=abc");
    takeInviteToken();
    shouldResumeInvite();
    window.history.replaceState(null, "", "/accept-invite#token=def");
    takeInviteToken();
    expect(shouldResumeInvite()).toBe(true);
    forgetInviteToken();
    expect(takeInviteToken()).toBeNull();
    expect(shouldResumeInvite()).toBe(false);
  });
});
