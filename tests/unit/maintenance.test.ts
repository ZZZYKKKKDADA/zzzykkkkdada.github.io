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

function withdrawalInput(input: any) {
  return {
    repoRoot: input.repoRoot,
    baseCommit: input.baseCommit,
    targets: input.targets,
    safetyImpactReportHash: input.safetyImpactReportHash
  };
}

describe("maintenance candidates", () => {
  it("restores only exact blobs from one unique valid ancestor", async () => {
    const {
      repoRoot,
      baseCommit,
      versionId,
      expectedBlobId,
      expectedPackagePaths
    } = await makeMaintenanceRepo("repairable");
    const result = await prepareRepair({
      repoRoot,
      baseCommit,
      targetVersionIds: [versionId]
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

  it("rejects a partial deterministic safety target set", async () => {
    const input = await makeMaintenanceRepo("partial-safety-withdrawal");
    await expect(prepareWithdrawal(withdrawalInput(input))).rejects.toThrow(
      "INCOMPLETE_SAFETY_TARGET_SET"
    );
  });

  it("rejects obsolete policy mutation input", async () => {
    const input = await makeMaintenanceRepo("partial-safety-withdrawal");
    await expect(
      prepareWithdrawal({ ...input, candidatePolicyPath: "/tmp/policy.yaml" } as never)
    ).rejects.toThrow("INVALID_WITHDRAWAL_INPUT");
  });

  it("rejects an ancestor that did not publish the target version", async () => {
    const input = await makeMaintenanceRepo("partial-safety-withdrawal");
    await expect(
      prepareWithdrawal({
        ...withdrawalInput(input),
        targets: [
          {
            ...input.targets[0],
            publicationCommit: input.prePublicationCommit
          },
          {
            versionId: "20260712-120000-bbbbbbbb",
            publicationCommit: input.baseCommit,
            mode: "emergency" as const,
            publicReason: "公开内容安全复核后撤下"
          }
        ]
      })
    ).rejects.toThrow("INVALID_PUBLICATION_COMMIT");
  });

  it("builds a complete emergency-withdrawal candidate without mutating the source", async () => {
    const input = await makeMaintenanceRepo("partial-safety-withdrawal");
    const result = await prepareWithdrawal({
      ...withdrawalInput(input),
      targets: [
        ...input.targets,
        {
          versionId: "20260712-120000-bbbbbbbb",
          publicationCommit: input.baseCommit,
          mode: "emergency" as const,
          publicReason: "公开内容安全复核后撤下"
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
