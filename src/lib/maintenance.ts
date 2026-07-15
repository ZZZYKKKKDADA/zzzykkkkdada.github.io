import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  ManifestSchema,
  SummarySchema,
  type Manifest
} from "./contracts";
import { sha256Bytes } from "./crypto";
import { replayAllLineages } from "./lifecycle";
import { loadSiteRepository } from "./repository";
import { auditSite } from "./site-audit";

export interface RepairInput {
  repoRoot: string;
  baseCommit: string;
  targetVersionIds: readonly string[];
  impactReportHash: string;
}

export interface WithdrawalTarget {
  versionId: string;
  publicationCommit: string;
  mode: "editorial" | "emergency";
  publicReason: string;
}

export interface WithdrawalInput {
  repoRoot: string;
  baseCommit: string;
  targets: readonly WithdrawalTarget[];
  candidatePolicyPath?: string;
}

export interface MaintenanceResult {
  operation: "repair" | "withdrawal";
  baseCommit: string;
  targetVersionIds: readonly string[];
  changedPaths: readonly string[];
  restoredBlobIds: readonly string[];
  eventHashes: readonly string[];
  canonicalDiffHash: string;
  candidateRoot: string;
}

interface ValidPackageObject {
  commit: string;
  packagePath: string;
  blobIds: ReadonlyMap<string, string>;
  fingerprint: string;
  manifest: Manifest;
}

const run = promisify(execFile);
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function failure(code: string): Error {
  return new Error(code);
}

async function git(repoRoot: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run("git", [...args], {
    cwd: repoRoot,
    maxBuffer: 16 * 1024 * 1024
  });
  return stdout.trimEnd();
}

async function gitSucceeds(repoRoot: string, args: readonly string[]): Promise<boolean> {
  try {
    await git(repoRoot, args);
    return true;
  } catch {
    return false;
  }
}

async function createCandidateWorktree(repoRoot: string, baseCommit: string): Promise<string> {
  if (!(await gitSucceeds(repoRoot, ["cat-file", "-e", `${baseCommit}^{commit}`]))) {
    throw failure("INVALID_BASE_COMMIT");
  }
  const parent = await mkdtemp(join(tmpdir(), "public-report-maintenance-"));
  const candidateRoot = join(parent, "candidate");
  await git(repoRoot, ["worktree", "add", "--detach", candidateRoot, baseCommit]);
  return candidateRoot;
}

async function discardCandidate(repoRoot: string, candidateRoot: string): Promise<void> {
  await gitSucceeds(repoRoot, ["worktree", "remove", "--force", candidateRoot]);
  await rm(dirname(candidateRoot), { recursive: true, force: true });
}

async function packagePathAtCommit(
  repoRoot: string,
  commit: string,
  versionId: string
): Promise<string | undefined> {
  const listing = await git(repoRoot, ["ls-tree", "-r", "--name-only", commit, "--", "reports"]);
  const matches = listing
    .split("\n")
    .filter((path) => path.endsWith(`/${versionId}/manifest.json`))
    .map((path) => dirname(path));
  if (matches.length > 1) throw failure("NOT_REPAIRABLE");
  return matches[0];
}

async function blobBytes(repoRoot: string, blobId: string): Promise<Buffer> {
  const { stdout } = await run("git", ["cat-file", "blob", blobId], {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024
  });
  return Buffer.from(stdout);
}

async function validPackageObject(
  repoRoot: string,
  commit: string,
  versionId: string
): Promise<ValidPackageObject | undefined> {
  const packagePath = await packagePathAtCommit(repoRoot, commit, versionId);
  if (!packagePath) return undefined;
  const relativePaths = ["manifest.json", "summary.json", "complete_report.md"].map(
    (name) => `${packagePath}/${name}`
  );
  const blobIds = new Map<string, string>();
  try {
    for (const path of relativePaths) {
      blobIds.set(path, await git(repoRoot, ["rev-parse", `${commit}:${path}`]));
    }
    const manifestBytes = await blobBytes(repoRoot, blobIds.get(`${packagePath}/manifest.json`)!);
    const summaryBytes = await blobBytes(repoRoot, blobIds.get(`${packagePath}/summary.json`)!);
    const markdownBytes = await blobBytes(
      repoRoot,
      blobIds.get(`${packagePath}/complete_report.md`)!
    );
    const manifest = ManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
    const summary = SummarySchema.parse(JSON.parse(summaryBytes.toString("utf8")));
    if (
      manifest.version_id !== versionId ||
      summary.version_id !== versionId ||
      manifest.summary_sha256 !== sha256Bytes(summaryBytes) ||
      manifest.complete_report_sha256 !== sha256Bytes(markdownBytes) ||
      manifest.content_hash !== summary.content_hash ||
      manifest.source_tree_hash !== summary.source_tree_hash
    ) {
      return undefined;
    }
    const fingerprint = sha256Bytes(
      Buffer.from(relativePaths.map((path) => `${path}\0${blobIds.get(path)}`).join("\0"))
    );
    return { commit, packagePath, blobIds, fingerprint, manifest };
  } catch {
    return undefined;
  }
}

async function uniqueRepairSource(
  repoRoot: string,
  baseCommit: string,
  versionId: string
): Promise<ValidPackageObject> {
  const commits = (await git(repoRoot, ["rev-list", baseCommit])).split("\n").filter(Boolean);
  const validByFingerprint = new Map<string, ValidPackageObject>();
  for (const commit of commits) {
    const candidate = await validPackageObject(repoRoot, commit, versionId);
    if (candidate && !validByFingerprint.has(candidate.fingerprint)) {
      validByFingerprint.set(candidate.fingerprint, candidate);
    }
  }
  if (validByFingerprint.size !== 1) throw failure("NOT_REPAIRABLE");
  return [...validByFingerprint.values()][0];
}

async function changedPaths(candidateRoot: string): Promise<string[]> {
  const output = await git(candidateRoot, ["diff", "--name-only", "--"]);
  return output.split("\n").filter(Boolean).sort();
}

async function canonicalDiffHash(candidateRoot: string): Promise<string> {
  const diff = await git(candidateRoot, ["diff", "--binary", "--no-ext-diff", "--"]);
  return sha256Bytes(Buffer.from(diff, "utf8"));
}

export async function prepareRepair(input: RepairInput): Promise<MaintenanceResult> {
  if (!HASH_PATTERN.test(input.impactReportHash) || input.targetVersionIds.length === 0) {
    throw failure("INVALID_REPAIR_INPUT");
  }
  if (new Set(input.targetVersionIds).size !== input.targetVersionIds.length) {
    throw failure("DUPLICATE_MAINTENANCE_TARGET");
  }

  const candidateRoot = await createCandidateWorktree(input.repoRoot, input.baseCommit);
  try {
    const restoredBlobIds: string[] = [];
    for (const versionId of input.targetVersionIds) {
      const source = await uniqueRepairSource(input.repoRoot, input.baseCommit, versionId);
      for (const [path, blobId] of source.blobIds) {
        const baseBlob = await gitSucceeds(input.repoRoot, ["cat-file", "-e", `${input.baseCommit}:${path}`])
          ? await git(input.repoRoot, ["rev-parse", `${input.baseCommit}:${path}`])
          : undefined;
        if (baseBlob === blobId) continue;
        await git(candidateRoot, ["restore", `--source=${source.commit}`, "--worktree", "--", path]);
        restoredBlobIds.push(blobId);
      }
    }

    const audit = await auditSite(candidateRoot);
    if (!audit.ok) throw failure("REPAIR_CANDIDATE_INVALID");
    return {
      operation: "repair",
      baseCommit: input.baseCommit,
      targetVersionIds: [...input.targetVersionIds],
      changedPaths: await changedPaths(candidateRoot),
      restoredBlobIds: restoredBlobIds.sort(),
      eventHashes: [],
      canonicalDiffHash: await canonicalDiffHash(candidateRoot),
      candidateRoot
    };
  } catch (error) {
    await discardCandidate(input.repoRoot, candidateRoot);
    throw error;
  }
}

function safePublicReason(reason: string): boolean {
  return (
    reason === reason.trim() &&
    reason.length > 0 &&
    reason.length <= 240 &&
    !/[\u0000-\u001f\u007f]/.test(reason)
  );
}

async function hasPublishedEvent(
  repoRoot: string,
  commit: string,
  manifest: Manifest
): Promise<boolean> {
  try {
    const content = await git(repoRoot, ["show", `${commit}:publication-events.jsonl`]);
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .some(
        (event) =>
          event.type === "published" &&
          event.version_id === manifest.version_id &&
          event.source_tree_hash === manifest.source_tree_hash &&
          event.report_route === manifest.report_route &&
          event.download_route === manifest.download_route
      );
  } catch {
    return false;
  }
}

async function isExactPublicationCommit(
  repoRoot: string,
  baseCommit: string,
  publicationCommit: string,
  currentManifest: Manifest
): Promise<boolean> {
  if (
    !(await gitSucceeds(repoRoot, [
      "merge-base",
      "--is-ancestor",
      publicationCommit,
      baseCommit
    ]))
  ) {
    return false;
  }

  const commitLine = (await git(repoRoot, ["rev-list", "--parents", "-n", "1", publicationCommit]))
    .split(" ")
    .filter(Boolean);
  if (commitLine.length < 1 || commitLine.length > 2) return false;

  const publishedPackage = await validPackageObject(
    repoRoot,
    publicationCommit,
    currentManifest.version_id
  );
  if (
    !publishedPackage ||
    publishedPackage.packagePath !== dirname(currentManifest.download_route.slice(1)) ||
    publishedPackage.manifest.content_hash !== currentManifest.content_hash ||
    publishedPackage.manifest.source_tree_hash !== currentManifest.source_tree_hash ||
    publishedPackage.manifest.summary_sha256 !== currentManifest.summary_sha256 ||
    publishedPackage.manifest.complete_report_sha256 !== currentManifest.complete_report_sha256 ||
    !(await hasPublishedEvent(repoRoot, publicationCommit, currentManifest))
  ) {
    return false;
  }

  const parent = commitLine[1];
  if (!parent) return true;
  return (
    (await packagePathAtCommit(repoRoot, parent, currentManifest.version_id)) === undefined &&
    !(await hasPublishedEvent(repoRoot, parent, currentManifest))
  );
}

function withdrawalEvent(
  target: WithdrawalTarget,
  manifest: Manifest,
  timestamp: string
): Record<string, unknown> {
  const reasonHash = sha256Bytes(Buffer.from(target.publicReason));
  return {
    schema_version: 1,
    event_id: `withdrawn-${target.versionId}-${reasonHash.slice(0, 12)}`,
    type: "withdrawn",
    mode: target.mode,
    timestamp,
    withdrawn_at: timestamp,
    version_id: target.versionId,
    source_tree_hash: manifest.source_tree_hash,
    ticker_slug: manifest.ticker_slug,
    analysis_date: manifest.analysis_date,
    report_route: manifest.report_route,
    download_route: manifest.download_route,
    public_reason: target.publicReason,
    source_classes: manifest.source_classes
  };
}

export async function prepareWithdrawal(input: WithdrawalInput): Promise<MaintenanceResult> {
  if (input.targets.length === 0) throw failure("INVALID_WITHDRAWAL_INPUT");
  if (new Set(input.targets.map((target) => target.versionId)).size !== input.targets.length) {
    throw failure("DUPLICATE_MAINTENANCE_TARGET");
  }
  if (input.targets.some((target) => !safePublicReason(target.publicReason))) {
    throw failure("INVALID_PUBLIC_REASON");
  }

  const candidateRoot = await createCandidateWorktree(input.repoRoot, input.baseCommit);
  try {
    if (input.candidatePolicyPath) {
      await writeFile(
        join(candidateRoot, "config/publication-sources.yaml"),
        await readFile(input.candidatePolicyPath)
      );
    }
    const impact = await auditSite(candidateRoot);
    const affected = new Set(
      impact.findings
        .filter((item) => item.code === "SOURCE_POLICY_BLOCKED" && item.versionId)
        .map((item) => item.versionId!)
    );
    const emergencyTargets = new Set(
      input.targets
        .filter((target) => target.mode === "emergency")
        .map((target) => target.versionId)
    );
    if ([...affected].some((versionId) => !emergencyTargets.has(versionId))) {
      throw failure("INCOMPLETE_IMPACT_SET");
    }

    const repository = await loadSiteRepository(candidateRoot);
    const lineages = replayAllLineages(repository);
    const versionStates = [...lineages.values()].flatMap((lineage) => lineage.versions);
    const timestamp = new Date().toISOString();
    const newEvents: Record<string, unknown>[] = [];
    for (const target of input.targets) {
      const loadedPackage = repository.packages.get(target.versionId);
      const state = versionStates.find((version) => version.versionId === target.versionId);
      if (!loadedPackage || !state || state.status !== "current") {
        throw failure("INVALID_WITHDRAWAL_TARGET");
      }
      if (
        !(await isExactPublicationCommit(
          input.repoRoot,
          input.baseCommit,
          target.publicationCommit,
          loadedPackage.manifest
        ))
      ) {
        throw failure("INVALID_PUBLICATION_COMMIT");
      }
      newEvents.push(withdrawalEvent(target, loadedPackage.manifest, timestamp));
      if (target.mode === "emergency") {
        await rm(loadedPackage.root, { recursive: true });
      }
    }

    const eventsPath = join(candidateRoot, "publication-events.jsonl");
    const originalEvents = await readFile(eventsPath);
    const prefix = originalEvents.length > 0 && originalEvents[originalEvents.length - 1] !== 10 ? "\n" : "";
    const eventBytes = Buffer.from(
      `${prefix}${newEvents.map((event) => JSON.stringify(event)).join("\n")}\n`
    );
    await writeFile(eventsPath, Buffer.concat([originalEvents, eventBytes]));

    const finalAudit = await auditSite(candidateRoot);
    if (!finalAudit.ok) throw failure("WITHDRAWAL_CANDIDATE_INVALID");
    return {
      operation: "withdrawal",
      baseCommit: input.baseCommit,
      targetVersionIds: input.targets.map((target) => target.versionId),
      changedPaths: await changedPaths(candidateRoot),
      restoredBlobIds: [],
      eventHashes: newEvents.map((event) => sha256Bytes(Buffer.from(JSON.stringify(event)))).sort(),
      canonicalDiffHash: await canonicalDiffHash(candidateRoot),
      candidateRoot
    };
  } catch (error) {
    await discardCandidate(input.repoRoot, candidateRoot);
    throw error;
  }
}
