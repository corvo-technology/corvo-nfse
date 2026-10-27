import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  test: { include: ["tests/**/*.test.{ts,tsx}"], environment: "node", restoreMocks: true, server: { deps: { inline: ["next-intl"] } }, execArgv: ["--no-experimental-webstorage"] },
});
