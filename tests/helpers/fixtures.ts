import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { auditSite } from "../../src/lib/site-audit";

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

export async function makeTwoVersionSite(
  state: "current" | "safety" | "editorial-withdrawal" | "complete-withdrawal"
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

  let summaryA = validSummary;
  if (state === "safety") {
    summaryA = { ...validSummary, conclusion: "token: fixture-secret-value" };
    const summaryABytes = Buffer.from(`${JSON.stringify(summaryA, null, 2)}\n`);
    await writeFile(join(packageA, "summary.json"), summaryABytes);
    await writeFile(
      join(packageA, "manifest.json"),
      `${JSON.stringify({
        ...validManifest,
        summary_sha256: createHash("sha256").update(summaryABytes).digest("hex")
      }, null, 2)}\n`
    );
  }

  const summaryB = {
    ...validSummary,
    analysis_date: "2026-07-12",
    version_id: "20260712-120000-bbbbbbbb",
    source_tree_hash: HASH_B,
    content_hash: HASH_C,
    conclusion:
      state === "safety" ? "token: fixture-secret-value" : validSummary.conclusion,
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

  const publishedA = publishedV1;
  const publishedB = {
    schema_version: 2,
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
  if (state === "complete-withdrawal") {
    await rm(packageA, { recursive: true });
    await rm(packageB, { recursive: true });
    eventLines.push({
      ...editorialWithdrawal,
      event_id: "event-emergency-v1",
      mode: "emergency",
      public_reason: "公开内容安全复核后撤下"
    });
    eventLines.push({
      ...emergencyWithdrawal,
      event_id: "event-emergency-v2",
      source_tree_hash: summaryB.source_tree_hash,
      public_reason: "公开内容安全复核后撤下"
    });
  }
  await writeFile(
    join(root, "publication-events.jsonl"),
    `${eventLines.map((event) => JSON.stringify(event)).join("\n")}\n`
  );
  return root;
}

export const siteRoot = fixture("valid");
export const existingHash = validManifest.source_tree_hash;
export const existingRoute = validManifest.report_route;
const { version_id, content_hash, publication_date, ...summaryDraft } = validSummary;

function productionSummaryDraft(): typeof summaryDraft {
  const draft = structuredClone(summaryDraft);
  const actionClasses = [
    ["conditional_enter", "avoid", "conditional_enter", "avoid"],
    ["conditional_add", "hold", "conditional_add", "hold"],
    ["hold", "reduce", "conditional_add", "reduce"],
    ["reduce", "reduce", "hold", "reduce"]
  ];
  draft.advice_matrix.forEach((row: any, rowIndex: number) => {
    row.cells.forEach((cell: any, cellIndex: number) => {
      cell.action = `合成操作建议-${row.position}-${cell.style}`;
      cell.action_class = actionClasses[rowIndex][cellIndex];
      cell.conditions = [`合成触发条件-${row.position}-${cell.style}`];
      cell.risk = `合成风险-${row.position}-${cell.style}`;
    });
  });
  const metricTemplate = structuredClone(draft.metric_groups[0].metrics[0]);
  draft.metric_groups.forEach((group: any, index: number) => {
    group.status = "supported";
    group.metrics = [
      {
        ...metricTemplate,
        name: `合成${group.label}指标`,
        source_value: `fixture-${index + 1}.00`,
        unit: "fixture-unit",
        interpretation: `仅验证${group.label}结构。`,
        decision_impact: `验证${group.label}决策映射。`
      }
    ];
  });
  return draft;
}

export const ordinaryInput = {
  mode: "publication" as const,
  siteRoot,
  sourceMarkdownPath: join(validPackage, "complete_report.md"),
  sourceTreeHash: existingHash,
  sourceDisplayTimestamp: "20260713_215103",
  summaryDraft: productionSummaryDraft()
};
export const correctionInput = {
  ...ordinaryInput,
  mode: "correction" as const,
  supersedes: validSummary.version_id,
  correctionReason: "修正公开摘要措辞"
};
export const payload = { ...ordinaryInput.summaryDraft, source_tree_hash: existingHash };

const run = promisify(execFile);
async function commitAll(repoRoot: string, message: string): Promise<string> {
  await run("git", ["add", "."], { cwd: repoRoot });
  await run(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", message],
    { cwd: repoRoot }
  );
  const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  return stdout.trim();
}

export async function makeMaintenanceRepo(
  scenario: "repairable" | "ambiguous" | "partial-safety-withdrawal"
): Promise<any> {
  const repoRoot = await mkdtemp(join(tmpdir(), "public-report-maintenance-source-"));
  await run("git", ["init", "-b", "main"], { cwd: repoRoot });

  if (scenario === "partial-safety-withdrawal") {
    await writeFile(join(repoRoot, "README.md"), "synthetic empty site baseline\n");
    const prePublicationCommit = await commitAll(repoRoot, "empty site baseline");
    const safetySite = await makeTwoVersionSite("safety");
    await cp(safetySite, repoRoot, { recursive: true });
    const baseCommit = await commitAll(repoRoot, "unsafe public site");
    const safetyImpactReportHash = (await auditSite(repoRoot)).resultHash;
    return {
      repoRoot,
      baseCommit,
      prePublicationCommit,
      safetyImpactReportHash,
      targets: [
        {
          versionId: validSummary.version_id,
          publicationCommit: baseCommit,
          mode: "emergency" as const,
          publicReason: "公开内容安全复核后撤下"
        }
      ]
    };
  }

  await cp(fixture("valid"), repoRoot, { recursive: true });
  const validCommit = await commitAll(repoRoot, "valid publication");
  const packagePath = `reports/002050-sz/2026-07-13/${validSummary.version_id}`;
  const markdownPath = join(repoRoot, packagePath, "complete_report.md");
  const manifestPath = join(repoRoot, packagePath, "manifest.json");
  const { stdout: blobStdout } = await run(
    "git",
    ["rev-parse", `${validCommit}:${packagePath}/complete_report.md`],
    { cwd: repoRoot }
  );

  if (scenario === "ambiguous") {
    await appendFile(markdownPath, "\n第二个自洽历史版本。\n");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.complete_report_sha256 = createHash("sha256")
      .update(await readFile(markdownPath))
      .digest("hex");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await commitAll(repoRoot, "conflicting valid publication bytes");
  }

  await writeFile(markdownPath, "damaged\n");
  const baseCommit = await commitAll(repoRoot, "damage publication bytes");
  const repairInput = {
    repoRoot,
    baseCommit,
    targetVersionIds: [validSummary.version_id]
  };
  if (scenario === "ambiguous") return repairInput;
  return {
    ...repairInput,
    versionId: validSummary.version_id,
    expectedBlobId: blobStdout.trim(),
    expectedPackagePaths: [`${packagePath}/complete_report.md`]
  };
}
