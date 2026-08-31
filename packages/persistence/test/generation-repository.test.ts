import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertGenerationJobTransition,
  GenerationRepository,
  openDatabase,
  PassagePlanRepository,
  ProjectHealthRepository,
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

const planInput = (
  projectId: string,
  snapshotId: string,
  structureVersionId: string,
  upstreamVersions = { brief: "brief-v1", mechanics: "mechanics-v1" },
) => ({
  projectId,
  fingerprint: "plan-fingerprint",
  snapshotId,
  structureVersionId,
  upstreamVersions,
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
    const plan = fixture.generations.createPlan(planInput(
      fixture.project.id, fixture.snapshot.id, fixture.snapshot.structureVersionId,
    ));
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
    const plan = fixture.generations.createPlan(planInput(
      fixture.project.id, fixture.snapshot.id, fixture.snapshot.structureVersionId,
    ));
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
    const plan = first.generations.createPlan(planInput(
      first.project.id, first.snapshot.id, first.snapshot.structureVersionId,
    ));
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
    const invalid = planInput(fixture.project.id, fixture.snapshot.id, fixture.snapshot.structureVersionId);
    invalid.units[1]!.position = 0;
    expect(() => fixture.generations.createPlan(invalid)).toThrow();
    expect(fixture.generations.listPlans(fixture.project.id)).toEqual([]);
    const plan = fixture.generations.createPlan(planInput(
      fixture.project.id, fixture.snapshot.id, fixture.snapshot.structureVersionId,
    ));
    const other = fixture.projects.create("Other", undefined, "long-form");
    expect(fixture.generations.getPlan(other.id, plan.id)).toBeUndefined();
    expect(() => fixture.generations.authorize(other.id, plan.id, plan.fingerprint)).toThrow("not found");
    fixture.database.close();
  });

  it("rejects snapshot dependency mismatches before persisting any generation rows", () => {
    const fixture = setup();
    const counts = () => ["generation_plans", "generation_jobs", "generation_plan_units", "generation_job_units"]
      .map((table) => (fixture.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);

    expect(() => fixture.generations.createPlan(planInput(
      fixture.project.id, fixture.snapshot.id, "wrong-structure-version",
    ))).toThrow("structure version");
    expect(counts()).toEqual([0, 0, 0, 0]);

    expect(() => fixture.generations.createPlan(planInput(
      fixture.project.id,
      fixture.snapshot.id,
      fixture.snapshot.structureVersionId,
      { brief: "brief-v1", mechanics: "wrong-mechanics-version" },
    ))).toThrow("upstream versions");
    expect(counts()).toEqual([0, 0, 0, 0]);

    const valid = fixture.generations.createPlan(planInput(
      fixture.project.id,
      fixture.snapshot.id,
      fixture.snapshot.structureVersionId,
      { mechanics: "mechanics-v1", brief: "brief-v1" },
    ));
    expect(valid).toMatchObject({
      structureVersionId: fixture.snapshot.structureVersionId,
      upstreamVersions: { brief: "brief-v1", mechanics: "mechanics-v1" },
    });
    expect(counts()).toEqual([1, 1, 2, 2]);
    fixture.database.close();
  });

  it("rejects direct SQL that attaches a job to a unit from another plan", () => {
    const fixture = setup();
    const first = fixture.generations.createPlan(planInput(
      fixture.project.id, fixture.snapshot.id, fixture.snapshot.structureVersionId,
    ));
    const secondInput = planInput(
      fixture.project.id, fixture.snapshot.id, fixture.snapshot.structureVersionId,
    );
    secondInput.fingerprint = "second-plan-fingerprint";
    secondInput.units = [{
      id: "unit-c", position: 0, sequenceId: "sequence-b", passageIds: ["passage-b"],
      passageVersionIds: ["pb-v1"], inputFingerprint: "input-c",
      estimatedInputTokens: 10, estimatedOutputTokens: 20,
    }];
    const second = fixture.generations.createPlan(secondInput);

    expect(() => fixture.database.prepare(`
      INSERT INTO generation_job_units (
        job_id, project_id, plan_id, unit_id, status, input_fingerprint,
        execution_policy_id, created_at, updated_at
      ) VALUES (?, ?, ?, 'unit-c', 'pending', 'cross-plan-input', 'policy-v1', ?, ?)
    `).run(first.jobId, fixture.project.id, second.id, "2026-08-05T00:00:00.000Z", "2026-08-05T00:00:00.000Z"))
      .toThrow("Generation job unit lineage mismatch");
    expect(fixture.generations.getJob(fixture.project.id, first.jobId)?.planId).toBe(first.id);
    fixture.database.close();
  });

  it("rejects direct SQL that reassigns a job away from its attached units", () => {
    const fixture = setup();
    const first = fixture.generations.createPlan(planInput(
      fixture.project.id, fixture.snapshot.id, fixture.snapshot.structureVersionId,
    ));
    const secondInput = planInput(
      fixture.project.id, fixture.snapshot.id, fixture.snapshot.structureVersionId,
    );
    secondInput.fingerprint = "second-parent-plan-fingerprint";
    secondInput.units = [{
      id: "unit-c", position: 0, sequenceId: "sequence-b", passageIds: ["passage-b"],
      passageVersionIds: ["pb-v1"], inputFingerprint: "parent-input-c",
      estimatedInputTokens: 10, estimatedOutputTokens: 20,
    }];
    const second = fixture.generations.createPlan(secondInput);
    fixture.database.prepare("DELETE FROM generation_jobs WHERE project_id = ? AND id = ?")
      .run(fixture.project.id, second.jobId);

    expect(() => fixture.database.prepare(`
      UPDATE generation_jobs SET plan_id = ? WHERE project_id = ? AND id = ?
    `).run(second.id, fixture.project.id, first.jobId))
      .toThrow("Generation job lineage update would orphan attached units");
    expect(fixture.database.prepare(`
      SELECT project_id, id, plan_id FROM generation_jobs WHERE id = ?
    `).get(first.jobId)).toEqual({
      project_id: fixture.project.id,
      id: first.jobId,
      plan_id: first.id,
    });
    expect(fixture.database.prepare(`
      SELECT DISTINCT project_id, job_id, plan_id FROM generation_job_units WHERE job_id = ?
    `).all(first.jobId)).toEqual([{
      project_id: fixture.project.id,
      job_id: first.jobId,
      plan_id: first.id,
    }]);
    fixture.database.close();
  });

  it("rejects direct SQL candidate lineage assembled from two plans sharing a unit ID", () => {
    const fixture = setup();
    const planA = fixture.generations.createPlan(planInput(
      fixture.project.id, fixture.snapshot.id, fixture.snapshot.structureVersionId,
    ));
    const planBInput = planInput(
      fixture.project.id, fixture.snapshot.id, fixture.snapshot.structureVersionId,
    );
    planBInput.fingerprint = "candidate-plan-b-fingerprint";
    const planB = fixture.generations.createPlan(planBInput);
    fixture.generations.authorize(fixture.project.id, planB.id, planB.fingerprint);
    fixture.generations.startJob(fixture.project.id, planB.jobId);
    const attemptB = fixture.generations.startUnit(fixture.project.id, planB.jobId, "unit-a");

    expect(() => fixture.database.prepare(`INSERT INTO generation_unit_candidates (
      id, project_id, plan_id, job_id, unit_id, attempt_id, input_fingerprint,
      context_fingerprint, provider_id, model_id, execution_policy_id,
      output_schema_id, output_schema_version, content_json, validation_json,
      usage_json, repair_json, created_at
    ) VALUES ('cross-plan-candidate', ?, ?, ?, 'unit-a', ?, 'input-a', 'context-a',
      'offline-kernel', 'fixture-v1', 'policy-v1', 'schema', 1, '{}', '{}', NULL, '{}', ?)`)
      .run(fixture.project.id, planA.id, planB.jobId, attemptB.attemptId, "2026-08-10T00:00:00.000Z"))
      .toThrow("Generation unit candidate lineage mismatch");
    expect((fixture.database.prepare(`
      SELECT COUNT(*) AS count FROM generation_unit_candidates WHERE id = 'cross-plan-candidate'
    `).get() as { count: number }).count).toBe(0);
    expect(fixture.generations.getJob(fixture.project.id, planB.jobId)?.units[0]).toMatchObject({
      id: "unit-a", status: "running", candidateReference: null,
    });
    fixture.database.close();
  });

  it("persists immutable candidates atomically with exact provenance and rejects cross-project ownership", () => {
    const fixture = setup();
    const input = planInput(fixture.project.id, fixture.snapshot.id, fixture.snapshot.structureVersionId);
    input.units = input.units.map((unit) => ({
      ...unit,
      contextFingerprint: `context-${unit.id}`,
      context: { unitId: unit.id },
      contextDiagnostics: { contextFingerprint: `context-${unit.id}` },
    }));
    const plan = fixture.generations.createPlan(input);
    fixture.generations.authorize(fixture.project.id, plan.id, plan.fingerprint);
    fixture.generations.startJob(fixture.project.id, plan.jobId);
    const first = fixture.generations.startUnit(fixture.project.id, plan.jobId, "unit-a");
    const completed = fixture.generations.completeUnitWithCandidate(
      fixture.project.id, plan.jobId, "unit-a", first.attemptId,
      {
        id: "candidate-fixed",
        contextFingerprint: "context-unit-a",
        providerId: plan.providerId,
        modelId: plan.modelId,
        outputSchemaId: "cyoa.passage-planning-unit-candidate",
        outputSchemaVersion: 1,
        content: { exact: true },
        validation: { valid: true },
        usage: { inputTokens: 10, outputTokens: 20, cost: 0 },
        repair: { repairsPerformed: 1, maximumRepairs: 1 },
      },
    );
    expect(completed.units[0]).toMatchObject({ status: "completed", candidateReference: "candidate-fixed" });
    expect(fixture.generations.getCandidate(fixture.project.id, "candidate-fixed")).toMatchObject({
      projectId: fixture.project.id,
      planId: plan.id,
      jobId: plan.jobId,
      unitId: "unit-a",
      attemptId: first.attemptId,
      inputFingerprint: "input-a",
      contextFingerprint: "context-unit-a",
      providerId: "offline-kernel",
      modelId: "fixture-v1",
      executionPolicyId: "policy-v1",
      outputSchemaVersion: 1,
      content: { exact: true },
    });
    expect(new ProjectHealthRepository(fixture.database).usage(fixture.project.id)
      .find((row) => row.workflow === "passage-planning")).toMatchObject({
      attemptCount: 1,
      knownProviderRequestCount: 2,
      unknownProviderRequestAttemptCount: 0,
      inputTokens: 10,
      outputTokens: 20,
    });
    expect(() => fixture.database.prepare("UPDATE generation_unit_candidates SET model_id = 'changed' WHERE id = 'candidate-fixed'").run())
      .toThrow("immutable");
    expect(() => fixture.database.prepare("DELETE FROM generation_unit_candidates WHERE id = 'candidate-fixed'").run())
      .toThrow("append-only");

    const second = fixture.generations.startUnit(fixture.project.id, plan.jobId, "unit-b");
    expect(() => fixture.generations.completeUnitWithCandidate(
      fixture.project.id, plan.jobId, "unit-b", second.attemptId,
      {
        id: "candidate-fixed",
        contextFingerprint: "context-unit-b",
        providerId: plan.providerId,
        modelId: plan.modelId,
        outputSchemaId: "cyoa.passage-planning-unit-candidate",
        outputSchemaVersion: 1,
        content: { duplicate: true },
        validation: { valid: true },
        repair: { repairsPerformed: 0, maximumRepairs: 1 },
      },
    )).toThrow();
    expect(fixture.generations.getJob(fixture.project.id, plan.jobId)?.units[1]).toMatchObject({
      status: "running", candidateReference: null,
    });
    expect(fixture.generations.listCandidates(fixture.project.id, plan.jobId)).toHaveLength(1);

    const other = fixture.projects.create("Other candidate owner", undefined, "long-form");
    expect(() => fixture.database.prepare(`INSERT INTO generation_unit_candidates (
      id, project_id, plan_id, job_id, unit_id, attempt_id, input_fingerprint,
      context_fingerprint, provider_id, model_id, execution_policy_id,
      output_schema_id, output_schema_version, content_json, validation_json,
      usage_json, repair_json, created_at
    ) VALUES ('cross-project', ?, ?, ?, 'unit-a', ?, 'input-a', 'context-unit-a',
      'offline-kernel', 'fixture-v1', 'policy-v1', 'schema', 1, '{}', '{}', NULL, '{}', ?)`)
      .run(other.id, plan.id, plan.jobId, first.attemptId, "2026-08-09T00:00:00.000Z"))
      .toThrow();
    expect(() => fixture.database.prepare("DELETE FROM projects WHERE id = ?").run(fixture.project.id)).not.toThrow();
    expect((fixture.database.prepare("SELECT COUNT(*) AS count FROM generation_unit_candidates").get() as { count: number }).count).toBe(0);
    fixture.database.close();
  });
});
