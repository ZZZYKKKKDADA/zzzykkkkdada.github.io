import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  prepareRepair,
  prepareWithdrawal
} from "../../src/lib/maintenance";
import { makeMaintenanceRepo } from "../helpers/fixtures";
import { auditSite } from "../../src/lib/site-audit";

const run = promisify(execFile);

describe("maintenance candidates", () => {
  it("restores only exact blobs from one unique valid ancestor", async () => {
    const {
      repoRoot,
      baseCommit,
      versionId,
      impactReportHash,
      expectedBlobId,
      expectedPackagePaths
    } = await makeMaintenanceRepo("repairable");
    const result = await prepareRepair({
      repoRoot,
      baseCommit,
      targetVersionIds: [versionId],
      impactReportHash
    });
    expect(result.restoredBlobIds).toEqual([expectedBlobId]);
    expect(result.changedPaths).toEqual(expectedPackagePaths);
    expect((await auditSite(result.candidateRoot)).ok).toBe(true);
    expect((await run("git", ["status", "--porcelain"], { cwd: repoRoot })).stdout).toBe("");
  });

  it("refuses ambiguous repair history", async () => {
    const ambiguousInput = await makeMaintenanceRepo("ambiguous");
    await expect(prepareRepair(ambiguousInput)).rejects.toThrow("NOT_REPAIRABLE");
  });

  it("requires every provider-affected package in an emergency policy candidate", async () => {
    const partialPolicyInput = await makeMaintenanceRepo("partial-policy-withdrawal");
    await expect(prepareWithdrawal(partialPolicyInput)).rejects.toThrow(
      "INCOMPLETE_IMPACT_SET"
    );
  });

  it("builds a complete emergency-withdrawal candidate without mutating the source", async () => {
    const input = await makeMaintenanceRepo("partial-policy-withdrawal");
    const result = await prepareWithdrawal({
      ...input,
      targets: [
        ...input.targets,
        {
          versionId: "20260712-120000-bbbbbbbb",
          publicationCommit: input.baseCommit,
          mode: "emergency" as const,
          publicReason: "来源许可状态变化"
        }
      ]
    });
    expect(result.eventHashes).toHaveLength(2);
    expect(result.changedPaths).toContain("publication-events.jsonl");
    expect((await auditSite(result.candidateRoot)).ok).toBe(true);
    expect((await run("git", ["status", "--porcelain"], { cwd: input.repoRoot })).stdout).toBe(
      ""
    );
  });
});
