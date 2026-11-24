import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // Lets tests import the API's PricingService without installing the API's dependencies.
      "@nestjs/common": fileURLToPath(new URL("./tests/helpers/nestjs-common-stub.ts", import.meta.url)),
    },
  },
  esbuild: { jsx: "automatic" },
  test: { setupFiles: ["./tests/helpers/clear-session.ts"], include: ["tests/**/*.test.{ts,tsx}"], environment: "node", restoreMocks: true, server: { deps: { inline: ["next-intl"] } }, execArgv: ["--no-experimental-webstorage"] },
});
