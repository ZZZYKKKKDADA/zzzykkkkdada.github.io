import { resolve } from "node:path";
import type { Manifest } from "./contracts";
import { sha256Bytes } from "./crypto";
import { replayAllLineages, type LineageState } from "./lifecycle";
import { renderSafeMarkdown } from "./markdown";
import { PUBLIC_CONTENT_SCANNER_VERSION } from "./public-content-scan";
import { loadSiteRepository } from "./repository";

export interface AuditFinding {
  code: string;
  versionId?: string;
  route?: string;
  file?: string;
  ruleId?: string;
  matchHash?: string;
  requiredDisposition: "repair" | "emergency_withdrawal";
}

export interface SiteAuditResult {
  ok: boolean;
  auditedAt: string;
  treeRoot: string;
  scannerVersion: string;
  resultHash: string;
  findings: readonly AuditFinding[];
}

const SAFE_INTEGRITY_CODES = new Set([
  "DOWNLOAD_HASH_MISMATCH",
  "SUMMARY_HASH_MISMATCH",
  "UNSAFE_REPOSITORY_ENTRY",
  "UNSAFE_REPOSITORY_PATH",
  "UNSAFE_REPOSITORY_ROOT",
  "MISSING_SITE_CONTRACT_FILE",
  "INVALID_SOURCE_POLICY_YAML",
  "INVALID_EVENT_JSON",
  "INVALID_MANIFEST_JSON",
  "INVALID_SUMMARY_JSON",
  "INCOMPLETE_REPORT_PACKAGE",
  "PACKAGE_IDENTITY_MISMATCH",
  "PACKAGE_PATH_MISMATCH",
  "DUPLICATE_VERSION_ID",
  "DUPLICATE_EVENT_ID",
  "DUPLICATE_PUBLICATION",
  "MULTIPLE_CURRENT_LEAVES",
  "EMPTY_LINEAGE",
  "MIXED_SOURCE_LINEAGE",
  "NON_MONOTONIC_EVENT_TIME",
  "EVENT_TARGET_NOT_PUBLISHED",
  "REPLACEMENT_NOT_PUBLISHED",
  "CORRECTION_FORK",
  "ILLEGAL_SUPERSEDE_TRANSITION",
  "DUPLICATE_WITHDRAWAL",
  "WITHDRAWAL_ROUTE_MISMATCH",
  "EMERGENCY_PACKAGE_STILL_PRESENT",
  "SERVED_PACKAGE_MISSING",
  "ORPHAN_REPORT_PACKAGE",
  "UNEXPECTED_REPORT_PATH",
  "UNSAFE_PUBLIC_CONTENT",
  "OBSOLETE_POLICY_FILE",
  "UNSAFE_RENDERED_MARKDOWN"
]);

function safeIntegrityCode(error: unknown): string {
  if (error instanceof Error && SAFE_INTEGRITY_CODES.has(error.message)) return error.message;
  return "SITE_INTEGRITY_INVALID";
}

function stableFindings(findings: AuditFinding[]): AuditFinding[] {
  return findings.sort((left, right) =>
    [
      left.versionId ?? "",
      left.route ?? "",
      left.file ?? "",
      left.ruleId ?? "",
      left.matchHash ?? "",
      left.code
    ]
      .join("\0")
      .localeCompare(
        [
          right.versionId ?? "",
          right.route ?? "",
          right.file ?? "",
          right.ruleId ?? "",
          right.matchHash ?? "",
          right.code
        ].join("\0"),
        "en"
      )
  );
}

function resultHash(findings: readonly AuditFinding[]): string {
  return sha256Bytes(
    Buffer.from(
      JSON.stringify({
        scannerVersion: PUBLIC_CONTENT_SCANNER_VERSION,
        findings
      }),
      "utf8"
    )
  );
}

function auditResult(
  treeRoot: string,
  auditedAt: string,
  findings: AuditFinding[]
): SiteAuditResult {
  const sorted = stableFindings(findings);
  return {
    ok: sorted.length === 0,
    auditedAt,
    treeRoot,
    scannerVersion: PUBLIC_CONTENT_SCANNER_VERSION,
    resultHash: resultHash(sorted),
    findings: sorted
  };
}

function findDuplicateRoutes(
  packages: ReadonlyMap<string, { manifest: Manifest }>
): AuditFinding[] {
  const owners = new Map<string, string>();
  const findings: AuditFinding[] = [];
  for (const [versionId, loadedPackage] of packages) {
    for (const route of [loadedPackage.manifest.report_route, loadedPackage.manifest.download_route]) {
      const existing = owners.get(route);
      if (existing && existing !== versionId) {
        findings.push({
          code: "DUPLICATE_ROUTE",
          versionId,
          route,
          requiredDisposition: "repair"
        });
      } else {
        owners.set(route, versionId);
      }
    }
  }
  return findings;
}

function findDuplicateLifecycleRoutes(
  lineages: ReadonlyMap<string, LineageState>
): AuditFinding[] {
  const owners = new Map<string, string>();
  const findings: AuditFinding[] = [];
  for (const [sourceTreeHash, lineage] of lineages) {
    for (const version of lineage.versions) {
      const owner = `${sourceTreeHash}\0${version.versionId}`;
      for (const route of [version.reportRoute, version.downloadRoute]) {
        const existing = owners.get(route);
        if (existing && existing !== owner) {
          findings.push({
            code: "DUPLICATE_ROUTE",
            versionId: version.versionId,
            route,
            requiredDisposition: "repair"
          });
        } else {
          owners.set(route, owner);
        }
      }
    }
  }
  return findings;
}

export async function auditSite(root: string): Promise<SiteAuditResult> {
  const treeRoot = resolve(root);
  const auditedAt = new Date().toISOString();

  try {
    const repository = await loadSiteRepository(treeRoot);
    const lineages = replayAllLineages(repository);

    const findings: AuditFinding[] = [
      ...findDuplicateRoutes(repository.packages),
      ...findDuplicateLifecycleRoutes(lineages)
    ];
    for (const [versionId, loadedPackage] of repository.packages) {
      for (const item of loadedPackage.publicContentFindings) {
        findings.push({
          code: "UNSAFE_PUBLIC_CONTENT",
          versionId,
          route: loadedPackage.manifest.report_route,
          file: item.file,
          ruleId: item.ruleId,
          matchHash: item.matchHash,
          requiredDisposition: "emergency_withdrawal"
        });
      }
      try {
        const rendered = await renderSafeMarkdown(loadedPackage.markdown);
        if (/<(?:script|iframe|object|embed|form|svg)\b|(?:javascript|data):/iu.test(rendered.html)) {
          findings.push({
            code: "UNSAFE_RENDERED_MARKDOWN",
            versionId,
            route: loadedPackage.manifest.report_route,
            file: `${loadedPackage.manifest.download_route.slice(1)}`,
            requiredDisposition: "emergency_withdrawal"
          });
        }
      } catch {
        findings.push({
          code: "UNSAFE_RENDERED_MARKDOWN",
          versionId,
          route: loadedPackage.manifest.report_route,
          file: `${loadedPackage.manifest.download_route.slice(1)}`,
          requiredDisposition: "emergency_withdrawal"
        });
      }
    }
    for (const item of repository.eventContentFindings) {
      findings.push({
        code: "UNSAFE_PUBLIC_CONTENT",
        versionId: item.versionId,
        route: item.route,
        file: item.finding.file,
        ruleId: item.finding.ruleId,
        matchHash: item.finding.matchHash,
        requiredDisposition: "emergency_withdrawal"
      });
    }
    return auditResult(treeRoot, auditedAt, findings);
  } catch (error) {
    return auditResult(treeRoot, auditedAt, [
      {
        code: safeIntegrityCode(error),
        requiredDisposition: "repair"
      }
    ]);
  }
}
