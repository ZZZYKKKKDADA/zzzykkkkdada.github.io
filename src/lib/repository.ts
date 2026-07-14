import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  ManifestSchema,
  PublicationEventSchema,
  SourcePolicySchema,
  SummarySchema,
  type Manifest,
  type PublicationEvent,
  type SourcePolicy,
  type Summary
} from "./contracts";
import { sha256Bytes } from "./crypto";

export interface LoadedPackage {
  root: string;
  summary: Summary;
  manifest: Manifest;
  markdown: Uint8Array;
}

export interface SiteRepository {
  root: string;
  packages: ReadonlyMap<string, LoadedPackage>;
  events: readonly PublicationEvent[];
  policy: SourcePolicy;
}

function failure(code: string): Error {
  return new Error(code);
}

function ensureInside(root: string, path: string): void {
  const pathFromRoot = relative(root, path);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || resolve(path) === root) {
    throw failure("UNSAFE_REPOSITORY_PATH");
  }
}

const IGNORED_GENERATED_ROOTS = new Set([
  ".astro",
  ".git",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results"
]);

async function inventorySafeFiles(root: string, current = root): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

  for (const entry of entries) {
    if (current === root && IGNORED_GENERATED_ROOTS.has(entry.name)) continue;
    const path = join(current, entry.name);
    ensureInside(root, path);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
      throw failure("UNSAFE_REPOSITORY_ENTRY");
    }
    if (metadata.isDirectory()) result.push(...(await inventorySafeFiles(root, path)));
    else result.push(relative(root, path).split(sep).join("/"));
  }

  return result;
}

function parseJson(bytes: Uint8Array, code: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw failure(code);
  }
}

function assertPackageIdentity(summary: Summary, manifest: Manifest, packagePath: string): void {
  const sharedFields = [
    "ticker",
    "ticker_slug",
    "company",
    "market",
    "analysis_date",
    "publication_date",
    "version_id",
    "source_tree_hash",
    "content_hash",
    "report_route",
    "download_route",
    "supersedes",
    "correction_reason"
  ] as const;

  for (const field of sharedFields) {
    if (summary[field] !== manifest[field]) throw failure("PACKAGE_IDENTITY_MISMATCH");
  }

  if (packagePath !== dirname(manifest.download_route.slice(1))) {
    throw failure("PACKAGE_PATH_MISMATCH");
  }
}

async function loadPackage(root: string, manifestPath: string): Promise<LoadedPackage> {
  const packageRoot = dirname(join(root, manifestPath));
  const summaryPath = join(packageRoot, "summary.json");
  const markdownPath = join(packageRoot, "complete_report.md");
  ensureInside(root, summaryPath);
  ensureInside(root, markdownPath);

  let manifestBytes: Uint8Array;
  let summaryBytes: Uint8Array;
  let markdown: Uint8Array;
  try {
    [manifestBytes, summaryBytes, markdown] = await Promise.all([
      readFile(join(root, manifestPath)),
      readFile(summaryPath),
      readFile(markdownPath)
    ]);
  } catch {
    throw failure("INCOMPLETE_REPORT_PACKAGE");
  }

  const summaryHash = sha256Bytes(summaryBytes);
  const markdownHash = sha256Bytes(markdown);
  const manifest = ManifestSchema.parse(parseJson(manifestBytes, "INVALID_MANIFEST_JSON"));
  const summary = SummarySchema.parse(parseJson(summaryBytes, "INVALID_SUMMARY_JSON"));

  if (manifest.summary_sha256 !== summaryHash) throw failure("SUMMARY_HASH_MISMATCH");
  if (manifest.complete_report_sha256 !== markdownHash) throw failure("DOWNLOAD_HASH_MISMATCH");

  const packagePath = relative(root, packageRoot).split(sep).join("/");
  assertPackageIdentity(summary, manifest, packagePath);
  return { root: packageRoot, summary, manifest, markdown };
}

function parseEvents(bytes: Uint8Array): PublicationEvent[] {
  const content = Buffer.from(bytes).toString("utf8");
  if (content.trim() === "") return [];
  return content.split("\n").flatMap((line) => {
    if (line.trim() === "") return [];
    return [PublicationEventSchema.parse(parseJson(Buffer.from(line), "INVALID_EVENT_JSON"))];
  });
}

export async function loadSiteRepository(root: string): Promise<SiteRepository> {
  const repositoryRoot = resolve(root);
  const rootMetadata = await lstat(repositoryRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw failure("UNSAFE_REPOSITORY_ROOT");
  }

  const files = await inventorySafeFiles(repositoryRoot);
  const manifestPaths = files.filter((path) =>
    /^reports\/[a-z0-9-]+\/\d{4}-\d{2}-\d{2}\/\d{8}-\d{6}-[a-f0-9]{8,64}\/manifest\.json$/.test(
      path
    )
  );

  let policyBytes: Uint8Array;
  let eventBytes: Uint8Array;
  try {
    [policyBytes, eventBytes] = await Promise.all([
      readFile(join(repositoryRoot, "config/publication-sources.yaml")),
      readFile(join(repositoryRoot, "publication-events.jsonl"))
    ]);
  } catch {
    throw failure("MISSING_SITE_CONTRACT_FILE");
  }

  let policyInput: unknown;
  try {
    policyInput = parseYaml(Buffer.from(policyBytes).toString("utf8"));
  } catch {
    throw failure("INVALID_SOURCE_POLICY_YAML");
  }
  const policy = SourcePolicySchema.parse(policyInput);
  const events = parseEvents(eventBytes);

  const packages = new Map<string, LoadedPackage>();
  for (const manifestPath of manifestPaths.sort()) {
    const loadedPackage = await loadPackage(repositoryRoot, manifestPath);
    if (packages.has(loadedPackage.manifest.version_id)) {
      throw failure("DUPLICATE_VERSION_ID");
    }
    packages.set(loadedPackage.manifest.version_id, loadedPackage);
  }

  return { root: repositoryRoot, packages, events, policy };
}
