import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";


describe("browser fixture build isolation", () => {
  it("keeps synthetic E2E output outside the production dist directory", async () => {
    const astroConfig = await readFile("astro.config.mjs", "utf8");
    const playwrightConfig = await readFile("playwright.config.ts", "utf8");
    expect(astroConfig).toContain("REPORT_SITE_DIST");
    expect(playwrightConfig).toContain("REPORT_SITE_DIST=dist-e2e");
  });
});
