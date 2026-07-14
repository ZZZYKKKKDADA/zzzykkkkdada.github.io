import { describe, expect, it } from "vitest";
import {
  replayAllLineages,
  replayLineage
} from "../../src/lib/lifecycle";
import { loadSiteRepository } from "../../src/lib/repository";
import {
  copyFixture,
  editorialWithdrawal,
  emergencyWithdrawal,
  publishedV1,
  publishedV2
} from "../helpers/fixtures";

describe("publication lifecycle", () => {
  it("rejects two current leaves in one source lineage", () => {
    expect(() => replayLineage([publishedV1, publishedV2])).toThrow(
      "MULTIPLE_CURRENT_LEAVES"
    );
  });

  it("keeps editorial content served and emergency content absent", () => {
    expect(replayLineage([publishedV1, editorialWithdrawal]).leaf.status).toBe(
      "editorial_withdrawn"
    );
    expect(replayLineage([publishedV2, emergencyWithdrawal]).leaf.status).toBe(
      "emergency_withdrawn"
    );
  });

  it("rejects duplicate event IDs", () => {
    expect(() => replayLineage([publishedV1, { ...editorialWithdrawal, event_id: publishedV1.event_id }]))
      .toThrow("DUPLICATE_EVENT_ID");
  });

  it("replays every valid repository lineage", async () => {
    const repository = await loadSiteRepository(await copyFixture("valid"));
    const lineages = replayAllLineages(repository);
    expect(lineages.size).toBe(1);
    expect([...lineages.values()][0].leaf.status).toBe("current");
  });
});
