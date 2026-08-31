import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { PROJECT_HEALTH_BUDGETS } from "@story-to-cyoa/persistence";
import {
  createHistoryHeavyProjectFixture,
  type HistoryHeavyProjectFixture,
} from "./fixtures/history-heavy-project.js";

const fixtures: HistoryHeavyProjectFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    for (const app of fixture.apps) await app.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

describe("Foundation 8B deterministic history-heavy project", () => {
  it("keeps every operational list and Health structurally bounded with heavy bodies detail-only", async () => {
    const fixture = await createHistoryHeavyProjectFixture(); fixtures.push(fixture);
    const root = `/api/long-form/projects/${fixture.projectId}`;
    const surfaces = [
      ["passage-metadata", `${root}/passage-plan`],
      ["draft-review-queue", `${root}/drafts/review-queue`],
      ["simulation-list", `${root}/simulation/runs`],
      ["playtest-list", `${root}/simulation/playtests/campaigns`],
      ["narrative-list", `${root}/narrative-review/plans`],
      ["repair-plans", `${root}/repair/plans`],
      ["repair-proposals", `${root}/repair/proposals`],
      ["repair-applications", `${root}/repair/applications`],
      ["publication-builds", `${root}/publication/builds`],
      ["recovery-status", `/api/projects/${fixture.projectId}/recovery`],
      ["project-health", `${root}/health`],
      ["usage-report", `${root}/health/usage`],
    ] as const;
    const measurements: Record<string, number> = {};
    const bodies: Record<string, string> = {};
    for (const [name, url] of surfaces) {
      const response = await fixture.app.inject({ method: "GET", url });
      expect(response.statusCode, `${name}: ${response.body}`).toBe(200);
      measurements[name] = Buffer.byteLength(response.body);
      bodies[name] = response.body;
      expect(measurements[name], name).toBeLessThanOrEqual(PROJECT_HEALTH_BUDGETS.maximumHealthResponseBytes);
    }

    expect(bodies["passage-metadata"]).not.toContain(fixture.proseMarker);
    expect(bodies["draft-review-queue"]).not.toContain(fixture.proseMarker);
    expect(JSON.parse(bodies["simulation-list"]!).items[0]).not.toHaveProperty("trace");
    expect(JSON.parse(bodies["simulation-list"]!).items[0]).not.toHaveProperty("steps");
    expect(JSON.parse(bodies["simulation-list"]!).items[0]).not.toHaveProperty("findings");
    expect(bodies["playtest-list"]).not.toContain("samples");
    expect(bodies["project-health"]).not.toContain(fixture.proseMarker);
    expect(bodies["project-health"]).not.toContain("fixture-missing-choice");

    const health = JSON.parse(bodies["project-health"]!) as Record<string, any>;
    expect(health.scale).toMatchObject({
      passageEntityVersions: expect.any(Number),
      draftVersions: expect.any(Number),
      simulationRuns: 1,
      playtestCampaigns: 1,
      narrativeReviewVersions: 4,
      repairPlans: 1,
      repairProposals: 1,
      repairApplications: 1,
      nativeBuilds: 1,
      verifiedBackups: 2,
      restoreRecords: 1,
    });
    expect(health.scale.passageEntityVersions).toBeGreaterThan(health.scale.passages);
    expect(health.scale.draftVersions).toBeGreaterThan(health.scale.acceptedDrafts);
    expect(health.scale.staleCurrentDrafts + health.scale.staleAcceptedDrafts).toBeGreaterThan(0);
    expect(health.evidence.latest).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "simulation" }),
      expect.objectContaining({ kind: "playtest" }),
      expect.objectContaining({ kind: "narrative-review" }),
    ]));
    expect(measurements["project-health"]).toBeLessThanOrEqual(PROJECT_HEALTH_BUDGETS.maximumHealthResponseBytes);

    const usage = JSON.parse(bodies["usage-report"]!) as Record<string, any>;
    expect(usage.totals).toMatchObject({
      attemptCount: expect.any(Number),
      providerRequestCountStatus: "known",
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
    });
    expect(usage.totals.attemptCount).toBeGreaterThan(0);
    expect(usage.totals.providerRequestCount).toBeGreaterThan(usage.totals.attemptCount);

    expect(JSON.parse(bodies["repair-plans"]!).items).toHaveLength(1);
    expect(JSON.parse(bodies["repair-proposals"]!).items).toHaveLength(1);
    expect(JSON.parse(bodies["repair-applications"]!).items).toHaveLength(1);
    expect(JSON.parse(bodies["publication-builds"]!).items).toHaveLength(1);
    expect(JSON.parse(bodies["recovery-status"]!)).toMatchObject({
      latestVerifiedBackup: { backupId: expect.any(String) },
      restores: [expect.objectContaining({ restoreId: expect.any(String) })],
    });

    // This snapshot is documentation evidence, not a timing assertion.
    expect(measurements).toMatchObject(Object.fromEntries(surfaces.map(([name]) => [name, expect.any(Number)])));
  }, 30_000);
});
