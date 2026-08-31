import { afterEach, describe, expect, it } from "vitest";
import {
  ArtifactRepository,
  JobRepository,
  openDatabase,
  PassagePlanRepository,
  ProjectRepository,
  PROJECT_HEALTH_BUDGETS,
  type StoryDatabase,
} from "@story-to-cyoa/persistence";
import { ProjectHealthService } from "../src/services/project-health-service.js";

const databases: StoryDatabase[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe("Foundation 8B project health", () => {
  it("separates attempts from exact provider requests across aggregate and legacy usage", () => {
    const database = openDatabase(); databases.push(database);
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const project = projects.create("Health fixture", undefined, "long-form");
    artifacts.saveArtifact({
      projectId: project.id, artifactId: "review-history", artifactType: "narrative-review",
      content: { plan: { providerId: "offline", modelId: "old" }, job: { units: [{ attempts: [{ status: "completed", repair: { performed: 0 }, usage: { inputTokens: 900, outputTokens: 900, cost: 9 }, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:00.000Z" }] }] } },
    });
    artifacts.saveArtifact({
      projectId: project.id, artifactId: "review-history", artifactType: "narrative-review",
      content: { plan: { providerId: "offline", modelId: "current" }, job: { units: [{ attempts: [{ status: "completed", repair: { performed: 1 }, usage: { inputTokens: 11, outputTokens: 7, cost: 0.12 }, startedAt: "2026-02-01T00:00:00.000Z", finishedAt: "2026-02-01T00:00:00.000Z" }] }] } },
    });
    artifacts.saveArtifact({
      projectId: project.id, artifactId: "repair-history", artifactType: "repair-proposal-generation",
      content: { generation: { providerId: "offline", modelId: "current" }, job: { units: [{ attempts: [{ status: "completed", repair: { performed: 0 }, usage: { inputTokens: 5, outputTokens: 3 }, startedAt: "2026-02-02T00:00:00.000Z", finishedAt: "2026-02-02T00:00:00.000Z" }] }] } },
    });
    const jobs = new JobRepository(database);
    const legacy = jobs.create(project.id, "legacy-chat");
    jobs.recordUsage(legacy.id, { promptTokens: 2, completionTokens: 1, cost: 0.01 });

    const service = new ProjectHealthService(database, projects);
    const usage = service.usage(project.id);

    expect(usage.totals).toMatchObject({
      attemptCount: 2,
      providerRequestCount: 4,
      providerRequestCountStatus: "known",
      unknownProviderRequestAttemptCount: 0,
      inputTokens: 18,
      outputTokens: 11,
    });
    expect(usage.totals.cost).toEqual(expect.objectContaining({
      status: "partial", recorded: 0.13, recordedRequestCount: 2, unknownRequestCount: 1,
    }));
    expect(usage.groups).toHaveLength(3);
    expect(usage.groups.find((group) => group.workflow === "narrative-review")).toMatchObject({
      attemptCount: 1, providerRequestCount: 2, providerRequestCountStatus: "known",
    });
    expect(usage.groups.find((group) => group.workflow === "repair-proposal")).toMatchObject({
      attemptCount: 1, providerRequestCount: 1, providerRequestCountStatus: "known",
    });
    expect(usage.groups.find((group) => group.workflow === "legacy-chat")).toMatchObject({
      attemptCount: 0, providerRequestCount: 1, providerRequestCountStatus: "known",
    });
    expect(usage.authority.excludes).toContain("candidate mirrors");
  });

  it("marks provider request counts partial or unknown when durable repair evidence is absent", () => {
    const database = openDatabase(); databases.push(database);
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const project = projects.create("Legacy usage", undefined, "long-form");
    artifacts.saveArtifact({
      projectId: project.id, artifactId: "legacy-review", artifactType: "narrative-review",
      content: { plan: { providerId: "offline", modelId: "legacy" }, job: { units: [{ attempts: [
        { status: "completed", usage: { inputTokens: 3, outputTokens: 2 }, startedAt: "2026-01-01", finishedAt: "2026-01-01" },
      ] }] } },
    });
    const jobs = new JobRepository(database);
    const exact = jobs.create(project.id, "known-legacy-call");
    jobs.recordUsage(exact.id, { promptTokens: 1, completionTokens: 1, cost: 0 });
    const unknown = new ProjectHealthService(database, projects).usage(project.id);
    expect(unknown.totals).toMatchObject({
      attemptCount: 1,
      providerRequestCount: 1,
      providerRequestCountStatus: "partial",
      unknownProviderRequestAttemptCount: 1,
      inputTokens: 4,
      outputTokens: 3,
    });
    expect(unknown.groups.find((group) => group.workflow === "narrative-review")).toMatchObject({
      providerRequestCount: null, providerRequestCountStatus: "unknown",
    });
  });

  it("labels passage-plan validation as current, historical, unevaluated, or invalid", () => {
    const database = openDatabase(); databases.push(database);
    const projects = new ProjectRepository(database);
    const project = projects.create("Planning health", undefined, "long-form");
    const plans = new PassagePlanRepository(database);
    plans.initialize(project.id, { schemaVersion: 1, acts: [], sequences: [] }, [
      { kind: "passage", id: "passage-1", content: { id: "passage-1", purpose: "Original" } },
    ]);
    const snapshot = plans.createSnapshot(project.id, {}, {
      findings: [{ severity: "error" }, { severity: "warning" }, { severity: "warning" }],
    });
    plans.approveSnapshot(project.id, snapshot.id);
    const service = new ProjectHealthService(database, projects);
    expect(service.get(project.id).validation).toMatchObject({
      freshness: "current", blockers: 1, warnings: 2,
    });

    plans.saveEntity(project.id, "passage", "passage-1", { id: "passage-1", purpose: "Changed" });
    expect(service.get(project.id).validation).toMatchObject({
      passagePlanStatus: "draft", freshness: "historical-approved", blockers: 1, warnings: 2,
    });

    database.prepare("UPDATE passage_plan_snapshots SET validation_json = ? WHERE id = ?")
      .run("{malformed", snapshot.id);
    expect(service.get(project.id).validation).toMatchObject({
      freshness: "invalid", blockers: null, warnings: null,
    });

    const untouched = projects.create("Not planned", undefined, "long-form");
    expect(service.get(untouched.id).validation).toMatchObject({
      freshness: "not-evaluated", blockers: null, warnings: null,
    });
  });

  it("returns structural diagnostics without loading immutable artifact bodies", () => {
    const database = openDatabase(); databases.push(database);
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const project = projects.create("Health fixture", undefined, "long-form");
    const heavyMarker = "secret-prose-marker-".repeat(60_000);
    artifacts.saveArtifact({
      projectId: project.id, artifactId: "simulation-runs",
      content: { status: "completed", fingerprint: "simulation-fingerprint", traces: [{ body: heavyMarker }] },
    });
    artifacts.saveArtifact({
      projectId: project.id, artifactId: "playtest-campaigns",
      content: { status: "completed", fingerprint: "playtest-fingerprint", findings: [{ body: heavyMarker }] },
    });
    artifacts.saveArtifact({
      projectId: project.id, artifactId: "narrative", artifactType: "narrative-review",
      content: { fingerprint: "narrative-fingerprint", job: { status: "completed" }, proseMarkdown: heavyMarker },
    });

    const health = new ProjectHealthService(database, projects).get(project.id);

    const encoded = JSON.stringify(health);
    expect(encoded).not.toContain("secret-prose-marker");
    expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(PROJECT_HEALTH_BUDGETS.maximumHealthResponseBytes);
    expect(health.evidence.latest).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "simulation", status: "completed", fingerprint: "simulation-fingerprint" }),
      expect.objectContaining({ kind: "playtest", status: "completed", fingerprint: "playtest-fingerprint" }),
      expect.objectContaining({ kind: "narrative-review", status: "completed", fingerprint: "narrative-fingerprint" }),
    ]));
    expect(health.storage.policy).toBe("diagnostic-only-no-automatic-cleanup");
    expect(health.publication.currentReadiness).toBe("not-evaluated");
    expect(health.recovery.currentFreshness).toBe("not-evaluated");
  });
});
