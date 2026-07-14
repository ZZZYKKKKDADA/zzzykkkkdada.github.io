import { appendFile, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSiteRepository } from "../../src/lib/repository";
import {
  copyFixture,
  validDownloadPath,
  validSummary
} from "../helpers/fixtures";

describe("site repository inventory", () => {
  it("loads a valid package, policy, and event stream", async () => {
    const repository = await loadSiteRepository(await copyFixture("valid"));
    expect(repository.packages.size).toBe(1);
    expect(repository.packages.get(validSummary.version_id)?.summary).toEqual(validSummary);
    expect(repository.events).toHaveLength(1);
    expect(repository.policy.entries).toHaveLength(1);
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

  it("ignores package-manager links outside the versioned candidate tree", async () => {
    const tree = await copyFixture("valid");
    await mkdir(join(tree, "node_modules/.bin"), { recursive: true });
    await symlink("../../publication-events.jsonl", join(tree, "node_modules/.bin/tool"));
    await expect(loadSiteRepository(tree)).resolves.toMatchObject({ root: tree });
  });
});
