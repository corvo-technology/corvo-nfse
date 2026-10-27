/**
 * Types for the test-only @nestjs/common stand-in that vitest.config.mts aliases, so `tsc` can
 * check web tests that import the API's PricingService without the API's dependencies installed.
 */
declare module "@nestjs/common" {
  export const Injectable: () => (target: unknown, context?: unknown) => void;
}
