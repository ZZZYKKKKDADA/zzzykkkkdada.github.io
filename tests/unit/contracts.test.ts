import { describe, expect, it } from "vitest";
import {
  ManifestSchema,
  PublicationEventSchema,
  SourcePolicySchema,
  SummarySchema
} from "../../src/lib/contracts";
import {
  emergencyWithdrawal,
  publishedV1,
  validManifest,
  validSummary
} from "../helpers/fixtures";

describe("public contracts", () => {
  it("accepts the complete synthetic package contracts", () => {
    expect(SummarySchema.parse(validSummary)).toEqual(validSummary);
    expect(ManifestSchema.parse(validManifest)).toEqual(validManifest);
    expect(PublicationEventSchema.parse(publishedV1)).toEqual(publishedV1);
    expect(PublicationEventSchema.parse(emergencyWithdrawal)).toEqual(emergencyWithdrawal);
    expect(SourcePolicySchema.parse({ schema_version: 1, entries: [] })).toEqual({
      schema_version: 1,
      entries: []
    });
  });

  it("rejects a matrix that is not exactly 4x4", () => {
    const result = SummarySchema.safeParse({ ...validSummary, advice_matrix: [] });
    expect(result.success).toBe(false);
  });

  it("requires emergency route and policy identity", () => {
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

  it("rejects a manifest without source policy classes", () => {
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
