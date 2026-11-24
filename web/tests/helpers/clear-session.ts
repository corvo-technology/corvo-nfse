import { afterEach } from "vitest";

// The new-invoice form keeps a draft in sessionStorage; one test's draft must not reach the next.
afterEach(() => {
  if (typeof sessionStorage !== "undefined") sessionStorage.clear();
});
