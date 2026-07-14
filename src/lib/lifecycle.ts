import {
  PublicationEventSchema,
  type PublicationEvent
} from "./contracts";
import type { SiteRepository } from "./repository";

export type LifecycleStatus =
  | "current"
  | "superseded"
  | "editorial_withdrawn"
  | "emergency_withdrawn";

export interface VersionState {
  versionId: string;
  sourceTreeHash: string;
  status: LifecycleStatus;
  reportRoute: string;
  downloadRoute: string;
  replacementVersionId?: string;
  publicReason?: string;
}

export interface LineageState {
  sourceTreeHash: string;
  versions: readonly VersionState[];
  leaf: VersionState;
}

interface MutableVersionState extends VersionState {
  status: LifecycleStatus;
}

function failure(code: string): Error {
  return new Error(code);
}

function uniqueEventIds(events: readonly PublicationEvent[]): void {
  const ids = new Set<string>();
  for (const event of events) {
    if (ids.has(event.event_id)) throw failure("DUPLICATE_EVENT_ID");
    ids.add(event.event_id);
  }
}

export function replayLineage(input: readonly PublicationEvent[]): LineageState {
  if (input.length === 0) throw failure("EMPTY_LINEAGE");
  const events = input.map((event) => PublicationEventSchema.parse(event));
  uniqueEventIds(events);

  const sourceTreeHash = events[0].source_tree_hash;
  if (events.some((event) => event.source_tree_hash !== sourceTreeHash)) {
    throw failure("MIXED_SOURCE_LINEAGE");
  }

  const versions = new Map<string, MutableVersionState>();
  const replacements = new Map<string, string>();
  const predecessors = new Map<string, string>();
  let previousTimestamp = "";

  for (const event of events) {
    if (previousTimestamp && event.timestamp < previousTimestamp) {
      throw failure("NON_MONOTONIC_EVENT_TIME");
    }
    previousTimestamp = event.timestamp;

    if (event.type === "published") {
      if (versions.has(event.version_id)) throw failure("DUPLICATE_PUBLICATION");
      versions.set(event.version_id, {
        versionId: event.version_id,
        sourceTreeHash,
        status: "current",
        reportRoute: event.report_route,
        downloadRoute: event.download_route
      });
      continue;
    }

    const target = versions.get(event.version_id);
    if (!target) throw failure("EVENT_TARGET_NOT_PUBLISHED");

    if (event.type === "superseded") {
      const replacement = versions.get(event.replacement_version_id);
      if (!replacement) throw failure("REPLACEMENT_NOT_PUBLISHED");
      if (replacements.has(event.version_id) || predecessors.has(event.replacement_version_id)) {
        throw failure("CORRECTION_FORK");
      }
      if (target.status !== "current" || replacement.status !== "current") {
        throw failure("ILLEGAL_SUPERSEDE_TRANSITION");
      }
      target.status = "superseded";
      target.replacementVersionId = event.replacement_version_id;
      replacements.set(event.version_id, event.replacement_version_id);
      predecessors.set(event.replacement_version_id, event.version_id);
      continue;
    }

    if (target.status === "editorial_withdrawn" || target.status === "emergency_withdrawn") {
      throw failure("DUPLICATE_WITHDRAWAL");
    }
    if (target.reportRoute !== event.report_route || target.downloadRoute !== event.download_route) {
      throw failure("WITHDRAWAL_ROUTE_MISMATCH");
    }
    target.status = event.mode === "editorial" ? "editorial_withdrawn" : "emergency_withdrawn";
    target.publicReason = event.public_reason;
  }

  const leaves = [...versions.values()].filter((version) => !replacements.has(version.versionId));
  if (leaves.length !== 1) throw failure("MULTIPLE_CURRENT_LEAVES");
  const orderedVersions = [...versions.values()].sort((left, right) =>
    left.versionId.localeCompare(right.versionId, "en")
  );
  return { sourceTreeHash, versions: orderedVersions, leaf: leaves[0] };
}

export function replayAllLineages(
  repository: SiteRepository
): ReadonlyMap<string, LineageState> {
  uniqueEventIds(repository.events);
  const grouped = new Map<string, PublicationEvent[]>();
  for (const event of repository.events) {
    const lineageEvents = grouped.get(event.source_tree_hash) ?? [];
    lineageEvents.push(event);
    grouped.set(event.source_tree_hash, lineageEvents);
  }

  const lineages = new Map<string, LineageState>();
  const publishedVersionIds = new Set<string>();
  for (const sourceTreeHash of [...grouped.keys()].sort()) {
    const lineage = replayLineage(grouped.get(sourceTreeHash) ?? []);
    for (const version of lineage.versions) {
      publishedVersionIds.add(version.versionId);
      const packageExists = repository.packages.has(version.versionId);
      if (version.status === "emergency_withdrawn" && packageExists) {
        throw failure("EMERGENCY_PACKAGE_STILL_PRESENT");
      }
      if (version.status !== "emergency_withdrawn" && !packageExists) {
        throw failure("SERVED_PACKAGE_MISSING");
      }
    }
    lineages.set(sourceTreeHash, lineage);
  }

  for (const versionId of repository.packages.keys()) {
    if (!publishedVersionIds.has(versionId)) throw failure("ORPHAN_REPORT_PACKAGE");
  }
  return lineages;
}
