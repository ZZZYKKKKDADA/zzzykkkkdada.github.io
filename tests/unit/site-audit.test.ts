import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditSite } from "../../src/lib/site-audit";
import {
  fixture,
  makeSharedProviderSite,
  validSummary
} from "../helpers/fixtures";

describe("site-wide compliance audit", () => {
  it("blocks every served lineage affected by a provider restriction", async () => {
    const result = await auditSite(fixture("shared-provider/restricted"));
    expect(result.ok).toBe(false);
    expect(result.findings.map((item) => item.versionId).sort()).toEqual([
      "20260712-120000-bbbbbbbb",
      validSummary.version_id
    ]);
    expect(result.findings.every((item) => item.code === "SOURCE_POLICY_BLOCKED")).toBe(true);
  });

  it("passes only after all affected packages are emergency withdrawn", async () => {
    expect((await auditSite(await makeSharedProviderSite("partial-withdrawal"))).ok).toBe(false);
    expect((await auditSite(await makeSharedProviderSite("complete-withdrawal"))).ok).toBe(true);
  });

  it("serves an editorially withdrawn package with its public label", async () => {
    expect((await auditSite(await makeSharedProviderSite("editorial-withdrawal"))).ok).toBe(
      true
    );
  });

  it("rejects one route owned by two event lineages", async () => {
    const root = await makeSharedProviderSite("complete-withdrawal");
    const eventsPath = join(root, "publication-events.jsonl");
    const events = (await readFile(eventsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    for (const event of events.filter((item) => item.source_tree_hash !== events[0].source_tree_hash)) {
      event.version_id = events[0].version_id;
      event.report_route = events[0].report_route;
      event.download_route = events[0].download_route;
      if (event.type === "withdrawn") {
        event.ticker_slug = "002050-sz";
        event.analysis_date = "2026-07-13";
      }
    }
    await writeFile(eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    const result = await auditSite(root);
    expect(result.ok).toBe(false);
    expect(result.findings.some((item) => item.code === "DUPLICATE_ROUTE")).toBe(true);
  });

  it("passes a complete allowed site without exposing report content", async () => {
    const result = await auditSite(await makeSharedProviderSite("allowed"));
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("合成测试报告");
    expect(result.findings).toEqual([]);
  });
});
