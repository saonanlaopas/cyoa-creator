import { afterEach, describe, expect, it } from "vitest";
import { ArtifactRepository, openDatabase, ProjectRepository, type StoryDatabase } from "@story-to-cyoa/persistence";
import { ProjectHealthService } from "../src/services/project-health-service.js";

const databases: StoryDatabase[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe("Foundation 8B project health", () => {
  it("uses latest immutable aggregate evidence once and labels incomplete historical cost as partial", () => {
    const database = openDatabase(); databases.push(database);
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const project = projects.create("Health fixture", undefined, "long-form");
    artifacts.saveArtifact({
      projectId: project.id, artifactId: "review-history", artifactType: "narrative-review",
      content: { plan: { providerId: "offline", modelId: "old" }, job: { units: [{ attempts: [{ status: "completed", usage: { inputTokens: 900, outputTokens: 900, cost: 9 }, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:00.000Z" }] }] } },
    });
    artifacts.saveArtifact({
      projectId: project.id, artifactId: "review-history", artifactType: "narrative-review",
      content: { plan: { providerId: "offline", modelId: "current" }, job: { units: [{ attempts: [{ status: "completed", usage: { inputTokens: 11, outputTokens: 7, cost: 0.12 }, startedAt: "2026-02-01T00:00:00.000Z", finishedAt: "2026-02-01T00:00:00.000Z" }] }] } },
    });
    artifacts.saveArtifact({
      projectId: project.id, artifactId: "repair-history", artifactType: "repair-proposal-generation",
      content: { generation: { providerId: "offline", modelId: "current" }, job: { units: [{ attempts: [{ status: "completed", usage: { inputTokens: 5, outputTokens: 3 }, startedAt: "2026-02-02T00:00:00.000Z", finishedAt: "2026-02-02T00:00:00.000Z" }] }] } },
    });

    const service = new ProjectHealthService(database, projects);
    const usage = service.usage(project.id);

    expect(usage.totals).toMatchObject({ requestCount: 2, inputTokens: 16, outputTokens: 10 });
    expect(usage.totals.cost).toEqual(expect.objectContaining({ status: "partial", recorded: 0.12, recordedRequestCount: 1, unknownRequestCount: 1 }));
    expect(usage.groups).toHaveLength(2);
    expect(usage.authority.excludes).toContain("candidate mirrors");
  });

  it("returns structural diagnostics without loading immutable artifact bodies", () => {
    const database = openDatabase(); databases.push(database);
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const project = projects.create("Health fixture", undefined, "long-form");
    artifacts.saveArtifact({ projectId: project.id, artifactId: "narrative", artifactType: "narrative-review", content: { proseMarkdown: "secret prose must stay detail-only" } });

    const health = new ProjectHealthService(database, projects).get(project.id);

    expect(JSON.stringify(health)).not.toContain("secret prose");
    expect(health.storage.policy).toBe("diagnostic-only-no-automatic-cleanup");
    expect(health.publication.currentReadiness).toBe("not-evaluated");
    expect(health.recovery.currentFreshness).toBe("not-evaluated");
  });
});
