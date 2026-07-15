import { describe, expect, it } from "vitest";
import {
  ManifestSchema,
  PublicationEventSchema,
  SummarySchema
} from "../../src/lib/contracts";
import {
  emergencyWithdrawal,
  publishedV1,
  validManifest,
  validSummary
} from "../helpers/fixtures";

const fixedMetricGroups = [
  "trend",
  "momentum",
  "valuation",
  "fundamental_quality",
  "capital_risk"
] as const;

function schemaV2Summary() {
  const summary = structuredClone(validSummary);
  summary.schema_version = 2;
  summary.supersedes = null;
  summary.correction_reason = null;
  summary.disclaimer.public_access = "本页公开且可下载，noindex 不是访问控制。";
  delete summary.attributions;
  summary.advice_matrix[0].cells[2] = {
    style: "long_aggressive",
    action: "报告证据不足，暂不形成建议",
    action_class: "insufficient_evidence",
    conditions: [],
    risk: "报告证据存在缺口"
  };
  const supported = {
    ...summary.metric_groups[0],
    status: "supported",
    metrics: [
      {
        ...summary.metric_groups[0].metrics[0],
        source_value: "fixture-1.00",
        unit: "fixture-unit"
      }
    ]
  };
  summary.metric_groups = [
    supported,
    ...fixedMetricGroups.slice(1).map((group) => ({
      group,
      label: {
        trend: "趋势",
        momentum: "动量",
        valuation: "估值",
        fundamental_quality: "基本面质量",
        capital_risk: "资金与风险"
      }[group],
      status: "insufficient_evidence",
      metrics: []
    }))
  ];
  return summary;
}

function schemaV2Manifest() {
  const manifest = structuredClone(validManifest);
  manifest.schema_version = 2;
  manifest.supersedes = null;
  manifest.correction_reason = null;
  delete manifest.provenance_attestation_hash;
  delete manifest.source_classes;
  return manifest;
}

function schemaV2Event(event: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = structuredClone(event);
  result.schema_version = 2;
  delete result.source_classes;
  if (result.type === "withdrawn") result.publication_commit = "1".repeat(40);
  return result;
}

describe("public contracts", () => {
  it("accepts the complete synthetic package contracts", () => {
    expect(SummarySchema.parse(validSummary)).toEqual(validSummary);
    expect(ManifestSchema.parse(validManifest)).toEqual(validManifest);
    expect(PublicationEventSchema.parse(publishedV1)).toEqual(publishedV1);
    expect(PublicationEventSchema.parse(emergencyWithdrawal)).toEqual(emergencyWithdrawal);
  });

  it("rejects a matrix that is not exactly 4x4", () => {
    const result = SummarySchema.safeParse({ ...validSummary, advice_matrix: [] });
    expect(result.success).toBe(false);
  });

  it("requires emergency route and publication identity", () => {
    const result = PublicationEventSchema.safeParse({
      type: "withdrawn",
      mode: "emergency",
      version_id: "v1",
      public_reason: "许可状态变化"
    });
    expect(result.success).toBe(false);
  });

  it("rejects a published event whose route does not match its identity", () => {
    const result = PublicationEventSchema.safeParse({
      ...publishedV1,
      report_route: "/stocks/other/2026-07-13/20260713-215103-aaaaaaaa/"
    });
    expect(result.success).toBe(false);
  });

  it("rejects removed source policy classes", () => {
    const result = ManifestSchema.safeParse({ ...validManifest, source_classes: [] });
    expect(result.success).toBe(false);
  });

  it("requires lowercase full SHA-256 values", () => {
    const result = ManifestSchema.safeParse({
      ...validManifest,
      source_tree_hash: "A".repeat(64)
    });
    expect(result.success).toBe(false);
  });

  it("rejects external or mismatched report routes", () => {
    expect(
      SummarySchema.safeParse({
        ...validSummary,
        report_route: "https://example.invalid/report"
      }).success
    ).toBe(false);
    expect(
      SummarySchema.safeParse({
        ...validSummary,
        report_route: "/stocks/other/2026-07-13/20260713-215103-aaaaaaaa/"
      }).success
    ).toBe(false);
  });

  it("requires every position and style exactly once", () => {
    const duplicatedRows = structuredClone(validSummary.advice_matrix);
    duplicatedRows[1].position = "none";
    expect(SummarySchema.safeParse({ ...validSummary, advice_matrix: duplicatedRows }).success).toBe(false);

    const duplicatedStyles = structuredClone(validSummary.advice_matrix);
    duplicatedStyles[0].cells[1].style = "short_aggressive";
    expect(SummarySchema.safeParse({ ...validSummary, advice_matrix: duplicatedStyles }).success).toBe(false);
  });

  it("bounds the total public metric count", () => {
    const metric = validSummary.metric_groups[0].metrics[0];
    const oversized = [{ ...validSummary.metric_groups[0], metrics: Array(51).fill(metric) }];
    expect(SummarySchema.safeParse({ ...validSummary, metric_groups: oversized }).success).toBe(false);
  });
});

describe("schema v2 public contracts", () => {
  it("accepts five metric groups with explicit evidence states", () => {
    const summary = schemaV2Summary();
    const result = SummarySchema.parse(summary);
    expect(result.schema_version).toBe(2);
    expect(result.metric_groups.map((group) => group.group)).toEqual(fixedMetricGroups);
    expect(result.metric_groups.find((group) => group.group === "valuation")).toEqual({
      group: "valuation",
      label: "估值",
      status: "insufficient_evidence",
      metrics: []
    });
  });

  it("accepts schema v2 manifests and lifecycle events without provider metadata", () => {
    expect(ManifestSchema.parse(schemaV2Manifest())).toEqual(schemaV2Manifest());
    expect(PublicationEventSchema.parse(schemaV2Event(publishedV1))).toEqual(
      schemaV2Event(publishedV1)
    );
    expect(PublicationEventSchema.parse(schemaV2Event(emergencyWithdrawal))).toEqual(
      schemaV2Event(emergencyWithdrawal)
    );
  });

  it("rejects schema v1 public packages and events", () => {
    expect(SummarySchema.safeParse({ ...validSummary, schema_version: 1 }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...validManifest, schema_version: 1 }).success).toBe(false);
    expect(
      PublicationEventSchema.safeParse({ ...publishedV1, schema_version: 1 }).success
    ).toBe(false);
  });

  it.each([
    ["empty matrix", { advice_matrix: [] }],
    ["missing metric group", { metric_groups: schemaV2Summary().metric_groups.slice(0, 4) }],
    [
      "duplicate metric group",
      {
        metric_groups: [
          ...schemaV2Summary().metric_groups.slice(0, 4),
          schemaV2Summary().metric_groups[0]
        ]
      }
    ]
  ])("rejects %s", (_name, patch) => {
    expect(SummarySchema.safeParse({ ...schemaV2Summary(), ...patch }).success).toBe(false);
  });

  it("requires supported metrics and permits explicit evidence gaps", () => {
    const emptySupported = schemaV2Summary();
    emptySupported.metric_groups[0].metrics = [];
    expect(SummarySchema.safeParse(emptySupported).success).toBe(false);

    const filledGap = schemaV2Summary();
    filledGap.metric_groups[2].metrics = [schemaV2Summary().metric_groups[0].metrics[0]];
    expect(SummarySchema.safeParse(filledGap).success).toBe(false);

    const placeholder = schemaV2Summary();
    placeholder.metric_groups[0].metrics[0].source_value = "示例值";
    expect(SummarySchema.safeParse(placeholder).success).toBe(false);
  });

  it("locks insufficient evidence display semantics", () => {
    const summary = schemaV2Summary();
    const cell = summary.advice_matrix[0].cells[2];
    cell.action = "等待更多证据";
    cell.conditions = ["价格突破后介入"];
    expect(SummarySchema.safeParse(summary).success).toBe(false);
  });

  it("rejects removed provider fields even on schema v2", () => {
    expect(
      SummarySchema.safeParse({ ...schemaV2Summary(), attributions: [] }).success
    ).toBe(false);
    expect(
      ManifestSchema.safeParse({
        ...schemaV2Manifest(),
        provenance_attestation_hash: "e".repeat(64),
        source_classes: []
      }).success
    ).toBe(false);
  });
});
