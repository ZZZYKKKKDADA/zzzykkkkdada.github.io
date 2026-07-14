import type { Summary } from "./contracts";
import {
  replayAllLineages,
  type LifecycleStatus,
  type VersionState
} from "./lifecycle";
import {
  renderSafeMarkdown,
  type RenderedMarkdown
} from "./markdown";
import { loadSiteRepository } from "./repository";
import { auditSite } from "./site-audit";

export interface ReportView {
  versionId: string;
  sourceTreeHash: string;
  ticker: string;
  tickerSlug: string;
  company: string;
  market: string;
  analysisDate: string;
  publicationDate: string | null;
  status: LifecycleStatus;
  reportRoute: string;
  downloadRoute: string | null;
  replacementVersionId?: string;
  withdrawalReason?: string;
  summary: Summary | null;
  markdown: RenderedMarkdown | null;
}

export interface TickerView {
  ticker: string;
  tickerSlug: string;
  company: string;
  market: string;
  reports: readonly ReportView[];
  latest: ReportView | null;
}

export interface SiteViews {
  tickers: readonly TickerView[];
  reports: readonly ReportView[];
  byRoute: ReadonlyMap<string, ReportView>;
}

function descending(left: string | null, right: string | null): number {
  return (right ?? "").localeCompare(left ?? "", "en");
}

function compareReports(left: ReportView, right: ReportView): number {
  return (
    descending(left.analysisDate, right.analysisDate) ||
    descending(left.publicationDate, right.publicationDate) ||
    descending(left.versionId, right.versionId)
  );
}

function parseEmergencyIdentity(reportRoute: string): {
  tickerSlug: string;
  analysisDate: string;
} {
  const match = reportRoute.match(/^\/stocks\/([^/]+)\/([^/]+)\/[^/]+\/$/);
  if (!match) throw new Error("INVALID_TOMBSTONE_ROUTE");
  return { tickerSlug: match[1], analysisDate: match[2] };
}

function versionStatesById(
  lineages: ReturnType<typeof replayAllLineages>
): ReadonlyMap<string, VersionState> {
  const result = new Map<string, VersionState>();
  for (const lineage of lineages.values()) {
    for (const version of lineage.versions) result.set(version.versionId, version);
  }
  return result;
}

export async function buildSiteViews(root: string): Promise<SiteViews> {
  const audit = await auditSite(root);
  if (!audit.ok) throw new Error("SITE_AUDIT_FAILED");

  const repository = await loadSiteRepository(root);
  const lineages = replayAllLineages(repository);
  const states = versionStatesById(lineages);
  const reports: ReportView[] = [];

  for (const [versionId, loadedPackage] of repository.packages) {
    const state = states.get(versionId);
    if (!state || state.status === "emergency_withdrawn") {
      throw new Error("SITE_AUDIT_FAILED");
    }
    reports.push({
      versionId,
      sourceTreeHash: loadedPackage.summary.source_tree_hash,
      ticker: loadedPackage.summary.ticker,
      tickerSlug: loadedPackage.summary.ticker_slug,
      company: loadedPackage.summary.company,
      market: loadedPackage.summary.market,
      analysisDate: loadedPackage.summary.analysis_date,
      publicationDate: loadedPackage.summary.publication_date,
      status: state.status,
      reportRoute: loadedPackage.summary.report_route,
      downloadRoute: loadedPackage.summary.download_route,
      replacementVersionId: state.replacementVersionId,
      withdrawalReason: state.publicReason,
      summary: loadedPackage.summary,
      markdown: await renderSafeMarkdown(loadedPackage.markdown)
    });
  }

  for (const event of repository.events) {
    if (event.type !== "withdrawn" || event.mode !== "emergency") continue;
    const state = states.get(event.version_id);
    if (!state || state.status !== "emergency_withdrawn") throw new Error("SITE_AUDIT_FAILED");
    const identity = parseEmergencyIdentity(event.report_route);
    reports.push({
      versionId: event.version_id,
      sourceTreeHash: event.source_tree_hash,
      ticker: identity.tickerSlug,
      tickerSlug: identity.tickerSlug,
      company: "已撤下报告",
      market: "",
      analysisDate: identity.analysisDate,
      publicationDate: null,
      status: "emergency_withdrawn",
      reportRoute: event.report_route,
      downloadRoute: null,
      withdrawalReason: event.public_reason,
      summary: null,
      markdown: null
    });
  }

  reports.sort(compareReports);
  const byRoute = new Map<string, ReportView>();
  for (const report of reports) {
    if (byRoute.has(report.reportRoute)) throw new Error("DUPLICATE_ROUTE");
    byRoute.set(report.reportRoute, report);
  }

  const tickerGroups = new Map<string, ReportView[]>();
  for (const report of reports) {
    if (!report.summary) continue;
    const group = tickerGroups.get(report.tickerSlug) ?? [];
    group.push(report);
    tickerGroups.set(report.tickerSlug, group);
  }
  const tickers = [...tickerGroups.values()]
    .map((group): TickerView => {
      const sorted = [...group].sort(compareReports);
      const identity = sorted[0];
      return {
        ticker: identity.ticker,
        tickerSlug: identity.tickerSlug,
        company: identity.company,
        market: identity.market,
        reports: sorted,
        latest: sorted.find((report) => report.status === "current") ?? null
      };
    })
    .sort((left, right) =>
      `${left.company}\0${left.ticker}`.localeCompare(`${right.company}\0${right.ticker}`, "en")
    );

  return { tickers, reports, byRoute };
}
