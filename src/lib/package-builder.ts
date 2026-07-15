import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ManifestSchema,
  SummarySchema,
  type Summary
} from "./contracts";
import { sha256Bytes } from "./crypto";
import { replayAllLineages, type LifecycleStatus } from "./lifecycle";
import { loadSiteRepository } from "./repository";
import { auditSite } from "./site-audit";

export interface PackageBuildInput {
  mode: "publication" | "correction";
  siteRoot: string;
  sourceMarkdownPath: string;
  sourceTreeHash: string;
  sourceDisplayTimestamp: string;
  summaryDraft: Omit<
    Summary,
    | "version_id"
    | "content_hash"
    | "publication_date"
    | "source_tree_hash"
    | "report_route"
    | "download_route"
  >;
  supersedes?: string;
  correctionReason?: string;
}

export type PackageBuildResult =
  | { kind: "existing"; route: string; status: LifecycleStatus }
  | { kind: "created"; versionId: string; packageRoot: string; contentHash: string };

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const TIMESTAMP_PATTERN = /^\d{8}_\d{6}$/;
const IDENTITY_EXCLUDED_KEYS = new Set([
  "content_hash",
  "event_id",
  "publication_date",
  "publisher_version",
  "sourceDisplayTimestamp",
  "source_display_timestamp",
  "timestamp",
  "version_id"
]);

function failure(code: string): Error {
  return new Error(code);
}

const PACKAGE_INPUT_KEYS = new Set([
  "mode",
  "siteRoot",
  "sourceMarkdownPath",
  "sourceTreeHash",
  "sourceDisplayTimestamp",
  "summaryDraft",
  "supersedes",
  "correctionReason"
]);

function assertPackageInput(input: PackageBuildInput): void {
  if (Object.keys(input).some((key) => !PACKAGE_INPUT_KEYS.has(key))) {
    throw failure("INVALID_PACKAGE_INPUT");
  }
  if (
    (input.mode !== "publication" && input.mode !== "correction") ||
    (input.mode === "publication" &&
      (input.supersedes !== undefined || input.correctionReason !== undefined))
  ) {
    throw failure("INVALID_PACKAGE_INPUT");
  }
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw failure("NON_CANONICAL_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => !IDENTITY_EXCLUDED_KEYS.has(key) && item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, "en"));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  throw failure("NON_CANONICAL_VALUE");
}

export function computeContentHash(payload: unknown): string {
  return sha256Bytes(Buffer.from(canonicalize(payload), "utf8"));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function allocateVersion(
  siteRoot: string,
  tickerSlug: string,
  analysisDate: string,
  sourceDisplayTimestamp: string,
  contentHash: string
): Promise<{ versionId: string; packageRoot: string }> {
  const timestamp = sourceDisplayTimestamp.replace("_", "-");
  for (let prefixLength = 8; prefixLength <= 64; prefixLength += 4) {
    const versionId = `${timestamp}-${contentHash.slice(0, prefixLength)}`;
    const packageRoot = join(siteRoot, "reports", tickerSlug, analysisDate, versionId);
    if (!(await pathExists(packageRoot))) return { versionId, packageRoot };

    try {
      const existing = ManifestSchema.parse(
        JSON.parse(await readFile(join(packageRoot, "manifest.json"), "utf8"))
      );
      if (existing.content_hash === contentHash) return { versionId, packageRoot };
    } catch {
      throw failure("VERSION_PATH_CONFLICT");
    }
  }
  throw failure("VERSION_PATH_CONFLICT");
}

function publicPayload(input: PackageBuildInput): unknown {
  const {
    version_id: _versionId,
    content_hash: _contentHash,
    publication_date: _publicationDate,
    source_tree_hash: _sourceTreeHash,
    report_route: _reportRoute,
    download_route: _downloadRoute,
    ...summaryDraft
  } = input.summaryDraft as Summary;
  return {
    ...summaryDraft,
    source_tree_hash: input.sourceTreeHash,
    supersedes: input.mode === "correction" ? input.supersedes : null,
    correction_reason: input.mode === "correction" ? input.correctionReason : null
  };
}

function eventId(type: string, versionId: string, contentHash: string): string {
  return `${type}-${versionId}-${contentHash.slice(0, 12)}`;
}

export async function buildPackage(input: PackageBuildInput): Promise<PackageBuildResult> {
  assertPackageInput(input);
  if (!HASH_PATTERN.test(input.sourceTreeHash)) {
    throw failure("INVALID_PACKAGE_HASH");
  }
  if (!TIMESTAMP_PATTERN.test(input.sourceDisplayTimestamp)) {
    throw failure("INVALID_SOURCE_DISPLAY_TIMESTAMP");
  }

  const initialAudit = await auditSite(input.siteRoot);
  if (!initialAudit.ok) throw failure("SITE_AUDIT_FAILED");
  const repository = await loadSiteRepository(input.siteRoot);
  const lineages = replayAllLineages(repository);
  const existingLineage = lineages.get(input.sourceTreeHash);

  if (input.mode === "publication" && existingLineage) {
    return {
      kind: "existing",
      route: existingLineage.leaf.reportRoute,
      status: existingLineage.leaf.status
    };
  }

  let sourceDisplayTimestamp = input.sourceDisplayTimestamp;
  if (input.mode === "correction") {
    if (
      !existingLineage ||
      existingLineage.leaf.status !== "current" ||
      input.supersedes !== existingLineage.leaf.versionId ||
      !input.correctionReason
    ) {
      throw failure("INVALID_CORRECTION_TARGET");
    }
    const targetPackage = repository.packages.get(input.supersedes);
    if (!targetPackage) throw failure("INVALID_CORRECTION_TARGET");
    sourceDisplayTimestamp = targetPackage.manifest.source_display_timestamp;
  }

  const contentHash = computeContentHash(publicPayload(input));
  for (const loadedPackage of repository.packages.values()) {
    if (loadedPackage.manifest.content_hash === contentHash) {
      const status = [...lineages.values()]
        .flatMap((lineage) => lineage.versions)
        .find((version) => version.versionId === loadedPackage.manifest.version_id)?.status;
      if (!status) throw failure("ORPHAN_CONTENT_HASH");
      return { kind: "existing", route: loadedPackage.manifest.report_route, status };
    }
  }

  const tickerSlug = input.summaryDraft.ticker_slug;
  const analysisDate = input.summaryDraft.analysis_date;
  const allocation = await allocateVersion(
    input.siteRoot,
    tickerSlug,
    analysisDate,
    sourceDisplayTimestamp,
    contentHash
  );
  if (await pathExists(allocation.packageRoot)) {
    const existing = ManifestSchema.parse(
      JSON.parse(await readFile(join(allocation.packageRoot, "manifest.json"), "utf8"))
    );
    const status = [...lineages.values()]
      .flatMap((lineage) => lineage.versions)
      .find((version) => version.versionId === existing.version_id)?.status;
    if (!status) throw failure("VERSION_PATH_CONFLICT");
    return { kind: "existing", route: existing.report_route, status };
  }

  const reportRoute = `/stocks/${tickerSlug}/${analysisDate}/${allocation.versionId}/`;
  const downloadRoute = `/reports/${tickerSlug}/${analysisDate}/${allocation.versionId}/complete_report.md`;
  const publicationDate = new Date().toISOString().slice(0, 10);
  const correctionFields =
    input.mode === "correction"
      ? { supersedes: input.supersedes, correction_reason: input.correctionReason }
      : { supersedes: null, correction_reason: null };
  const summary = SummarySchema.parse({
    ...input.summaryDraft,
    ...correctionFields,
    source_tree_hash: input.sourceTreeHash,
    publication_date: publicationDate,
    version_id: allocation.versionId,
    content_hash: contentHash,
    report_route: reportRoute,
    download_route: downloadRoute
  });
  const markdown = await readFile(input.sourceMarkdownPath);
  const summaryBytes = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, "utf8");
  const manifest = ManifestSchema.parse({
    schema_version: 2,
    ticker: summary.ticker,
    ticker_slug: summary.ticker_slug,
    company: summary.company,
    market: summary.market,
    analysis_date: summary.analysis_date,
    publication_date: summary.publication_date,
    source_display_timestamp: sourceDisplayTimestamp,
    version_id: summary.version_id,
    source_tree_hash: summary.source_tree_hash,
    content_hash: summary.content_hash,
    summary_sha256: sha256Bytes(summaryBytes),
    complete_report_sha256: sha256Bytes(markdown),
    publisher_version: "0.1.0",
    ...correctionFields,
    report_route: reportRoute,
    download_route: downloadRoute
  });

  const eventsPath = join(input.siteRoot, "publication-events.jsonl");
  const originalEvents = await readFile(eventsPath);
  const timestamp = new Date().toISOString();
  const newEvents: unknown[] = [
    {
      schema_version: 2,
      event_id: eventId("published", allocation.versionId, contentHash),
      type: "published",
      timestamp,
      version_id: allocation.versionId,
      source_tree_hash: input.sourceTreeHash,
      report_route: reportRoute,
      download_route: downloadRoute
    }
  ];
  if (input.mode === "correction" && input.supersedes && input.correctionReason) {
    newEvents.push({
      schema_version: 2,
      event_id: eventId("superseded", input.supersedes, contentHash),
      type: "superseded",
      timestamp,
      version_id: input.supersedes,
      source_tree_hash: input.sourceTreeHash,
      replacement_version_id: allocation.versionId,
      reason: input.correctionReason
    });
  }

  const parent = dirname(allocation.packageRoot);
  await mkdir(parent, { recursive: true });
  const temporaryRoot = join(parent, `.${allocation.versionId}.tmp-${randomUUID()}`);
  await mkdir(temporaryRoot);
  try {
    await Promise.all([
      writeFile(join(temporaryRoot, "complete_report.md"), markdown),
      writeFile(join(temporaryRoot, "summary.json"), summaryBytes),
      writeFile(join(temporaryRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
    ]);
    await rename(temporaryRoot, allocation.packageRoot);
    const prefix = originalEvents.length > 0 && originalEvents[originalEvents.length - 1] !== 10 ? "\n" : "";
    const appended = `${prefix}${newEvents.map((event) => JSON.stringify(event)).join("\n")}\n`;
    await writeFile(eventsPath, Buffer.concat([originalEvents, Buffer.from(appended)]));

    const finalAudit = await auditSite(input.siteRoot);
    if (!finalAudit.ok) throw failure("CANDIDATE_AUDIT_FAILED");
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    await rm(allocation.packageRoot, { recursive: true, force: true });
    await writeFile(eventsPath, originalEvents);
    throw error;
  }

  return {
    kind: "created",
    versionId: allocation.versionId,
    packageRoot: allocation.packageRoot,
    contentHash
  };
}
