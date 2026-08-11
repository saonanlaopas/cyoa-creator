import { describe, expect, it } from "vitest";
import { NarrativeReviewRepository, ProjectRepository, openDatabase } from "../src/index.js";

const aggregate = (projectId: string, status = "planned") => ({
  schemaVersion: 1 as const, projectId,
  reviewInput: { fingerprint: "review-input" },
  plan: { id: "plan-a", fingerprint: "fingerprint-a", definitionFingerprint: "fingerprint-a" },
  job: { id: "job-a", status, units: [{ id: "unit-a", status, inputFingerprint: "unit-input", contextFingerprint: "unit-context", findings: [] as Array<{ id: string }> }] },
});

describe("NarrativeReviewRepository", () => {
  it("appends immutable aggregate versions and rolls back completion atomically", () => {
    const database = openDatabase(); const projects = new ProjectRepository(database);
    const project = projects.create("Review persistence", undefined, "long-form");
    const repository = new NarrativeReviewRepository(database);
    expect(repository.create(aggregate(project.id)).version).toBe(1);
    const completed = aggregate(project.id, "completed");
    completed.job.units[0] = {
      ...completed.job.units[0]!,
      inputFingerprint: "unit-input", contextFingerprint: "unit-context",
      attempts: [{ id: "attempt-a" }],
      findings: [{
        id: "finding-a", reviewPlanId: "plan-a", jobId: "job-a", unitId: "unit-a", attemptId: "attempt-a",
        reviewInputFingerprint: "review-input", contextFingerprint: "unit-context",
      }],
    } as never;
    const exact = completed;
    expect(() => repository.update(exact, { simulateFailure: true })).toThrow(/Simulated/);
    expect(repository.get<typeof completed>(project.id, "plan-a")?.version).toBe(1);
    expect(repository.get<typeof completed>(project.id, "plan-a")?.content.job.units[0]?.findings).toEqual([]);
    expect(repository.update(exact, { assertFreshInTransaction: () => undefined }).version).toBe(2);
    expect(repository.history(project.id, "plan-a")).toHaveLength(2);
    expect(() => repository.update({ ...exact, plan: { ...exact.plan, fingerprint: "changed" } })).toThrow(/immutable/);
    const changedInput = structuredClone(exact); changedInput.reviewInput.fingerprint = "changed-input";
    (changedInput.job.units[0]!.findings[0] as unknown as { reviewInputFingerprint: string }).reviewInputFingerprint = "changed-input";
    expect(() => repository.update(changedInput)).toThrow(/input is immutable/);
    const changedJob = structuredClone(exact); changedJob.job.id = "job-b";
    (changedJob.job.units[0]!.findings[0] as unknown as { jobId: string }).jobId = "job-b";
    expect(() => repository.update(changedJob)).toThrow(/job identity is immutable/);
    const changedUnit = structuredClone(exact); (changedUnit.job.units[0] as unknown as { contextFingerprint: string }).contextFingerprint = "changed-context";
    (changedUnit.job.units[0]!.findings[0] as unknown as { contextFingerprint: string }).contextFingerprint = "changed-context";
    expect(() => repository.update(changedUnit)).toThrow(/unit definitions are immutable/);
    const corrupt = structuredClone(exact); (corrupt.job.units[0]!.findings[0] as unknown as { jobId: string }).jobId = "job-b";
    expect(() => repository.update(corrupt)).toThrow(/finding lineage/);
    database.close();
  });

  it("uses existing project-owned artifact cascades without schema migration", () => {
    const database = openDatabase(); const projects = new ProjectRepository(database); const project = projects.create("Cascade", undefined, "long-form");
    const repository = new NarrativeReviewRepository(database); repository.create(aggregate(project.id));
    database.prepare("DELETE FROM projects WHERE id = ?").run(project.id);
    expect(repository.list(project.id)).toEqual([]);
    database.close();
  });
});
