import { describe, expect, it } from "vitest";
import {
  NarrativeReviewRepository,
  ProjectRepository,
  narrativeReviewFindingFingerprint,
  openDatabase,
} from "../src/index.js";

const runningAttempt = (id: string, number: number) => ({
  id, number, status: "running", startedAt: `started-${number}`, finishedAt: null,
  error: null, repair: { maximum: 1, performed: 0, malformedBytes: null, malformedSha256: null },
  usage: null, providerMetadata: [],
});

const aggregate = (projectId: string) => ({
  schemaVersion: 1 as const, projectId,
  reviewInput: { fingerprint: "review-input" },
  plan: { id: "plan-a", fingerprint: "fingerprint-a", definitionFingerprint: "fingerprint-a" },
  job: {
    id: "job-a", status: "planned", createdAt: "created",
    units: [{
      id: "unit-a", status: "pending", inputFingerprint: "unit-input", contextFingerprint: "unit-context",
      attempts: [] as Array<Record<string, unknown>>, findings: [] as Array<Record<string, unknown>>,
    }],
  },
});

function finding(overrides: Record<string, unknown> = {}) {
  const durable = {
    reviewPlanId: "plan-a", jobId: "job-a", unitId: "unit-a", attemptId: "attempt-b",
    reviewInputFingerprint: "review-input", contextFingerprint: "unit-context",
    logicalKey: "pacing-a", category: "pacing", severity: "warning", confidence: "high",
    message: "The beat is abrupt.", reviewNote: "Review the transition.", passageIds: ["passage-a"],
    choiceIds: [], routeIds: [], endingIds: [], mechanicKeys: [], factIds: [], threadIds: [],
    acceptedDraftVersionIds: ["draft-a"],
    evidenceReferences: [{ kind: "passage", passageId: "passage-a", draftVersionId: "draft-a" }],
    ...overrides,
  };
  const fingerprint = narrativeReviewFindingFingerprint(durable);
  return { schemaId: "cyoa.narrative-review-finding", schemaVersion: 2, id: `nrf_${fingerprint.slice(0, 24)}`, fingerprint, ...durable };
}

function refreshFindingIdentity(item: Record<string, unknown>): void {
  const fingerprint = narrativeReviewFindingFingerprint(item);
  item.fingerprint = fingerprint; item.id = `nrf_${fingerprint.slice(0, 24)}`;
}

function appendRunning(repository: NarrativeReviewRepository, value: ReturnType<typeof aggregate>, id: string, number: number) {
  const next = structuredClone(value); next.job.status = "running"; next.job.units[0]!.status = "running";
  next.job.units[0]!.attempts.push(runningAttempt(id, number));
  return repository.update(next).content;
}

function finishAttempt(repository: NarrativeReviewRepository, value: ReturnType<typeof aggregate>, status: "completed" | "failed" | "cancelled", withFinding = false) {
  const next = structuredClone(value); const attempt = next.job.units[0]!.attempts.at(-1)!;
  attempt.status = status; attempt.finishedAt = `finished-${attempt.number}`;
  if (status === "failed") attempt.error = { code: "failed", message: "Failed", retryable: true, validationIssues: [] };
  next.job.units[0]!.status = status;
  if (withFinding) next.job.units[0]!.findings.push(finding());
  return repository.update(next).content;
}

describe("NarrativeReviewRepository", () => {
  it("appends immutable aggregate versions and rolls back completion atomically", () => {
    const database = openDatabase(); const projects = new ProjectRepository(database);
    const project = projects.create("Review persistence", undefined, "long-form");
    const repository = new NarrativeReviewRepository(database);
    const initial = repository.create(aggregate(project.id)).content;
    const running = appendRunning(repository, initial, "attempt-a", 1);
    const completed = structuredClone(running); const attempt = completed.job.units[0]!.attempts[0]!;
    attempt.status = "completed"; attempt.finishedAt = "finished-1"; completed.job.units[0]!.status = "completed";
    completed.job.units[0]!.findings.push(finding({ attemptId: "attempt-a" }));
    expect(() => repository.update(completed, { simulateFailure: true })).toThrow(/Simulated/);
    expect(repository.get<typeof completed>(project.id, "plan-a")?.content.job.units[0]?.findings).toEqual([]);
    expect(repository.update(completed, { assertFreshInTransaction: () => undefined }).version).toBe(3);
    expect(repository.history(project.id, "plan-a")).toHaveLength(3);
    expect(() => repository.update({ ...completed, plan: { ...completed.plan, fingerprint: "changed" } })).toThrow(/immutable/);
    const changedInput = structuredClone(completed); changedInput.reviewInput.fingerprint = "changed-input";
    changedInput.job.units[0]!.findings[0]!.reviewInputFingerprint = "changed-input";
    refreshFindingIdentity(changedInput.job.units[0]!.findings[0]!);
    expect(() => repository.update(changedInput)).toThrow(/input is immutable/);
    const changedJob = structuredClone(completed); changedJob.job.id = "job-b"; changedJob.job.units[0]!.findings[0]!.jobId = "job-b";
    refreshFindingIdentity(changedJob.job.units[0]!.findings[0]!);
    expect(() => repository.update(changedJob)).toThrow(/job identity is immutable/);
    const changedUnit = structuredClone(completed); changedUnit.job.units[0]!.contextFingerprint = "changed-context";
    changedUnit.job.units[0]!.findings[0]!.contextFingerprint = "changed-context";
    refreshFindingIdentity(changedUnit.job.units[0]!.findings[0]!);
    expect(() => repository.update(changedUnit)).toThrow(/unit definitions are immutable/);
    const corrupt = structuredClone(completed); corrupt.job.units[0]!.findings[0]!.jobId = "job-b";
    expect(() => repository.update(corrupt)).toThrow(/finding lineage/);
    database.close();
  });

  it("rejects attempt rewrites and keeps terminal attempts append-only across retries", () => {
    const database = openDatabase(); const project = new ProjectRepository(database).create("Attempt history", undefined, "long-form");
    const repository = new NarrativeReviewRepository(database);
    const first = appendRunning(repository, repository.create(aggregate(project.id)).content, "attempt-a", 1);
    const failed = finishAttempt(repository, first, "failed");
    const pending = structuredClone(failed); pending.job.units[0]!.status = "pending"; repository.update(pending);
    const second = appendRunning(repository, pending, "attempt-b", 2);
    const completed = finishAttempt(repository, second, "completed", true);
    const mutations = [
      (value: typeof completed) => { value.job.units[0]!.attempts.splice(0, 1); },
      (value: typeof completed) => { value.job.units[0]!.attempts.reverse(); },
      (value: typeof completed) => { value.job.units[0]!.attempts[0]!.id = "replacement-attempt"; },
      (value: typeof completed) => { value.job.units[0]!.attempts[0]!.finishedAt = "rewritten"; },
      (value: typeof completed) => { value.job.units[0]!.attempts[0]!.error = { code: "other" }; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(completed); mutate(changed);
      expect(() => repository.update(changed)).toThrow(/attempt|lineage/i);
    }
    database.close();
  });

  it("rejects impossible unit and attempt lifecycle combinations", () => {
    const database = openDatabase(); const projects = new ProjectRepository(database);
    const repository = new NarrativeReviewRepository(database);
    const pending = repository.create(aggregate(projects.create("Invalid lifecycle", undefined, "long-form").id)).content;
    for (const status of ["completed", "failed"]) {
      const changed = structuredClone(pending); changed.job.units[0]!.status = status;
      expect(() => repository.update(changed)).toThrow(/status does not agree|pending unit transition/i);
    }
    const wrongNumber = structuredClone(pending); wrongNumber.job.units[0]!.status = "running";
    wrongNumber.job.units[0]!.attempts.push(runningAttempt("attempt-a", 2));
    expect(() => repository.update(wrongNumber)).toThrow(/numbers must match append order/i);

    const running = appendRunning(repository, pending, "attempt-a", 1);
    const mismatches = [
      { attempt: "failed", unit: "running" },
      { attempt: "completed", unit: "running" },
      { attempt: "failed", unit: "completed" },
      { attempt: "completed", unit: "failed" },
    ];
    for (const mismatch of mismatches) {
      const changed = structuredClone(running); const attempt = changed.job.units[0]!.attempts[0]!;
      attempt.status = mismatch.attempt; attempt.finishedAt = "finished-1";
      if (mismatch.attempt === "failed") attempt.error = { code: "failed", message: "Failed", retryable: true, validationIssues: [] };
      changed.job.units[0]!.status = mismatch.unit;
      expect(() => repository.update(changed)).toThrow(/status does not agree|completion must agree/i);
    }

    const completed = finishAttempt(repository, running, "completed");
    const afterCompletion = structuredClone(completed);
    afterCompletion.job.units[0]!.attempts.push(runningAttempt("attempt-b", 2));
    expect(() => repository.update(afterCompletion)).toThrow(/status does not agree|terminal/i);

    const failedPending = repository.create(aggregate(projects.create("Invalid retry", undefined, "long-form").id)).content;
    const failedRunning = appendRunning(repository, failedPending, "attempt-a", 1);
    const failed = finishAttempt(repository, failedRunning, "failed");
    const retryWithoutPreparation = structuredClone(failed);
    retryWithoutPreparation.job.units[0]!.attempts.push(runningAttempt("attempt-b", 2));
    expect(() => repository.update(retryWithoutPreparation)).toThrow(/status does not agree|retry preparation/i);
    database.close();
  });

  it("accepts the exact initial, retry, completion, failure, and cancellation lifecycles", () => {
    const database = openDatabase(); const projects = new ProjectRepository(database);
    const repository = new NarrativeReviewRepository(database);
    const completionPending = repository.create(aggregate(projects.create("Valid completion", undefined, "long-form").id)).content;
    const completionRunning = appendRunning(repository, completionPending, "attempt-a", 1);
    expect(finishAttempt(repository, completionRunning, "completed").job.units[0]).toMatchObject({
      status: "completed", attempts: [{ number: 1, status: "completed" }],
    });

    const pending = repository.create(aggregate(projects.create("Valid retry", undefined, "long-form").id)).content;
    const firstRunning = appendRunning(repository, pending, "attempt-a", 1);
    expect(firstRunning.job.units[0]).toMatchObject({ status: "running", attempts: [{ number: 1, status: "running" }] });
    const failed = finishAttempt(repository, firstRunning, "failed");
    expect(failed.job.units[0]).toMatchObject({ status: "failed", attempts: [{ number: 1, status: "failed" }] });
    const retryPending = structuredClone(failed); retryPending.job.units[0]!.status = "pending";
    const prepared = repository.update(retryPending).content;
    expect(prepared.job.units[0]).toMatchObject({ status: "pending", attempts: [{ number: 1, status: "failed" }] });
    const retryRunning = appendRunning(repository, prepared, "attempt-b", 2);
    expect(retryRunning.job.units[0]).toMatchObject({ status: "running", attempts: [{ number: 1 }, { number: 2, status: "running" }] });
    const completed = finishAttempt(repository, retryRunning, "completed", true);
    expect(completed.job.units[0]).toMatchObject({ status: "completed", attempts: [{ status: "failed" }, { status: "completed" }] });

    const pendingCancellation = repository.create(aggregate(projects.create("Pending cancellation", undefined, "long-form").id)).content;
    const cancelledPending = structuredClone(pendingCancellation); cancelledPending.job.units[0]!.status = "cancelled";
    expect(repository.update(cancelledPending).content.job.units[0]).toMatchObject({ status: "cancelled", attempts: [] });

    const runningCancellation = repository.create(aggregate(projects.create("Running cancellation", undefined, "long-form").id)).content;
    const cancellationRunning = appendRunning(repository, runningCancellation, "attempt-a", 1);
    const cancelledRunning = finishAttempt(repository, cancellationRunning, "cancelled");
    expect(cancelledRunning.job.units[0]).toMatchObject({ status: "cancelled", attempts: [{ status: "cancelled" }] });
    const cancelledRetry = structuredClone(cancelledRunning); cancelledRetry.job.units[0]!.attempts.push(runningAttempt("attempt-b", 2));
    expect(() => repository.update(cancelledRetry)).toThrow(/status does not agree|terminal/i);
    database.close();
  });

  it("rejects finding deletion, replacement, mutation, and recomputed identities", () => {
    const database = openDatabase(); const project = new ProjectRepository(database).create("Finding history", undefined, "long-form");
    const repository = new NarrativeReviewRepository(database);
    const running = appendRunning(repository, repository.create(aggregate(project.id)).content, "attempt-b", 1);
    const completed = finishAttempt(repository, running, "completed", true);
    const mutations = [
      (value: typeof completed) => { value.job.units[0]!.findings = []; },
      (value: typeof completed) => { value.job.units[0]!.findings[0] = finding({ logicalKey: "replacement" }); },
      (value: typeof completed) => { value.job.units[0]!.findings[0]!.message = "Rewritten"; },
      (value: typeof completed) => { value.job.units[0]!.findings[0]!.severity = "error"; },
      (value: typeof completed) => { value.job.units[0]!.findings[0]!.confidence = "low"; },
      (value: typeof completed) => { value.job.units[0]!.findings[0]!.evidenceReferences = [{ kind: "passage", passageId: "passage-b", draftVersionId: "draft-b" }]; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(completed); mutate(changed);
      const item = changed.job.units[0]!.findings[0];
      if (item) refreshFindingIdentity(item);
      expect(() => repository.update(changed)).toThrow(/finding|lineage/i);
    }
    const changedId = structuredClone(completed); changedId.job.units[0]!.findings[0]!.id = "nrf_replaced";
    expect(() => repository.update(changedId)).toThrow(/fingerprint/i);
    const changedFingerprint = structuredClone(completed); changedFingerprint.job.units[0]!.findings[0]!.fingerprint = "replaced";
    expect(() => repository.update(changedFingerprint)).toThrow(/fingerprint/i);
    database.close();
  });

  it("keeps a completed empty finding set immutable", () => {
    const database = openDatabase(); const project = new ProjectRepository(database).create("Empty review", undefined, "long-form");
    const repository = new NarrativeReviewRepository(database);
    const running = appendRunning(repository, repository.create(aggregate(project.id)).content, "attempt-b", 1);
    const completed = finishAttempt(repository, running, "completed");
    const changed = structuredClone(completed); changed.job.units[0]!.findings.push(finding());
    expect(() => repository.update(changed)).toThrow(/findings may only be appended|completed.*immutable/i);
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
