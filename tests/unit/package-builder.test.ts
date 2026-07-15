import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPackage, computeContentHash } from "../../src/lib/package-builder";
import { replayAllLineages } from "../../src/lib/lifecycle";
import { loadSiteRepository } from "../../src/lib/repository";
import { auditSite } from "../../src/lib/site-audit";
import {
  copyFixture,
  correctionInput,
  existingHash,
  existingRoute,
  HASH_C,
  ordinaryInput,
  payload,
  siteRoot,
  treeDigest
} from "../helpers/fixtures";

describe("immutable package builder", () => {
  it("returns the existing lineage before writing when source_tree_hash matches", async () => {
    const beforeDigest = await treeDigest(siteRoot);
    const result = await buildPackage({ ...ordinaryInput, sourceTreeHash: existingHash });
    expect(result).toEqual({ kind: "existing", route: existingRoute, status: "current" });
    expect(await treeDigest(siteRoot)).toBe(beforeDigest);
  });

  it("excludes directory timestamp from public-content identity", () => {
    expect(computeContentHash({ ...payload, sourceDisplayTimestamp: "20260713_215103" })).toBe(
      computeContentHash({ ...payload, sourceDisplayTimestamp: "20260714_090000" })
    );
  });

  it("excludes stale draft identity fields from public-content identity", async () => {
    const firstRoot = await copyFixture("valid");
    const secondRoot = await copyFixture("valid");
    const first = await buildPackage({
      ...ordinaryInput,
      siteRoot: firstRoot,
      sourceTreeHash: HASH_C
    });
    const second = await buildPackage({
      ...ordinaryInput,
      siteRoot: secondRoot,
      sourceTreeHash: HASH_C,
      summaryDraft: {
        ...ordinaryInput.summaryDraft,
        source_tree_hash: "d".repeat(64),
        report_route: "/stocks/stale/2026-01-01/20260101-000000-dddddddd/",
        download_route:
          "/reports/stale/2026-01-01/20260101-000000-dddddddd/complete_report.md"
      }
    });
    expect(first.kind).toBe("created");
    expect(second.kind).toBe("created");
    if (first.kind !== "created" || second.kind !== "created") {
      throw new Error("expected created packages");
    }
    expect(second.contentHash).toBe(first.contentHash);
  });

  it("requires an explicit current-leaf correction target", async () => {
    await expect(
      buildPackage({ ...correctionInput, supersedes: "old-non-leaf" })
    ).rejects.toThrow("INVALID_CORRECTION_TARGET");
  });

  it("creates an audited package with byte-identical Markdown", async () => {
    const root = await copyFixture("valid");
    const result = await buildPackage({
      ...ordinaryInput,
      siteRoot: root,
      sourceTreeHash: HASH_C
    });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("expected created package");
    expect(await readFile(join(result.packageRoot, "complete_report.md"))).toEqual(
      await readFile(ordinaryInput.sourceMarkdownPath)
    );
    expect((await auditSite(root)).ok).toBe(true);
  });

  it("creates a correction and supersedes the prior current leaf", async () => {
    const root = await copyFixture("valid");
    const result = await buildPackage({
      ...correctionInput,
      siteRoot: root,
      summaryDraft: {
        ...correctionInput.summaryDraft,
        conclusion: "修正后的合成公开结论。"
      }
    });
    expect(result.kind).toBe("created");
    const repository = await loadSiteRepository(root);
    const lineage = replayAllLineages(repository).get(existingHash);
    expect(lineage?.versions.find((item) => item.versionId === correctionInput.supersedes)?.status)
      .toBe("superseded");
    expect(lineage?.leaf.versionId).toBe(result.kind === "created" ? result.versionId : "");
  });
});
