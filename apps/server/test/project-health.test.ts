import { afterEach, describe, expect, it } from "vitest";
import {
  ArtifactRepository,
  JobRepository,
  openDatabase,
  PassagePlanRepository,
  ProjectRepository,
  PROJECT_HEALTH_BUDGETS,
  type StoryDatabase,
  ChangeSetRepository,
  ConversationRepository,
  DraftingRepository,
  GenerationRepository,
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

  it("filters recorded usage without changing truth semantics and builds a bounded provider-free resume view", () => {
    const database = openDatabase(); databases.push(database);
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const project = projects.create("Resume fixture", undefined, "long-form");
    const brief = artifacts.saveArtifact({ projectId: project.id, artifactId: "brief", artifactType: "brief",
      content: { title: "Resume" } });
    artifacts.saveArtifact({ projectId: project.id, artifactId: "review", artifactType: "narrative-review",
      content: { plan: { providerId: "offline", modelId: "model-a" }, job: { units: [{ attempts: [
        { status: "completed", repair: { performed: 0 }, usage: { inputTokens: 8, outputTokens: 4, cost: 0 },
          startedAt: "2026-03-01T00:00:00.000Z", finishedAt: "2026-03-01T00:01:00.000Z" },
      ] }] } } });
    artifacts.saveArtifact({ projectId: project.id, artifactId: "repair", artifactType: "repair-proposal-generation",
      content: { generation: { providerId: "offline", modelId: "model-b" }, job: { units: [{ attempts: [
        { status: "completed", repair: { performed: 1 }, usage: { inputTokens: 3, outputTokens: 2 },
          startedAt: "2026-04-01T00:00:00.000Z", finishedAt: "2026-04-01T00:01:00.000Z" },
      ] }] } } });
    const conversation = new ConversationRepository(database).create(project.id,
      { kind: "artifact", projectId: project.id, stage: "brief", artifactId: "brief", versionId: brief.id });
    new ChangeSetRepository(database).create({ projectId: project.id, conversationId: conversation.id,
      artifactId: "brief", baseVersionId: brief.id, summary: "Pending", rationale: "Pending review", candidate: { title: "Changed" } });
    const service = new ProjectHealthService(database, projects);
    const filtered = service.usage(project.id, { workflow: "narrative-review", providerId: "offline", modelId: "model-a",
      from: "2026-02-01", to: "2026-03-31" });
    expect(filtered.groups).toHaveLength(1);
    expect(filtered.totals).toMatchObject({ attemptCount: 1, providerRequestCount: 1, inputTokens: 8, outputTokens: 4,
      cost: { status: "recorded", recorded: 0 } });
    expect(filtered.available).toEqual({ workflows: ["narrative-review", "repair-proposal"], providers: ["offline"],
      models: ["model-a", "model-b"] });
    expect(() => service.usage(project.id, { from: "2026-05-01", to: "2026-01-01" })).toThrow("must not be after");
    const resume = service.resume(project.id);
    expect(resume).toMatchObject({ authority: "persisted-facts-only", truncated: false,
      facts: { proposedChangeSets: 1 }, backup: { latestVerifiedAt: null, freshness: "not-evaluated" } });
    expect(resume.actions.map((item) => item.id)).toEqual(["proposals", "backup"]);
  });

  it("classifies every real generation and drafting attention state with exact latest job navigation", () => {
    const database = openDatabase(); databases.push(database);
    const projects = new ProjectRepository(database);
    const artifacts = new ArtifactRepository(database);
    const passagePlans = new PassagePlanRepository(database);
    const project = projects.create("Resume job lifecycle", undefined, "long-form");
    const brief = artifacts.saveArtifact({
      projectId: project.id, artifactId: "brief", artifactType: "brief", content: { title: "Resume jobs" },
    });
    passagePlans.initialize(project.id, {
      schemaVersion: 1, title: "Plan", projectWordTarget: 1_000, typicalPathWordTarget: 1_000,
      startPassageId: "passage-1", acts: [], sequences: [], characterAvailability: [],
    }, [{
      kind: "passage", id: "passage-1",
      content: { id: "passage-1", purpose: "Resume target", wordTarget: 500 },
    }]);
    const snapshot = passagePlans.createSnapshot(project.id, { brief: brief.id }, { findings: [] });
    passagePlans.approveSnapshot(project.id, snapshot.id);
    const passageVersion = passagePlans.currentEntity(project.id, "passage", "passage-1")!;
    const generations = new GenerationRepository(database);
    const drafting = new DraftingRepository(database);
    const statuses = ["planned", "authorized", "running", "partially_failed", "failed", "completed", "cancelled"] as const;
    const generationJobs = new Map<string, string>();
    const draftingJobs = new Map<string, string>();

    statuses.forEach((status, index) => {
      const generation = generations.createPlan({
        projectId: project.id, fingerprint: `generation-${status}`, snapshotId: snapshot.id,
        structureVersionId: snapshot.structureVersionId, upstreamVersions: snapshot.upstreamVersions,
        scope: { kind: "sequence", sequenceId: `sequence-${index}` }, providerId: "offline-resume",
        modelId: "fixture-v1", estimatedInputTokens: 10, estimatedOutputTokens: 20,
        costEstimate: { status: "unavailable" }, validationStages: ["schema"],
        executionPolicyId: "policy-v1", executionPolicy: { maxAttemptsPerUnit: 3 },
        units: [{ id: "unit-1", position: 0, sequenceId: `sequence-${index}`,
          passageIds: ["passage-1"], passageVersionIds: [passageVersion.id],
          inputFingerprint: `generation-input-${status}`, estimatedInputTokens: 10, estimatedOutputTokens: 20 }],
      });
      const draft = drafting.createPlan({
        projectId: project.id, fingerprint: `drafting-${status}`, snapshotId: snapshot.id,
        structureVersionId: snapshot.structureVersionId, upstreamVersions: snapshot.upstreamVersions,
        scope: { kind: "passages", passageIds: ["passage-1"] }, providerId: "offline-resume",
        modelId: "fixture-v1", estimatedInputTokens: 10, estimatedOutputTokens: 20,
        costEstimate: { status: "unavailable" }, executionPolicyId: "draft-policy-v1",
        executionPolicy: { id: "draft-policy-v1", maxPassagesPerUnit: 8, maxUnitsPerPlan: 100,
          maxEstimatedInputTokensPerUnit: 48_000, maxOutputTokensPerPassage: 2_500,
          maxOutputTokensPerUnit: 12_000, maxAttemptsPerUnit: 3, maxSerializedCandidateBytes: 96_000 },
        units: [{ id: "unit-1", position: 0, passageIds: ["passage-1"],
          passageVersionIds: [passageVersion.id], inputFingerprint: `draft-input-${status}`,
          estimatedInputTokens: 10, estimatedOutputTokens: 20,
          contextDiagnostics: { status: "not-built", passageIds: ["passage-1"] } }],
      });
      const updatedAt = `2026-09-01T00:00:${String(index).padStart(2, "0")}.000Z`;
      database.prepare("UPDATE generation_jobs SET status = ?, updated_at = ? WHERE id = ?")
        .run(status, updatedAt, generation.jobId);
      database.prepare("UPDATE drafting_jobs SET status = ?, updated_at = ? WHERE id = ?")
        .run(status, updatedAt, draft.jobId);
      generationJobs.set(status, generation.jobId);
      draftingJobs.set(status, draft.jobId);
    });

    const resume = new ProjectHealthService(database, projects).resume(project.id);
    const attention = statuses.slice(0, 5);
    for (const status of attention) {
      expect(resume.facts.generationJobs[status]).toEqual({
        count: 1, latestJobId: generationJobs.get(status), latestPassageId: "passage-1",
      });
      expect(resume.facts.draftingJobs[status]).toEqual({
        count: 1, latestJobId: draftingJobs.get(status), latestPassageId: "passage-1",
      });
      expect(resume.actions).toContainEqual(expect.objectContaining({
        id: `generation-${status}`, jobKind: "generation", jobId: generationJobs.get(status),
        jobStatus: status, stableId: "passage-1",
      }));
      expect(resume.actions).toContainEqual(expect.objectContaining({
        id: `drafting-${status}`, jobKind: "drafting", jobId: draftingJobs.get(status),
        jobStatus: status, stableId: "passage-1",
      }));
    }
    expect(JSON.stringify(resume)).not.toMatch(/queued|cancelling/);
    expect(resume.actions.some((action) => action.jobStatus === "completed" || action.jobStatus === "cancelled")).toBe(false);
  });
});
