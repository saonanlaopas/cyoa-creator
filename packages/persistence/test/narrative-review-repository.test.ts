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

function finishAttempt(repository: NarrativeReviewRepository, value: ReturnType<typeof aggregate>, status: "completed" | "failed", withFinding = false) {
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
      (value: typeof completed) => { value.job.units[0]!.findings[0]!.evidenceReferences = [{ kind: "passage", passageId: "passage-b", draftVersionId: "draft-b" }]; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(completed); mutate(changed);
      const item = changed.job.units[0]!.findings[0];
      if (item) refreshFindingIdentity(item);
      expect(() => repository.update(changed)).toThrow(/finding|lineage/i);
    }
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
