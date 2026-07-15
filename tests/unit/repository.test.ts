import { createHash } from "node:crypto";
import { appendFile, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSiteRepository } from "../../src/lib/repository";
import {
  copyFixture,
  editorialWithdrawal,
  publishedV1,
  validDownloadPath,
  validManifest,
  validSummary
} from "../helpers/fixtures";

describe("site repository inventory", () => {
  it("loads a schema-v2 site without a policy file", async () => {
    const tree = await copyFixture("valid");
    const repository = await loadSiteRepository(tree);
    expect(repository.packages.size).toBe(1);
    expect(repository.packages.get(validSummary.version_id)?.summary).toEqual(validSummary);
    expect(repository.events).toHaveLength(1);
    expect(repository).not.toHaveProperty("policy");
  });

  it("rejects reintroduced stale policy state", async () => {
    const tree = await copyFixture("valid");
    await mkdir(join(tree, "config"), { recursive: true });
    await writeFile(join(tree, "config/publication-sources.yaml"), "schema_version: 1\n");
    await expect(loadSiteRepository(tree)).rejects.toThrow("OBSOLETE_POLICY_FILE");
  });

  it("binds event findings to versions across blank event-stream lines", async () => {
    const tree = await copyFixture("valid");
    const unsafeWithdrawal = {
      ...editorialWithdrawal,
      public_reason: "token: fixture-secret-value"
    };
    await writeFile(
      join(tree, "publication-events.jsonl"),
      `${JSON.stringify(publishedV1)}\n\n${JSON.stringify(unsafeWithdrawal)}\n`
    );
    const repository = await loadSiteRepository(tree);
    expect(repository.eventContentFindings).toHaveLength(1);
    expect(repository.eventContentFindings[0]).toMatchObject({
      versionId: validSummary.version_id,
      route: validSummary.report_route,
      finding: { ruleId: "credential_assignment", line: 3 }
    });
  });

  it("rejects changed complete_report bytes", async () => {
    const tree = await copyFixture("valid");
    await appendFile(join(tree, validDownloadPath), "tampered");
    await expect(loadSiteRepository(tree)).rejects.toThrow("DOWNLOAD_HASH_MISMATCH");
  });

  it("rejects links anywhere in the candidate tree", async () => {
    const tree = await copyFixture("valid");
    await symlink("publication-events.jsonl", join(tree, "linked-events"));
    await expect(loadSiteRepository(tree)).rejects.toThrow("UNSAFE_REPOSITORY_ENTRY");
  });

  it("rejects unexpected files inside a public report package", async () => {
    const tree = await copyFixture("valid");
    await writeFile(
      join(
        tree,
        "reports/002050-sz/2026-07-13",
        validSummary.version_id,
        "private-source-map.json"
      ),
      "{}\n"
    );
    await expect(loadSiteRepository(tree)).rejects.toThrow("UNEXPECTED_REPORT_PATH");
  });

  it("retains only redacted findings for private markers in self-consistent artifacts", async () => {
    const tree = await copyFixture("valid");
    const packageRoot = join(
      tree,
      "reports/002050-sz/2026-07-13",
      validSummary.version_id
    );
    const summary = { ...validSummary, conclusion: "/Volumes/private/source-map.json" };
    const summaryBytes = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`);
    const manifest = {
      ...validManifest,
      summary_sha256: createHash("sha256").update(summaryBytes).digest("hex")
    };
    await writeFile(join(packageRoot, "summary.json"), summaryBytes);
    await writeFile(join(packageRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const repository = await loadSiteRepository(tree);
    const findings = repository.packages.get(validSummary.version_id)?.publicContentFindings;
    expect(findings).toHaveLength(1);
    expect(findings?.[0]).toMatchObject({ ruleId: "private_path" });
    expect(JSON.stringify(findings)).not.toContain("/Volumes/private/source-map.json");
  });

  it("ignores package-manager links outside the versioned candidate tree", async () => {
    const tree = await copyFixture("valid");
    await mkdir(join(tree, "node_modules/.bin"), { recursive: true });
    await symlink("../../publication-events.jsonl", join(tree, "node_modules/.bin/tool"));
    await expect(loadSiteRepository(tree)).resolves.toMatchObject({ root: tree });
  });
});
