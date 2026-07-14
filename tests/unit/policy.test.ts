import { describe, expect, it } from "vitest";
import { evaluateSourceClasses } from "../../src/lib/policy";
import { validManifest } from "../helpers/fixtures";

const allowedPolicy = {
  schema_version: 1 as const,
  entries: [
    {
      id: "synthetic-local-v1",
      source_class: "synthetic_local",
      status: "allowed" as const,
      allowed_content_classes: ["derived_fact", "locally_authored_analysis"],
      prohibited_content_classes: ["raw_payload"],
      required_attribution: "合成测试数据，不代表真实市场信息。",
      terms_url: "https://example.invalid/synthetic-source",
      reviewed_on: "2026-07-14"
    }
  ]
};

describe("source policy evaluation", () => {
  it("accepts exact allowed public source metadata", () => {
    expect(
      evaluateSourceClasses(validManifest.version_id, validManifest.source_classes, allowedPolicy)
    ).toEqual([]);
  });

  it("blocks restricted sources and invalid attribution IDs", () => {
    const restricted = {
      ...allowedPolicy,
      entries: [{ ...allowedPolicy.entries[0], status: "restricted" as const }]
    };
    expect(
      evaluateSourceClasses(validManifest.version_id, validManifest.source_classes, restricted)[0]
        .code
    ).toBe("SOURCE_POLICY_BLOCKED");

    const wrongId = [{ ...validManifest.source_classes[0], policy_entry_id: "wrong-v1" }];
    expect(evaluateSourceClasses(validManifest.version_id, wrongId, allowedPolicy)[0].code).toBe(
      "INVALID_ATTRIBUTION_ID"
    );
  });
});
