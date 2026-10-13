import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e", fullyParallel: false, workers: 1,
  timeout: 45_000, expect: { timeout: 10_000 },
  outputDir: "output/playwright/results",
  use: { baseURL: "http://localhost:4100", headless: true, trace: "retain-on-failure" },
  webServer: {
    command: "yarn start --port 4100", url: "http://localhost:4100/login", reuseExistingServer: false,
    timeout: 60_000, env: { APP_ORIGIN: "http://localhost:4100", SITE_ACCESS_MODE: "open" },
  },
});
