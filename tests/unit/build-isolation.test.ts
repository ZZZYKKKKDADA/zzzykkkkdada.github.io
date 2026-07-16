import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";


describe("browser fixture build isolation", () => {
  it("keeps synthetic E2E output outside the production dist directory", async () => {
    const astroConfig = await readFile("astro.config.mjs", "utf8");
    const playwrightConfig = await readFile("playwright.config.ts", "utf8");
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    expect(astroConfig).toContain("REPORT_SITE_DIST");
    expect(playwrightConfig).toContain("REPORT_SITE_DIST=dist-e2e");
    expect(packageJson.scripts["test:e2e"]).toBe("tsx scripts/run-e2e.ts");
    expect(playwrightConfig).toContain(
      "parseE2EPort(process.env.REPORT_SITE_E2E_PORT)",
    );
    expect(playwrightConfig).toContain("--port ${e2ePort}");
    expect(playwrightConfig).toContain("http://127.0.0.1:${e2ePort}");
  });
});
