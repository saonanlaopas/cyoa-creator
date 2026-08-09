import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ArtifactRepository,
  DraftingRepository,
  openDatabase,
  PassageDraftRepository,
  PassagePlanRepository,
  ProjectRepository,
} from "../src/index.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function setup(path = ":memory:", unitCount = 1) {
  const database = openDatabase(path);
  const projects = new ProjectRepository(database);
  const artifacts = new ArtifactRepository(database);
  const passagePlans = new PassagePlanRepository(database);
  const drafting = new DraftingRepository(database);
  const project = projects.create("Drafting plan fixture", undefined, "long-form");
  const brief = artifacts.saveArtifact({ projectId: project.id, artifactId: "brief", content: { title: "Fixture" } });
  const passageInputs = Array.from({ length: unitCount }, (_, index) => ({
    kind: "passage" as const,
    id: `passage-${index + 1}`,
    content: { id: `passage-${index + 1}`, purpose: `Purpose ${index + 1}`, wordTarget: 500 },
  }));
  passagePlans.initialize(project.id, {
    schemaVersion: 1, title: "Plan", projectWordTarget: 1000, typicalPathWordTarget: 1000,
    startPassageId: "passage-1", acts: [], sequences: [], characterAvailability: [],
  }, passageInputs);
  const snapshot = passagePlans.createSnapshot(project.id, { brief: brief.id }, { findings: [] });
  passagePlans.approveSnapshot(project.id, snapshot.id);
  const passageVersions = passageInputs.map((item) => passagePlans.currentEntity(project.id, "passage", item.id)!);
  const input = {
    projectId: project.id,
    fingerprint: "drafting-plan-fingerprint",
    snapshotId: snapshot.id,
    structureVersionId: snapshot.structureVersionId,
    upstreamVersions: snapshot.upstreamVersions,
    scope: { kind: "passages", passageIds: passageInputs.map((item) => item.id) },
    providerId: "offline-drafting-lifecycle",
    modelId: "no-prose-v1",
    estimatedInputTokens: unitCount * 100,
    estimatedOutputTokens: unitCount * 500,
    costEstimate: { status: "unavailable" },
    executionPolicyId: "passage-drafting-v1",
    executionPolicy: {
      id: "passage-drafting-v1", maxPassagesPerUnit: 8, maxUnitsPerPlan: 100,
      maxEstimatedInputTokensPerUnit: 48_000, maxOutputTokensPerPassage: 2_500,
      maxOutputTokensPerUnit: 12_000, maxAttemptsPerUnit: 3, maxSerializedCandidateBytes: 96_000,
    },
    units: passageVersions.map((version, position) => ({
      id: `unit-${position + 1}`,
      position,
      passageIds: [version.entityId],
      passageVersionIds: [version.id],
      inputFingerprint: `input-${position + 1}`,
      estimatedInputTokens: 100,
      estimatedOutputTokens: 500,
      contextDiagnostics: { status: "not-built", passageIds: [version.entityId] },
    })),
  };
  return { database, projects, passagePlans, drafting, project, snapshot, passageVersions, input };
}

describe("drafting repository", () => {
  it("persists exact approved snapshot inputs and deterministic unit definitions", () => {
    const fixture = setup(":memory:", 2);
    const plan = fixture.drafting.createPlan(fixture.input);
    expect(plan).toMatchObject({
      fingerprint: fixture.input.fingerprint,
      snapshotId: fixture.snapshot.id,
      structureVersionId: fixture.snapshot.structureVersionId,
      upstreamVersions: fixture.snapshot.upstreamVersions,
      authorizationState: "planned",
      jobStatus: "planned",
    });
    expect(plan.units.map((unit) => ({ ids: unit.passageIds, versions: unit.passageVersionIds }))).toEqual([
      { ids: ["passage-1"], versions: [fixture.passageVersions[0]!.id] },
      { ids: ["passage-2"], versions: [fixture.passageVersions[1]!.id] },
    ]);
    expect(plan.units.every((unit) => (unit.contextDiagnostics as { status: string }).status === "not-built")).toBe(true);
    fixture.database.close();
  });

  it("rejects mismatched snapshot dependencies and unit passage lineage transactionally", () => {
    const fixture = setup();
    expect(() => fixture.drafting.createPlan({ ...fixture.input, structureVersionId: "wrong" }))
      .toThrow("structure version");
    expect(() => fixture.drafting.createPlan({ ...fixture.input, upstreamVersions: { brief: "wrong" } }))
      .toThrow("upstream versions");
    expect(() => fixture.drafting.createPlan({
      ...fixture.input,
      units: [{ ...fixture.input.units[0]!, passageIds: ["other-passage"] }],
    })).toThrow("snapshot lineage");
    expect((fixture.database.prepare("SELECT COUNT(*) AS count FROM drafting_plans").get() as { count: number }).count).toBe(0);
    expect((fixture.database.prepare("SELECT COUNT(*) AS count FROM drafting_jobs").get() as { count: number }).count).toBe(0);
    expect((fixture.database.prepare("SELECT COUNT(*) AS count FROM drafting_plan_units").get() as { count: number }).count).toBe(0);
    fixture.database.close();
  });

  it("binds authorization to the exact fingerprint and enforces retry attempt limits", () => {
    const fixture = setup();
    const plan = fixture.drafting.createPlan(fixture.input);
    expect(() => fixture.drafting.authorize(fixture.project.id, plan.id, "wrong"))
      .toThrow("fingerprint does not match");
    expect(fixture.drafting.authorize(fixture.project.id, plan.id, plan.fingerprint).jobStatus).toBe("authorized");
    expect(fixture.drafting.startJob(fixture.project.id, plan.jobId).status).toBe("running");
    const first = fixture.drafting.startUnit(fixture.project.id, plan.jobId, "unit-1");
    fixture.drafting.failUnit(fixture.project.id, plan.jobId, "unit-1", first.attemptId, { code: "fixture", retryable: true });
    expect(fixture.drafting.finalizeJob(fixture.project.id, plan.jobId).status).toBe("failed");
    fixture.drafting.retryUnit(fixture.project.id, plan.jobId, "unit-1");
    fixture.drafting.startJob(fixture.project.id, plan.jobId);
    const second = fixture.drafting.startUnit(fixture.project.id, plan.jobId, "unit-1");
    fixture.drafting.failUnit(fixture.project.id, plan.jobId, "unit-1", second.attemptId, { code: "fixture", retryable: true });
    fixture.drafting.finalizeJob(fixture.project.id, plan.jobId);
    fixture.drafting.retryUnit(fixture.project.id, plan.jobId, "unit-1");
    fixture.drafting.startJob(fixture.project.id, plan.jobId);
    const third = fixture.drafting.startUnit(fixture.project.id, plan.jobId, "unit-1");
    fixture.drafting.failUnit(fixture.project.id, plan.jobId, "unit-1", third.attemptId, { code: "fixture", retryable: true });
    fixture.drafting.finalizeJob(fixture.project.id, plan.jobId);
    expect(() => fixture.drafting.retryUnit(fixture.project.id, plan.jobId, "unit-1"))
      .toThrow("attempt limit");
    expect(fixture.drafting.attemptCount(fixture.project.id, plan.jobId, "unit-1")).toBe(3);
    fixture.database.close();
  });

  it("cancels pending/running units without creating or changing passage drafts", () => {
    const fixture = setup(":memory:", 2);
    const plan = fixture.drafting.createPlan(fixture.input);
    fixture.drafting.authorize(fixture.project.id, plan.id, plan.fingerprint);
    fixture.drafting.startJob(fixture.project.id, plan.jobId);
    fixture.drafting.startUnit(fixture.project.id, plan.jobId, "unit-1");
    const cancelled = fixture.drafting.cancelJob(fixture.project.id, plan.jobId);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.units.map((unit) => unit.status)).toEqual(["cancelled", "cancelled"]);
    expect((fixture.database.prepare("SELECT COUNT(*) AS count FROM passage_draft_versions").get() as { count: number }).count).toBe(0);
    fixture.database.close();
  });

  it("recovers interrupted work, preserves completed units, and retries only failed units after reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-drafting-recovery-"));
    directories.push(directory);
    const path = join(directory, "story.sqlite");
    const first = setup(path, 2);
    const plan = first.drafting.createPlan(first.input);
    first.drafting.authorize(first.project.id, plan.id, plan.fingerprint);
    first.drafting.startJob(first.project.id, plan.jobId);
    const completedAttempt = first.drafting.startUnit(first.project.id, plan.jobId, "unit-1");
    first.drafting.completeUnit(first.project.id, plan.jobId, "unit-1", completedAttempt.attemptId);
    first.drafting.startUnit(first.project.id, plan.jobId, "unit-2");
    first.database.close();

    const reopenedDatabase = openDatabase(path);
    const reopened = new DraftingRepository(reopenedDatabase);
    expect(reopened.recoverInterrupted()).toBe(1);
    const recovered = reopened.getJob(first.project.id, plan.jobId)!;
    expect(recovered.status).toBe("partially_failed");
    expect(recovered.units.map((unit) => unit.status)).toEqual(["completed", "failed"]);
    expect(recovered.units[1]?.normalizedError).toMatchObject({ code: "process_interrupted", retryable: true });
    reopened.retryUnit(first.project.id, plan.jobId, "unit-2");
    expect(reopened.getJob(first.project.id, plan.jobId)?.units.map((unit) => unit.status)).toEqual(["completed", "pending"]);
    reopenedDatabase.close();
  });

  it("enforces job-plan-unit lineage at the SQLite boundary", () => {
    const fixture = setup();
    const planA = fixture.drafting.createPlan(fixture.input);
    const planB = fixture.drafting.createPlan({
      ...fixture.input,
      fingerprint: "plan-b",
      scope: { kind: "passages", passageIds: ["passage-1"], label: "B" },
      units: [{ ...fixture.input.units[0]!, id: "unit-b", inputFingerprint: "input-b" }],
    });
    const jobB = fixture.drafting.getJob(fixture.project.id, planB.jobId)!;
    expect(() => fixture.database.prepare(`INSERT INTO drafting_job_units (
      job_id, project_id, plan_id, unit_id, status, input_fingerprint, execution_policy_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
      .run(jobB.id, fixture.project.id, planA.id, "unit-1", "input-1", "passage-drafting-v1", "now", "now"))
      .toThrow("lineage mismatch");
    expect(() => fixture.database.prepare("UPDATE drafting_jobs SET plan_id = ? WHERE id = ?")
      .run(planA.id, jobB.id)).toThrow("lineage update");
    expect(fixture.drafting.getJob(fixture.project.id, jobB.id)?.planId).toBe(planB.id);
    fixture.database.close();
  });

  it("rejects cross-project plan and job ownership", () => {
    const fixture = setup();
    const plan = fixture.drafting.createPlan(fixture.input);
    const other = fixture.projects.create("Other project", undefined, "long-form");
    expect(fixture.drafting.getPlan(other.id, plan.id)).toBeUndefined();
    expect(fixture.drafting.getJob(other.id, plan.jobId)).toBeUndefined();
    expect(() => fixture.drafting.authorize(other.id, plan.id, plan.fingerprint)).toThrow("not found");
    expect(() => fixture.drafting.startJob(other.id, plan.jobId)).toThrow("not found");
    expect(() => fixture.drafting.cancelJob(other.id, plan.jobId)).toThrow("not found");
    fixture.database.close();
  });

  it("enforces generated draft provenance in SQLite and preserves it through lifecycle versions", () => {
    const fixture = setup();
    const plan = fixture.drafting.createPlan(fixture.input);
    const drafts = new PassageDraftRepository(fixture.database);
    expect(() => drafts.createVersion({
      projectId: fixture.project.id,
      passageId: "passage-1",
      basedOnPassagePlanVersionId: fixture.passageVersions[0]!.id,
      proseMarkdown: "Invalid lineage fixture.",
      sourceKind: "generated",
      generationPlanId: "wrong-plan",
      generationJobId: plan.jobId,
      generationUnitId: "unit-1",
      upstreamVersions: fixture.snapshot.upstreamVersions,
    })).toThrow("generation lineage mismatch");
    const generated = drafts.createVersion({
      projectId: fixture.project.id,
      passageId: "passage-1",
      basedOnPassagePlanVersionId: fixture.passageVersions[0]!.id,
      proseMarkdown: "Synthetic provenance fixture.",
      sourceKind: "generated",
      generationPlanId: plan.id,
      generationJobId: plan.jobId,
      generationUnitId: "unit-1",
      upstreamVersions: fixture.snapshot.upstreamVersions,
    });
    const accepted = drafts.transition(fixture.project.id, "passage-1", generated.id, "accepted");
    expect(accepted).toMatchObject({
      sourceKind: "lifecycle", generationPlanId: plan.id, generationJobId: plan.jobId, generationUnitId: "unit-1",
    });
    expect(() => fixture.database.prepare("DELETE FROM passage_draft_upstream_artifacts WHERE draft_version_id = ?")
      .run(generated.id)).toThrow("immutable");
    expect(() => fixture.database.prepare("DELETE FROM drafting_job_units WHERE job_id = ? AND unit_id = 'unit-1'")
      .run(plan.jobId)).toThrow("retained by passage draft provenance");
    fixture.database.close();
  });

  it("preserves valid project deletion cascades for drafting and draft architecture", () => {
    const fixture = setup();
    const plan = fixture.drafting.createPlan(fixture.input);
    const drafts = new PassageDraftRepository(fixture.database);
    drafts.createVersion({
      projectId: fixture.project.id,
      passageId: "passage-1",
      basedOnPassagePlanVersionId: fixture.passageVersions[0]!.id,
      proseMarkdown: "Deletion cascade fixture.",
      sourceKind: "generated",
      generationPlanId: plan.id,
      generationJobId: plan.jobId,
      generationUnitId: "unit-1",
      upstreamVersions: fixture.snapshot.upstreamVersions,
    });
    expect(() => fixture.database.prepare("DELETE FROM projects WHERE id = ?").run(fixture.project.id)).not.toThrow();
    expect((fixture.database.prepare("SELECT COUNT(*) AS count FROM drafting_plans").get() as { count: number }).count).toBe(0);
    expect((fixture.database.prepare("SELECT COUNT(*) AS count FROM passage_draft_versions").get() as { count: number }).count).toBe(0);
    fixture.database.close();
  });
});
