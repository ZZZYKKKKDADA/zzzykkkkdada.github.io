import { z } from "zod";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const CommitHashSchema = z.string().regex(/^[a-f0-9]{40}$/);
const TickerSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const VersionIdSchema = z.string().regex(/^\d{8}-\d{6}-[a-f0-9]{8,64}$/);

function safePath(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !value.includes("..") &&
    !value.includes("?") &&
    !value.includes("#")
  );
}

const ReportRouteSchema = z
  .string()
  .max(320)
  .refine(safePath)
  .regex(/^\/stocks\/[a-z0-9-]+\/\d{4}-\d{2}-\d{2}\/\d{8}-\d{6}-[a-f0-9]{8,64}\/$/);

const DownloadRouteSchema = z
  .string()
  .max(360)
  .refine(safePath)
  .regex(
    /^\/reports\/[a-z0-9-]+\/\d{4}-\d{2}-\d{2}\/\d{8}-\d{6}-[a-f0-9]{8,64}\/complete_report\.md$/
  );

function expectedReportRoute(tickerSlug: string, analysisDate: string, versionId: string): string {
  return `/stocks/${tickerSlug}/${analysisDate}/${versionId}/`;
}

function expectedDownloadRoute(tickerSlug: string, analysisDate: string, versionId: string): string {
  return `/reports/${tickerSlug}/${analysisDate}/${versionId}/complete_report.md`;
}

function eventRoutesMatchVersion(
  reportRoute: string,
  downloadRoute: string,
  versionId: string
): boolean {
  const match = reportRoute.match(/^\/stocks\/([^/]+)\/([^/]+)\/([^/]+)\/$/);
  if (!match) return false;
  const [, tickerSlug, analysisDate, routeVersionId] = match;
  return (
    routeVersionId === versionId &&
    downloadRoute === expectedDownloadRoute(tickerSlug, analysisDate, versionId)
  );
}

export const PositionSchema = z.enum(["none", "light", "medium", "heavy"]);
export const StyleSchema = z.enum([
  "short_aggressive",
  "short_conservative",
  "long_aggressive",
  "long_conservative"
]);
export const ActionClassSchema = z.enum([
  "avoid",
  "reduce",
  "hold",
  "conditional_enter",
  "conditional_add",
  "insufficient_evidence"
]);

const INSUFFICIENT_ADVICE = "报告证据不足，暂不形成建议";
const PLACEHOLDER_VALUES = new Set(["示例值", "n/a", "unknown", "未知", "待补充"]);

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_VALUES.has(value.trim().toLowerCase());
}

export const AdviceCellSchema = z
  .object({
    style: StyleSchema,
    action: z.string().min(1).max(120),
    action_class: ActionClassSchema,
    conditions: z.array(z.string().min(1).max(180)).max(4),
    risk: z.string().min(1).max(180)
  })
  .strict()
  .superRefine((cell, context) => {
    if (cell.action_class !== "insufficient_evidence") return;
    if (cell.action !== INSUFFICIENT_ADVICE) {
      context.addIssue({
        code: "custom",
        path: ["action"],
        message: "invalid insufficient-evidence action"
      });
    }
    if (cell.conditions.length !== 0) {
      context.addIssue({
        code: "custom",
        path: ["conditions"],
        message: "insufficient evidence cannot carry conditions"
      });
    }
  });

export const AdviceRowSchema = z
  .object({
    position: PositionSchema,
    cells: z.array(AdviceCellSchema).length(4)
  })
  .strict()
  .superRefine((row, context) => {
    if (new Set(row.cells.map((cell) => cell.style)).size !== StyleSchema.options.length) {
      context.addIssue({
        code: "custom",
        path: ["cells"],
        message: "each advice row must contain every style exactly once"
      });
    }
  });

const MetricSchema = z
  .object({
    name: z.string().min(1).max(100).refine((value) => !isPlaceholder(value)),
    source_value: z.string().min(1).max(120).refine((value) => !isPlaceholder(value)),
    unit: z.string().min(1).max(40).refine((value) => !isPlaceholder(value)),
    as_of_date: z.iso.date().optional(),
    interpretation: z.string().min(1).max(240),
    decision_impact: z.string().min(1).max(240)
  })
  .strict();

const MetricGroupNameSchema = z.enum([
  "trend",
  "momentum",
  "valuation",
  "fundamental_quality",
  "capital_risk"
]);

const MetricGroupBaseSchema = z.object({
  group: MetricGroupNameSchema,
  label: z.string().min(1).max(40)
});

const MetricGroupSchema = z.discriminatedUnion("status", [
  MetricGroupBaseSchema.extend({
    status: z.literal("supported"),
    metrics: z.array(MetricSchema).min(1).max(12)
  }).strict(),
  MetricGroupBaseSchema.extend({
    status: z.literal("insufficient_evidence"),
    metrics: z.array(MetricSchema).length(0)
  }).strict()
]);

const SummaryBaseSchema = z
  .object({
    schema_version: z.literal(2),
    ticker: z.string().min(1).max(40),
    ticker_slug: TickerSlugSchema,
    company: z.string().min(1).max(120),
    market: z.string().min(1).max(60),
    analysis_date: z.iso.date(),
    publication_date: z.iso.date(),
    version_id: VersionIdSchema,
    source_tree_hash: Sha256Schema,
    content_hash: Sha256Schema,
    supersedes: VersionIdSchema.nullable(),
    correction_reason: z.string().min(1).max(240).nullable(),
    rating: z.enum(["Buy", "Overweight", "Hold", "Underweight", "Sell"]),
    conclusion: z.string().min(1).max(360),
    advice_matrix: z.array(AdviceRowSchema).length(4),
    metric_groups: z.array(MetricGroupSchema).length(5),
    disclaimer: z
      .object({
        historical_boundary: z.string().min(1).max(240),
        ai_assisted: z.string().min(1).max(240),
        not_investment_advice: z.string().min(1).max(240),
        public_access: z.string().min(1).max(240)
      })
      .strict(),
    report_route: ReportRouteSchema,
    download_route: DownloadRouteSchema
  })
  .strict();

export const SummarySchema = SummaryBaseSchema.superRefine((summary, context) => {
  if (new Set(summary.advice_matrix.map((row) => row.position)).size !== PositionSchema.options.length) {
    context.addIssue({
      code: "custom",
      path: ["advice_matrix"],
      message: "the advice matrix must contain every position exactly once"
    });
  }
  if (
    summary.metric_groups.some(
      (group, index) => group.group !== MetricGroupNameSchema.options[index]
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["metric_groups"],
      message: "metric groups must appear once in stable order"
    });
  }
  const metricCount = summary.metric_groups.reduce((total, group) => total + group.metrics.length, 0);
  if (metricCount > 50) {
    context.addIssue({
      code: "custom",
      path: ["metric_groups"],
      message: "public metric count exceeds 50"
    });
  }
  if (summary.report_route !== expectedReportRoute(summary.ticker_slug, summary.analysis_date, summary.version_id)) {
    context.addIssue({ code: "custom", path: ["report_route"], message: "report route does not match identity" });
  }
  if (
    summary.download_route !==
    expectedDownloadRoute(summary.ticker_slug, summary.analysis_date, summary.version_id)
  ) {
    context.addIssue({
      code: "custom",
      path: ["download_route"],
      message: "download route does not match identity"
    });
  }
  if ((summary.supersedes === null) !== (summary.correction_reason === null)) {
    context.addIssue({
      code: "custom",
      path: ["supersedes"],
      message: "supersedes and correction_reason must appear together"
    });
  }
});

const ManifestBaseSchema = z
  .object({
    schema_version: z.literal(2),
    ticker: z.string().min(1).max(40),
    ticker_slug: TickerSlugSchema,
    company: z.string().min(1).max(120),
    market: z.string().min(1).max(60),
    analysis_date: z.iso.date(),
    publication_date: z.iso.date(),
    source_display_timestamp: z.string().regex(/^\d{8}_\d{6}$/),
    version_id: VersionIdSchema,
    source_tree_hash: Sha256Schema,
    content_hash: Sha256Schema,
    summary_sha256: Sha256Schema,
    complete_report_sha256: Sha256Schema,
    publisher_version: z.string().min(1).max(80),
    supersedes: VersionIdSchema.nullable(),
    correction_reason: z.string().min(1).max(240).nullable(),
    report_route: ReportRouteSchema,
    download_route: DownloadRouteSchema
  })
  .strict();

export const ManifestSchema = ManifestBaseSchema.superRefine((manifest, context) => {
  if (manifest.report_route !== expectedReportRoute(manifest.ticker_slug, manifest.analysis_date, manifest.version_id)) {
    context.addIssue({ code: "custom", path: ["report_route"], message: "report route does not match identity" });
  }
  if (
    manifest.download_route !==
    expectedDownloadRoute(manifest.ticker_slug, manifest.analysis_date, manifest.version_id)
  ) {
    context.addIssue({
      code: "custom",
      path: ["download_route"],
      message: "download route does not match identity"
    });
  }
  if ((manifest.supersedes === null) !== (manifest.correction_reason === null)) {
    context.addIssue({
      code: "custom",
      path: ["supersedes"],
      message: "supersedes and correction_reason must appear together"
    });
  }
});

const EventBaseShape = {
  schema_version: z.literal(2),
  event_id: z.string().regex(/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/).max(120),
  timestamp: z.iso.datetime({ offset: true }),
  version_id: VersionIdSchema,
  source_tree_hash: Sha256Schema
};

const PublishedEventSchema = z
  .object({
    ...EventBaseShape,
    type: z.literal("published"),
    report_route: ReportRouteSchema,
    download_route: DownloadRouteSchema
  })
  .strict()
  .superRefine((event, context) => {
    if (!eventRoutesMatchVersion(event.report_route, event.download_route, event.version_id)) {
      context.addIssue({
        code: "custom",
        path: ["report_route"],
        message: "published routes do not match the version identity"
      });
    }
  });

const SupersededEventSchema = z
  .object({
    ...EventBaseShape,
    type: z.literal("superseded"),
    replacement_version_id: VersionIdSchema,
    reason: z.string().min(1).max(240)
  })
  .strict()
  .refine((event) => event.version_id !== event.replacement_version_id, {
    path: ["replacement_version_id"],
    message: "a version cannot supersede itself"
  });

const WithdrawnEventBaseSchema = z
  .object({
    ...EventBaseShape,
    type: z.literal("withdrawn"),
    mode: z.enum(["editorial", "emergency"]),
    withdrawn_at: z.iso.datetime({ offset: true }),
    ticker_slug: TickerSlugSchema,
    analysis_date: z.iso.date(),
    report_route: ReportRouteSchema,
    download_route: DownloadRouteSchema,
    public_reason: z.string().min(1).max(240),
    publication_commit: CommitHashSchema
  })
  .strict()
  .superRefine((event, context) => {
    if (event.report_route !== expectedReportRoute(event.ticker_slug, event.analysis_date, event.version_id)) {
      context.addIssue({ code: "custom", path: ["report_route"], message: "report route does not match identity" });
    }
    if (
      event.download_route !==
      expectedDownloadRoute(event.ticker_slug, event.analysis_date, event.version_id)
    ) {
      context.addIssue({
        code: "custom",
        path: ["download_route"],
        message: "download route does not match identity"
      });
    }
  });

export const PublicationEventSchema = z.union([
  PublishedEventSchema,
  SupersededEventSchema,
  WithdrawnEventBaseSchema
]);

export type Summary = z.infer<typeof SummarySchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type PublicationEvent = z.infer<typeof PublicationEventSchema>;
