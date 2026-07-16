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
  it("builds schema v2 without provider metadata", async () => {
    const root = await copyFixture("valid");
    const result = await buildPackage({
      ...ordinaryInput,
      siteRoot: root,
      sourceTreeHash: HASH_C
    });
    if (result.kind !== "created") throw new Error("expected created package");
    const manifest = JSON.parse(
      await readFile(join(result.packageRoot, "manifest.json"), "utf8")
    );
    expect(manifest.schema_version).toBe(2);
    expect(manifest).not.toHaveProperty("source_classes");
    expect(manifest).not.toHaveProperty("provenance_attestation_hash");
  });

  it("rejects removed provider inputs", async () => {
    await expect(
      buildPackage({
        ...ordinaryInput,
        publicProvenance: [],
        provenanceAttestationHash: HASH_C
      } as never)
    ).rejects.toThrow("INVALID_PACKAGE_INPUT");
  });

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

  it("rejects a collapsed new candidate before writing a package", async () => {
    const root = await copyFixture("valid");
    const summaryDraft = structuredClone(ordinaryInput.summaryDraft);
    for (const row of summaryDraft.advice_matrix) {
      for (const cell of row.cells) {
        cell.action = "降低风险暴露，避免追逐连板行情。";
        cell.action_class = "reduce";
        cell.conditions = [];
        cell.risk = "高乖离、高波动与开板后的流动性风险。";
      }
    }
    await expect(
      buildPackage({
        ...ordinaryInput,
        siteRoot: root,
        sourceTreeHash: HASH_C,
        summaryDraft
      })
    ).rejects.toThrow("DEGENERATE_ADVICE_MATRIX");
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
