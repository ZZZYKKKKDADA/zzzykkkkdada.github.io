import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPackage } from "../../src/lib/package-builder";
import { buildSiteViews } from "../../src/lib/views";
import {
  HASH_B,
  makeTwoVersionSite,
  ordinaryInput
} from "../helpers/fixtures";

describe("immutable site view models", () => {
  it("excludes superseded and withdrawn versions from latest", async () => {
    const root = await makeTwoVersionSite("editorial-withdrawal");
    const priorVersion = "20260712-120000-bbbbbbbb";
    const packageRoot = join(root, "reports/002050-sz/2026-07-12", priorVersion);
    const priorSummary = JSON.parse(await readFile(join(packageRoot, "summary.json"), "utf8"));
    const { version_id, content_hash, publication_date, ...summaryDraft } = priorSummary;
    const correction = await buildPackage({
      ...ordinaryInput,
      mode: "correction",
      siteRoot: root,
      sourceMarkdownPath: join(packageRoot, "complete_report.md"),
      sourceTreeHash: HASH_B,
      sourceDisplayTimestamp: "20260712_120000",
      summaryDraft: { ...summaryDraft, conclusion: "修订后的合成结论。" },
      supersedes: version_id,
      correctionReason: "修正公开摘要措辞"
    });
    if (correction.kind !== "created") throw new Error("expected correction package");

    const site = await buildSiteViews(root);
    expect(site.tickers[0].latest?.versionId).toBe(correction.versionId);
    expect(site.reports.map((report) => report.status)).toEqual(
      expect.arrayContaining(["current", "superseded", "editorial_withdrawn"])
    );
  });

  it("keeps emergency tombstone routes without package content", async () => {
    const root = await makeTwoVersionSite("complete-withdrawal");
    const site = await buildSiteViews(root);
    expect(site.tickers).toEqual([]);
    expect(site.reports).toHaveLength(2);
    expect(site.reports.every((report) => report.status === "emergency_withdrawn")).toBe(true);
    expect(site.reports.every((report) => report.markdown === null)).toBe(true);
    expect(site.byRoute.get(site.reports[0].reportRoute)).toBe(site.reports[0]);
  });

  it("renders explicit evidence gaps and public-access boundaries", async () => {
    const metricSource = await readFile("src/components/MetricGroups.astro", "utf8");
    const pageSource = await readFile(
      "src/pages/stocks/[ticker]/[analysisDate]/[versionId]/index.astro",
      "utf8"
    );
    expect(metricSource).toContain("报告未提供足够的此类指标证据");
    expect(pageSource).toContain("summary.disclaimer.public_access");
    expect(pageSource).not.toContain("summary.attributions");
  });
});
