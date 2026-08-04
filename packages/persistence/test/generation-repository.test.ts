import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertGenerationJobTransition,
  GenerationRepository,
  openDatabase,
  PassagePlanRepository,
  ProjectRepository,
} from "../src/index.js";

const temporaryDirectories: string[] = [];
afterEach(() => temporaryDirectories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function setup(path = ":memory:") {
  const database = openDatabase(path);
  const projects = new ProjectRepository(database);
  const passages = new PassagePlanRepository(database);
  const project = projects.create("Kernel", undefined, "long-form");
  passages.initialize(project.id, { schemaVersion: 1, acts: [], sequences: [] }, [
    { kind: "passage", id: "passage-a", content: { id: "passage-a" } },
    { kind: "passage", id: "passage-b", content: { id: "passage-b" } },
  ]);
  const snapshot = passages.createSnapshot(project.id, { brief: "brief-v1", mechanics: "mechanics-v1" }, { findings: [] });
  passages.approveSnapshot(project.id, snapshot.id);
  return { database, projects, passages, project, snapshot, generations: new GenerationRepository(database) };
}

const planInput = (projectId: string, snapshotId: string) => ({
  projectId,
  fingerprint: "plan-fingerprint",
  snapshotId,
  structureVersionId: "structure-v1",
  upstreamVersions: { brief: "brief-v1", mechanics: "mechanics-v1" },
  scope: { kind: "sequence", sequenceId: "sequence-a" },
  providerId: "offline-kernel",
  modelId: "fixture-v1",
  estimatedInputTokens: 20,
  estimatedOutputTokens: 40,
  costEstimate: { status: "unavailable" },
  validationStages: ["schema"],
  executionPolicyId: "policy-v1",
  executionPolicy: { maxAttemptsPerUnit: 3 },
  units: [
    { id: "unit-a", position: 0, sequenceId: "sequence-a", passageIds: ["passage-a"], passageVersionIds: ["pa-v1"], inputFingerprint: "input-a", estimatedInputTokens: 10, estimatedOutputTokens: 20 },
    { id: "unit-b", position: 1, sequenceId: "sequence-a", passageIds: ["passage-b"], passageVersionIds: ["pb-v1"], inputFingerprint: "input-b", estimatedInputTokens: 10, estimatedOutputTokens: 20 },
  ],
});
describe("GenerationRepository", () => {
  it("enforces authorization fingerprints, transitions, partial failure, and independent retry", () => {
    const fixture = setup();
    const beforeVersions = fixture.passages.listAllEntityVersions(fixture.project.id);
    const beforeSnapshots = fixture.passages.listSnapshots(fixture.project.id);
    const plan = fixture.generations.createPlan(planInput(fixture.project.id, fixture.snapshot.id));
    expect(plan).toMatchObject({ authorizationState: "planned", jobStatus: "planned" });
    expect(() => fixture.generations.authorize(fixture.project.id, plan.id, "wrong")).toThrow("fingerprint");
    fixture.generations.authorize(fixture.project.id, plan.id, plan.fingerprint);
    fixture.generations.startJob(fixture.project.id, plan.jobId);
    const first = fixture.generations.startUnit(fixture.project.id, plan.jobId, "unit-a");
    fixture.generations.completeUnit(fixture.project.id, plan.jobId, "unit-a", first.attemptId, {
      usage: { inputTokens: 1, outputTokens: 1, cost: 0 },
    });
    const second = fixture.generations.startUnit(fixture.project.id, plan.jobId, "unit-b");
    fixture.generations.failUnit(fixture.project.id, plan.jobId, "unit-b", second.attemptId, {
      code: "fixture", message: "Failed", retryable: true,
    });
    expect(fixture.generations.finalizeJob(fixture.project.id, plan.jobId).status).toBe("partially_failed");
    expect(() => fixture.generations.startJob(fixture.project.id, plan.jobId)).toThrow("transition");
    fixture.generations.retryUnit(fixture.project.id, plan.jobId, "unit-b");
    fixture.generations.startJob(fixture.project.id, plan.jobId);
    const retry = fixture.generations.startUnit(fixture.project.id, plan.jobId, "unit-b");
    fixture.generations.completeUnit(fixture.project.id, plan.jobId, "unit-b", retry.attemptId, {});
    const completed = fixture.generations.finalizeJob(fixture.project.id, plan.jobId);
    expect(completed.status).toBe("completed");
    expect(completed.units.find((item) => item.id === "unit-a")).toMatchObject({ status: "completed", attemptNumber: 1 });
    expect(completed.units.find((item) => item.id === "unit-b")).toMatchObject({ status: "completed", attemptNumber: 2 });
    expect(fixture.generations.attemptCount(fixture.project.id, plan.jobId, "unit-a")).toBe(1);
    expect(fixture.passages.listAllEntityVersions(fixture.project.id)).toEqual(beforeVersions);
    expect(fixture.passages.listSnapshots(fixture.project.id)).toEqual(beforeSnapshots);
    expect(() => assertGenerationJobTransition("completed", "running")).toThrow("Invalid");
    fixture.database.close();
  });

  it("cancels pending work while preserving completed units", () => {
    const fixture = setup();
    const plan = fixture.generations.createPlan(planInput(fixture.project.id, fixture.snapshot.id));
    fixture.generations.authorize(fixture.project.id, plan.id, plan.fingerprint);
    fixture.generations.startJob(fixture.project.id, plan.jobId);
    const first = fixture.generations.startUnit(fixture.project.id, plan.jobId, "unit-a");
    fixture.generations.completeUnit(fixture.project.id, plan.jobId, "unit-a", first.attemptId, {});
    const cancelled = fixture.generations.cancelJob(fixture.project.id, plan.jobId);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.units.map((item) => item.status)).toEqual(["completed", "cancelled"]);
    fixture.database.close();
  });

  it("normalizes interrupted running units after restart without repeating completed work", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-generation-recovery-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "fixture.sqlite");
    const first = setup(path);
    const plan = first.generations.createPlan(planInput(first.project.id, first.snapshot.id));
    first.generations.authorize(first.project.id, plan.id, plan.fingerprint);
    first.generations.startJob(first.project.id, plan.jobId);
    const completedAttempt = first.generations.startUnit(first.project.id, plan.jobId, "unit-a");
    first.generations.completeUnit(first.project.id, plan.jobId, "unit-a", completedAttempt.attemptId, {});
    first.generations.startUnit(first.project.id, plan.jobId, "unit-b");
    first.database.close();

    const database = openDatabase(path);
    const generations = new GenerationRepository(database);
    expect(generations.recoverInterrupted()).toBe(1);
    const recovered = generations.getJob(first.project.id, plan.jobId)!;
    expect(recovered.status).toBe("partially_failed");
    expect(recovered.units[0]).toMatchObject({ status: "completed", attemptNumber: 1 });
    expect(recovered.units[1]).toMatchObject({
      status: "failed", attemptNumber: 1,
      normalizedError: { code: "process_interrupted", retryable: true },
    });
    database.close();
  });

  it("rolls back multi-record creation and rejects cross-project ownership", () => {
    const fixture = setup();
    const invalid = planInput(fixture.project.id, fixture.snapshot.id);
    invalid.units[1]!.position = 0;
    expect(() => fixture.generations.createPlan(invalid)).toThrow();
    expect(fixture.generations.listPlans(fixture.project.id)).toEqual([]);
    const plan = fixture.generations.createPlan(planInput(fixture.project.id, fixture.snapshot.id));
    const other = fixture.projects.create("Other", undefined, "long-form");
    expect(fixture.generations.getPlan(other.id, plan.id)).toBeUndefined();
    expect(() => fixture.generations.authorize(other.id, plan.id, plan.fingerprint)).toThrow("not found");
    fixture.database.close();
  });
});
