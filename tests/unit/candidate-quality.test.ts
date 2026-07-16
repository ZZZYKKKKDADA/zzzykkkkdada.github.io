import { describe, expect, it } from "vitest";
import { assertCandidateQuality } from "../../src/lib/candidate-quality";
import { ordinaryInput } from "../helpers/fixtures";

function candidate() {
  return structuredClone(ordinaryInput.summaryDraft);
}

describe("candidate quality", () => {
  it("accepts a complete production candidate", () => {
    expect(() => assertCandidateQuality(candidate())).not.toThrow();
  });

  it("rejects the collapsed 600664-shaped matrix", () => {
    const summary = candidate();
    for (const row of summary.advice_matrix) {
      for (const cell of row.cells) {
        cell.action = "降低风险暴露，避免追逐连板行情。";
        cell.action_class = "reduce";
        cell.conditions = [];
        cell.risk = "高乖离、高波动与开板后的流动性风险。";
      }
    }
    expect(() => assertCandidateQuality(summary)).toThrow("DEGENERATE_ADVICE_MATRIX");
  });

  it("rejects one action class or no conditions", () => {
    const summary = candidate();
    for (const row of summary.advice_matrix) {
      for (const cell of row.cells) {
        cell.action_class = "hold";
        cell.conditions = [];
      }
    }
    expect(() => assertCandidateQuality(summary)).toThrow("DEGENERATE_ADVICE_MATRIX");
  });

  it("rejects incomplete metric coverage", () => {
    const summary = candidate();
    summary.metric_groups[2] = {
      ...summary.metric_groups[2],
      status: "insufficient_evidence",
      metrics: []
    };
    expect(() => assertCandidateQuality(summary)).toThrow("INCOMPLETE_METRIC_COVERAGE");
  });
});
