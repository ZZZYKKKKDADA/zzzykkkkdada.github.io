import { resolve } from "node:path";
import type { Manifest } from "./contracts";
import {
  replayAllLineages,
  type LifecycleStatus,
  type LineageState
} from "./lifecycle";
import { evaluateSourceClasses } from "./policy";
import { loadSiteRepository } from "./repository";

export interface AuditFinding {
  code: string;
  versionId?: string;
  route?: string;
  sourceClass?: string;
  policyEntryId?: string;
  requiredDisposition: "repair" | "emergency_withdrawal";
}

export interface SiteAuditResult {
  ok: boolean;
  auditedAt: string;
  treeRoot: string;
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
  "ORPHAN_REPORT_PACKAGE"
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
      left.sourceClass ?? "",
      left.policyEntryId ?? "",
      left.code
    ]
      .join("\0")
      .localeCompare(
        [
          right.versionId ?? "",
          right.route ?? "",
          right.sourceClass ?? "",
          right.policyEntryId ?? "",
          right.code
        ].join("\0"),
        "en"
      )
  );
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
    const statuses = new Map<string, LifecycleStatus>();
    for (const lineage of lineages.values()) {
      for (const version of lineage.versions) statuses.set(version.versionId, version.status);
    }

    const findings: AuditFinding[] = [
      ...findDuplicateRoutes(repository.packages),
      ...findDuplicateLifecycleRoutes(lineages)
    ];
    for (const [versionId, loadedPackage] of repository.packages) {
      if (statuses.get(versionId) === "emergency_withdrawn") continue;
      findings.push(
        ...evaluateSourceClasses(versionId, loadedPackage.manifest.source_classes, repository.policy)
      );
    }

    for (const event of repository.events) {
      if (event.type !== "withdrawn" || event.mode !== "emergency") continue;
      const tombstoneFindings = evaluateSourceClasses(
        event.version_id,
        event.source_classes,
        repository.policy,
        { allowRestrictedStatus: true }
      );
      findings.push(
        ...tombstoneFindings.map((item) => ({
          ...item,
          code: `TOMBSTONE_${item.code}`,
          route: event.report_route
        }))
      );
    }

    const sorted = stableFindings(findings);
    return { ok: sorted.length === 0, auditedAt, treeRoot, findings: sorted };
  } catch (error) {
    return {
      ok: false,
      auditedAt,
      treeRoot,
      findings: [
        {
          code: safeIntegrityCode(error),
          requiredDisposition: "repair"
        }
      ]
    };
  }
}
