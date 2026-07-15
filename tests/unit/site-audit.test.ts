import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditSite } from "../../src/lib/site-audit";
import {
  HASH_B,
  HASH_C,
  copyFixture,
  publishedV1,
  publishedV2,
  validManifest,
  validSummary
} from "../helpers/fixtures";

async function makeSafetyMultiSite(): Promise<string> {
  const root = await copyFixture("valid");
  const packageA = join(root, dirname(validManifest.download_route.slice(1)));
  const packageB = join(
    root,
    "reports/002050-sz/2026-07-12/20260712-120000-bbbbbbbb"
  );
  await mkdir(packageB, { recursive: true });
  const markdown = await readFile(join(packageA, "complete_report.md"));
  await writeFile(join(packageB, "complete_report.md"), markdown);

  const summaryA = { ...validSummary, conclusion: "token: fixture-secret-value" };
  const summaryABytes = Buffer.from(`${JSON.stringify(summaryA, null, 2)}\n`);
  const manifestA = {
    ...validManifest,
    summary_sha256: createHash("sha256").update(summaryABytes).digest("hex")
  };
  await writeFile(join(packageA, "summary.json"), summaryABytes);
  await writeFile(join(packageA, "manifest.json"), `${JSON.stringify(manifestA, null, 2)}\n`);

  const summaryB = {
    ...validSummary,
    analysis_date: "2026-07-12",
    version_id: "20260712-120000-bbbbbbbb",
    source_tree_hash: HASH_B,
    content_hash: HASH_C,
    conclusion: "token: fixture-secret-value",
    report_route: "/stocks/002050-sz/2026-07-12/20260712-120000-bbbbbbbb/",
    download_route:
      "/reports/002050-sz/2026-07-12/20260712-120000-bbbbbbbb/complete_report.md"
  };
  const summaryBBytes = Buffer.from(`${JSON.stringify(summaryB, null, 2)}\n`);
  const manifestB = {
    ...validManifest,
    analysis_date: summaryB.analysis_date,
    source_display_timestamp: "20260712_120000",
    version_id: summaryB.version_id,
    source_tree_hash: summaryB.source_tree_hash,
    content_hash: summaryB.content_hash,
    summary_sha256: createHash("sha256").update(summaryBBytes).digest("hex"),
    report_route: summaryB.report_route,
    download_route: summaryB.download_route
  };
  await writeFile(join(packageB, "summary.json"), summaryBBytes);
  await writeFile(join(packageB, "manifest.json"), `${JSON.stringify(manifestB, null, 2)}\n`);

  await writeFile(
    join(root, "publication-events.jsonl"),
    `${[
      publishedV1,
      { ...publishedV2, source_tree_hash: HASH_B }
    ].map((event) => JSON.stringify(event)).join("\n")}\n`
  );
  return root;
}

describe("site-wide safety and integrity audit", () => {
  it("returns the complete deterministic safety target set", async () => {
    const result = await auditSite(await makeSafetyMultiSite());
    expect(result.ok).toBe(false);
    expect(result.scannerVersion).toBe("2.0.0");
    expect(result.findings.map((item) => item.versionId).sort()).toEqual([
      "20260712-120000-bbbbbbbb",
      "20260713-215103-aaaaaaaa"
    ]);
    expect(result.findings.every((item) => item.ruleId === "credential_assignment")).toBe(true);
    expect(result.findings.every((item) => item.file?.endsWith("summary.json"))).toBe(true);
    expect(result.findings.every((item) => /^[a-f0-9]{64}$/.test(item.matchHash ?? ""))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fixture-secret-value");
    expect(JSON.stringify(result)).not.toContain("合成测试报告");
    expect(result.resultHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("passes a complete schema-v2 site without policy state", async () => {
    const result = await auditSite(await copyFixture("valid"));
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.scannerVersion).toBe("2.0.0");
    expect(result.resultHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects schema-v1 lifecycle bytes", async () => {
    const root = await copyFixture("valid");
    await writeFile(
      join(root, "publication-events.jsonl"),
      `${JSON.stringify({ ...publishedV1, schema_version: 1 })}\n`
    );
    const result = await auditSite(root);
    expect(result.ok).toBe(false);
    expect(result.findings[0].code).toBe("SITE_INTEGRITY_INVALID");
  });

  it("rejects one route owned by two event lineages", async () => {
    const root = await makeSafetyMultiSite();
    const eventsPath = join(root, "publication-events.jsonl");
    const events = (await readFile(eventsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    events[1].version_id = events[0].version_id;
    events[1].report_route = events[0].report_route;
    events[1].download_route = events[0].download_route;
    await rm(
      join(root, "reports/002050-sz/2026-07-12/20260712-120000-bbbbbbbb"),
      { recursive: true }
    );
    await writeFile(eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    const result = await auditSite(root);
    expect(result.ok).toBe(false);
    expect(result.findings.some((item) => item.code === "DUPLICATE_ROUTE")).toBe(true);
  });
});

describe("Pages deployment contract", () => {
  it("tests the exact artifact before Pages upload", async () => {
    const workflow = await readFile(".github/workflows/pages.yml", "utf8");
    const ordered = [
      "npm ci",
      "npm run audit",
      "npm run check",
      "npm test",
      "npm run test:stale",
      "npm run build",
      "npm run audit:dist",
      "npx playwright install --with-deps chromium webkit",
      "npm run test:e2e",
      "actions/upload-pages-artifact"
    ];
    const positions = ordered.map((item) => workflow.indexOf(item));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual(
      [...positions].sort((left, right) => left - right)
    );
    expect(workflow).toContain("needs: build");
  });

  it("documents schema-v2 safety boundaries without provider policy ownership", async () => {
    const readme = await readFile("README.md", "utf8");
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    expect(readme).toContain("Schema V2");
    expect(readme).toContain("公开内容安全扫描");
    expect(readme).toContain("明确批准");
    expect(readme).toContain("字节不变");
    expect(readme).not.toContain("config/publication-sources.yaml");
    expect(readme).not.toContain("来源许可");
    expect(packageJson.scripts["audit:dist"]).toBe(
      "tsx scripts/audit-built-artifact.ts"
    );
    expect(packageJson.scripts["test:stale"]).toBe("tsx scripts/check-stale-schema.ts");
  });
});
