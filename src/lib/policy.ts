import type { Manifest, SourcePolicy } from "./contracts";

export interface PolicyFinding {
  code: string;
  versionId: string;
  sourceClass: string;
  policyEntryId: string;
  requiredDisposition: "emergency_withdrawal";
}

function finding(
  code: string,
  versionId: string,
  sourceClass: string,
  policyEntryId: string
): PolicyFinding {
  return {
    code,
    versionId,
    sourceClass,
    policyEntryId,
    requiredDisposition: "emergency_withdrawal"
  };
}

function stableFindings(findings: PolicyFinding[]): PolicyFinding[] {
  return findings.sort((left, right) =>
    [left.versionId, left.sourceClass, left.policyEntryId, left.code]
      .join("\0")
      .localeCompare(
        [right.versionId, right.sourceClass, right.policyEntryId, right.code].join("\0"),
        "en"
      )
  );
}

export function evaluateSourceClasses(
  versionId: string,
  sourceClasses: Manifest["source_classes"],
  policy: SourcePolicy,
  options: { allowRestrictedStatus?: boolean } = {}
): PolicyFinding[] {
  const findings: PolicyFinding[] = [];

  for (const source of sourceClasses) {
    const entry = policy.entries.find((candidate) => candidate.id === source.policy_entry_id);
    if (!entry || entry.source_class !== source.source_class) {
      findings.push(
        finding(
          "INVALID_ATTRIBUTION_ID",
          versionId,
          source.source_class,
          source.policy_entry_id
        )
      );
      continue;
    }

    if (!options.allowRestrictedStatus && entry.status !== "allowed") {
      findings.push(
        finding("SOURCE_POLICY_BLOCKED", versionId, source.source_class, source.policy_entry_id)
      );
      continue;
    }

    const allowed = new Set(entry.allowed_content_classes);
    const prohibited = new Set(entry.prohibited_content_classes);
    if (
      source.content_classes.some(
        (contentClass) => !allowed.has(contentClass) || prohibited.has(contentClass)
      )
    ) {
      findings.push(
        finding("SOURCE_POLICY_BLOCKED", versionId, source.source_class, source.policy_entry_id)
      );
      continue;
    }

    if (
      source.attribution_text !== entry.required_attribution ||
      source.terms_url !== entry.terms_url
    ) {
      findings.push(
        finding("ATTRIBUTION_MISMATCH", versionId, source.source_class, source.policy_entry_id)
      );
    }
  }

  return stableFindings(findings);
}
