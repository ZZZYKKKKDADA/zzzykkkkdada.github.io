import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

export const HASH_A = "a".repeat(64);
export const HASH_B = "b".repeat(64);
export const HASH_C = "c".repeat(64);
export const validReportRoute = "/stocks/002050-sz/2026-07-13/20260713-215103-aaaaaaaa/";
export const validDownloadRoute = "/reports/002050-sz/2026-07-13/20260713-215103-aaaaaaaa/complete_report.md";
export const validDownloadPath = validDownloadRoute.slice(1);
export const emergencyDownloadRoute = "/reports/002050-sz/2026-07-12/20260712-120000-bbbbbbbb/complete_report.md";

export function fixture(name: string): string {
  return resolve("tests/fixtures/site", name);
}

const validPackage = join(
  fixture("valid"),
  "reports/002050-sz/2026-07-13/20260713-215103-aaaaaaaa"
);
export const validSummary = JSON.parse(
  readFileSync(join(validPackage, "summary.json"), "utf8")
);
export const validManifest = JSON.parse(
  readFileSync(join(validPackage, "manifest.json"), "utf8")
);
export const events = readFileSync(
  join(fixture("lifecycle-mixed"), "publication-events.jsonl"),
  "utf8"
)
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
export const [publishedV1, publishedV2, editorialWithdrawal, emergencyWithdrawal] = events;

export async function copyFixture(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "public-report-fixture-"));
  await cp(fixture(name), root, { recursive: true });
  return root;
}

async function files(root: string, current = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) result.push(...(await files(root, path)));
    else if (entry.isFile()) result.push(relative(root, path));
  }
  return result.sort();
}

export async function treeDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const path of await files(root)) {
    const bytes = await readFile(join(root, path));
    hash.update(path).update("\0").update(bytes).update("\0");
  }
  return hash.digest("hex");
}

export async function makeSharedProviderSite(
  state:
    | "allowed"
    | "restricted"
    | "editorial-withdrawal"
    | "partial-withdrawal"
    | "complete-withdrawal"
): Promise<string> {
  const root = await copyFixture("valid");
  const packageA = join(
    root,
    "reports/002050-sz/2026-07-13/20260713-215103-aaaaaaaa"
  );
  const packageB = join(
    root,
    "reports/002050-sz/2026-07-12/20260712-120000-bbbbbbbb"
  );
  await mkdir(packageB, { recursive: true });
  const markdown = await readFile(join(packageA, "complete_report.md"));
  await writeFile(join(packageB, "complete_report.md"), markdown);

  const summaryB = {
    ...validSummary,
    analysis_date: "2026-07-12",
    version_id: "20260712-120000-bbbbbbbb",
    source_tree_hash: HASH_B,
    content_hash: HASH_C,
    report_route: "/stocks/002050-sz/2026-07-12/20260712-120000-bbbbbbbb/",
    download_route:
      "/reports/002050-sz/2026-07-12/20260712-120000-bbbbbbbb/complete_report.md"
  };
  const summaryBytes = Buffer.from(`${JSON.stringify(summaryB, null, 2)}\n`);
  await writeFile(join(packageB, "summary.json"), summaryBytes);
  const manifestB = {
    ...validManifest,
    analysis_date: summaryB.analysis_date,
    source_display_timestamp: "20260712_120000",
    version_id: summaryB.version_id,
    source_tree_hash: summaryB.source_tree_hash,
    content_hash: summaryB.content_hash,
    summary_sha256: createHash("sha256").update(summaryBytes).digest("hex"),
    complete_report_sha256: createHash("sha256").update(markdown).digest("hex"),
    report_route: summaryB.report_route,
    download_route: summaryB.download_route
  };
  await writeFile(join(packageB, "manifest.json"), `${JSON.stringify(manifestB, null, 2)}\n`);

  const policy = {
    schema_version: 1,
    entries: [
      {
        id: "synthetic-local-v1",
        source_class: "synthetic_local",
        status:
          state === "allowed" || state === "editorial-withdrawal"
            ? "allowed"
            : "restricted",
        allowed_content_classes: ["derived_fact", "locally_authored_analysis"],
        prohibited_content_classes: ["raw_payload"],
        required_attribution: "合成测试数据，不代表真实市场信息。",
        terms_url: "https://example.invalid/synthetic-source",
        reviewed_on: "2026-07-14"
      }
    ]
  };
  const policyYaml = [
    "schema_version: 1",
    "entries:",
    "  - id: synthetic-local-v1",
    "    source_class: synthetic_local",
    `    status: ${policy.entries[0].status}`,
    "    allowed_content_classes:",
    "      - derived_fact",
    "      - locally_authored_analysis",
    "    prohibited_content_classes:",
    "      - raw_payload",
    "    required_attribution: 合成测试数据，不代表真实市场信息。",
    "    terms_url: https://example.invalid/synthetic-source",
    "    reviewed_on: 2026-07-14",
    ""
  ].join("\n");
  await writeFile(join(root, "config/publication-sources.yaml"), policyYaml);

  const publishedA = publishedV1;
  const publishedB = {
    schema_version: 1,
    event_id: "event-published-v2",
    type: "published",
    timestamp: "2026-07-14T09:00:00Z",
    version_id: summaryB.version_id,
    source_tree_hash: summaryB.source_tree_hash,
    report_route: summaryB.report_route,
    download_route: summaryB.download_route
  };
  const eventLines: unknown[] = [publishedA, publishedB];

  if (state === "editorial-withdrawal") {
    eventLines.push(editorialWithdrawal);
  }
  if (state === "partial-withdrawal" || state === "complete-withdrawal") {
    await rm(packageA, { recursive: true });
    eventLines.push(editorialToEmergency(editorialWithdrawal, "event-emergency-v1"));
  }
  if (state === "complete-withdrawal") {
    await rm(packageB, { recursive: true });
    eventLines.push({
      ...editorialToEmergency(emergencyWithdrawal, "event-emergency-v2"),
      source_tree_hash: summaryB.source_tree_hash
    });
  }
  await writeFile(
    join(root, "publication-events.jsonl"),
    `${eventLines.map((event) => JSON.stringify(event)).join("\n")}\n`
  );
  return root;
}

function editorialToEmergency(event: any, eventId: string): any {
  return {
    ...event,
    event_id: eventId,
    mode: "emergency",
    public_reason: "来源许可状态变化"
  };
}

export const siteRoot = fixture("valid");
export const existingHash = validManifest.source_tree_hash;
export const existingRoute = validManifest.report_route;
const { version_id, content_hash, publication_date, ...summaryDraft } = validSummary;
export const ordinaryInput = {
  mode: "publication" as const,
  siteRoot,
  sourceMarkdownPath: join(validPackage, "complete_report.md"),
  sourceTreeHash: existingHash,
  sourceDisplayTimestamp: "20260713_215103",
  summaryDraft,
  publicProvenance: validManifest.source_classes,
  provenanceAttestationHash: HASH_B
};
export const correctionInput = {
  ...ordinaryInput,
  mode: "correction" as const,
  supersedes: validSummary.version_id,
  correctionReason: "修正公开摘要措辞"
};
export const payload = { ...summaryDraft, source_tree_hash: existingHash };

const run = promisify(execFile);
export async function makeMaintenanceRepo(
  scenario: "repairable" | "ambiguous" | "partial-policy-withdrawal"
): Promise<any> {
  const repoRoot = await mkdtemp(join(tmpdir(), "public-report-maintenance-source-"));
  await cp(fixture(`maintenance/${scenario}`), repoRoot, { recursive: true });
  await run("git", ["init", "-b", "main"], { cwd: repoRoot });
  await run("git", ["add", "."], { cwd: repoRoot });
  await run(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "valid base"],
    { cwd: repoRoot }
  );
  const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  const baseCommit = stdout.trim();
  if (scenario === "partial-policy-withdrawal") {
    return {
      repoRoot,
      baseCommit,
      targets: [
        {
          versionId: "policy-v1",
          publicationCommit: baseCommit,
          mode: "emergency" as const,
          publicReason: "来源许可状态变化"
        }
      ],
      candidatePolicyPath: join(
        fixture("maintenance/partial-policy-withdrawal"),
        "restricted-policy.yaml"
      )
    };
  }
  const repairInput = {
    repoRoot,
    baseCommit,
    targetVersionIds: [validSummary.version_id],
    impactReportHash: HASH_A
  };
  if (scenario === "ambiguous") return repairInput;
  const { stdout: blobStdout } = await run(
    "git",
    [
      "rev-parse",
      `HEAD:reports/002050-sz/2026-07-13/${validSummary.version_id}/complete_report.md`
    ],
    { cwd: repoRoot }
  );
  return {
    ...repairInput,
    versionId: validSummary.version_id,
    expectedBlobId: blobStdout.trim(),
    expectedPackagePaths: [
      `reports/002050-sz/2026-07-13/${validSummary.version_id}/complete_report.md`
    ]
  };
}
