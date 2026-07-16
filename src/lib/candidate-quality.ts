import type { Summary } from "./contracts";

type CandidateSummary = Pick<Summary, "advice_matrix" | "metric_groups">;

function normalized(value: string): string {
  return value.normalize("NFKC").trim();
}

function fingerprint(value: unknown): string {
  return JSON.stringify(value);
}

function fail(code: "DEGENERATE_ADVICE_MATRIX" | "INCOMPLETE_METRIC_COVERAGE"): never {
  throw new Error(code);
}

export function assertCandidateQuality(summary: CandidateSummary): void {
  const cells = summary.advice_matrix.flatMap((row) =>
    row.cells.map((cell) => ({ position: row.position, ...cell }))
  );
  const actions = cells.map((cell) => normalized(cell.action));
  if (new Set(actions).size !== 16) fail("DEGENERATE_ADVICE_MATRIX");

  const semanticCells = cells.map((cell) => ({
    position: cell.position,
    action: normalized(cell.action),
    action_class: cell.action_class,
    conditions: cell.conditions.map(normalized),
    risk: normalized(cell.risk)
  }));
  if (new Set(semanticCells.map(fingerprint)).size !== 16) {
    fail("DEGENERATE_ADVICE_MATRIX");
  }

  const rowFingerprints = summary.advice_matrix.map((row) =>
    fingerprint(semanticCells.filter((cell) => cell.position === row.position))
  );
  if (new Set(rowFingerprints).size !== 4) fail("DEGENERATE_ADVICE_MATRIX");
  if (new Set(cells.map((cell) => cell.action_class)).size < 2) {
    fail("DEGENERATE_ADVICE_MATRIX");
  }
  if (!cells.some((cell) => cell.conditions.length > 0)) {
    fail("DEGENERATE_ADVICE_MATRIX");
  }

  const pairsByPosition = new Map<string, string>();
  for (const cell of cells) {
    const pair = fingerprint([normalized(cell.action), normalized(cell.risk)]);
    const previous = pairsByPosition.get(pair);
    if (previous !== undefined && previous !== cell.position) {
      fail("DEGENERATE_ADVICE_MATRIX");
    }
    pairsByPosition.set(pair, cell.position);
  }

  if (
    summary.metric_groups.some(
      (group) => group.status !== "supported" || group.metrics.length === 0
    )
  ) {
    fail("INCOMPLETE_METRIC_COVERAGE");
  }
}
