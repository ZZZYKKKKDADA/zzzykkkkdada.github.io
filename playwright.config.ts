import { defineConfig, devices } from "@playwright/test";
import { parseE2EPort } from "./scripts/run-e2e";

const e2ePort = parseE2EPort(process.env.REPORT_SITE_E2E_PORT);
const e2eURL = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "tests/e2e",
  webServer: {
    command: `REPORT_SITE_ROOT=tests/fixtures/site/valid REPORT_SITE_DIST=dist-e2e npm run build && REPORT_SITE_DIST=dist-e2e npm run preview -- --host 127.0.0.1 --port ${e2ePort}`,
    url: e2eURL,
    reuseExistingServer: false
  },
  use: { baseURL: e2eURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } }
  ]
});
