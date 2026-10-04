import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { FOUNDATION_ARTIFACT_IDS, FoundationBootstrapContextSchema, defaultCreativeDirection, defaultProjectBrief, newAdaptationIntent,
  normalizeAdaptationIntent, sourceCanonicalJson, sourceDigest, type FoundationArtifactId, type SourceDossier } from "@story-to-cyoa/domain";
import { ArtifactRepository, FoundationBootstrapRepository, PortableProjectRepository, ProjectRepository, WorkflowRepository,
  openDatabase, validateFoundationBootstrapDatabase, type FoundationBootstrapJob, type StoryDatabase } from "../src/index.js";
import { analysisFixture, completeFixture } from "./source-analysis-fixture.js";
import { deterministicFoundationBootstrapCandidate } from "../../../apps/server/src/services/foundation-bootstrap-provider.js";

const databases: StoryDatabase[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
const database = () => { const value = openDatabase(); databases.push(value); return value; };
function fixture() {
  const f = analysisFixture(database()); completeFixture(f);
  const workflow = new WorkflowRepository(f.database), repository = new FoundationBootstrapRepository(f.database);
  const dossier = f.artifacts.getCurrent<SourceDossier>(f.projectId, "source-dossier")!;
  workflow.approve(f.projectId, "source-dossier", dossier.id);
  const record = dossier.content.records.find((item) => item.status === "supported" && item.category === "character")!;
  const intent = normalizeAdaptationIntent({ ...newAdaptationIntent(f.projectId, { dossierVersionId: dossier.id, dossierMaterialFingerprint: dossier.content.materialFingerprint, source: dossier.content.binding }),
    obligations: [{ id: "identity", scope: "project", rationale: "Retain this source identity.", provenance: { origin: "manual", projectId: f.projectId },
      status: "requested", kind: "character-state", targetIds: [record.id], evidence: record.evidence,
      requirement: "Request the source identity.", strength: "required", transformations: [] }] });
  const savedIntent = f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "adaptation-intent", content: intent }); workflow.approve(f.projectId, "adaptation-intent", savedIntent.id);
  const brief = f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "brief", content: defaultProjectBrief("Harbor") });
  const direction = f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "creative-direction", content: defaultCreativeDirection() });
  const context = FoundationBootstrapContextSchema.parse({ schemaVersion: 1, policyVersion: "foundation-bootstrap-v1", projectId: f.projectId, title: "Harbor",
    dossierVersionId: dossier.id, intentVersionId: savedIntent.id, dossier: dossier.content, intent,
    baseVersionIds: { brief: brief.id, "creative-direction": direction.id, bible: null, routes: null, endings: null, mechanics: null },
    baseArtifacts: { brief: brief.content, "creative-direction": direction.content, bible: null, routes: null, endings: null, mechanics: null },
    request: "Create six reviewed draft foundations", providerId: "offline-foundation-bootstrap", modelId: "offline-foundation-v1" });
  const contextFingerprint = sourceDigest(context), units = [{ id: "foundations" as const, artifactIds: [...FOUNDATION_ARTIFACT_IDS] }], contextBytes = Buffer.byteLength(sourceCanonicalJson(context));
  const plan = repository.savePlan({ id: randomUUID(), projectId: f.projectId, context, contextFingerprint, units,
    fingerprint: sourceDigest({ contextFingerprint, units, providerId: context.providerId, modelId: context.modelId }), createdAt: new Date().toISOString(), contextBytes,
    estimatedInputTokens: Math.ceil(contextBytes / 4), cost: 0, providerId: context.providerId, modelId: context.modelId });
  return { ...f, workflow, repository, plan };
}
type Fixture = ReturnType<typeof fixture>;
function running(f: Fixture) {
  const job = f.repository.createJob(f.projectId, f.plan.id, f.plan.fingerprint);
  return f.repository.begin(f.projectId, job.id);
}
function completed(f: Fixture) {
  const job = running(f);
  return f.repository.finish(f.projectId, job.id, job.units[0].attempts[0]!.id, "completed", deterministicFoundationBootstrapCandidate(f.plan.context));
}
function apply(f: Fixture, jobId: string, selected: FoundationArtifactId[] = [...FOUNDATION_ARTIFACT_IDS]) {
  const preview = f.repository.previewApply(f.projectId, jobId, selected);
  return f.repository.apply(f.projectId, jobId, preview.effectiveArtifactIds, preview.previewFingerprint);
}
function rewrite(f: Fixture, job: FoundationBootstrapJob) {
  return f.database.prepare("UPDATE foundation_bootstrap_jobs SET content_json=? WHERE id=?").run(JSON.stringify(job), job.id);
}

describe("Foundation bootstrap persistence lifecycle", () => {
  it("binds pending, running and completed to one immutable authorized attempt", () => {
    const f = fixture(), pending = f.repository.createJob(f.projectId, f.plan.id, f.plan.fingerprint);
    expect(pending.units[0].attempts).toEqual([]);
    const started = f.repository.begin(f.projectId, pending.id); expect(started.units[0].attempts[0]).toMatchObject({ number: 1, status: "running", finishedAt: null, contextFingerprint: f.plan.contextFingerprint });
    const finished = f.repository.finish(f.projectId, started.id, started.units[0].attempts[0]!.id, "completed", deterministicFoundationBootstrapCandidate(f.plan.context));
    expect(finished.status).toBe("completed"); expect(finished.units[0].attempts[0]!.status).toBe("completed");
    expect(f.repository.candidate(f.projectId, finished.id).candidate.passageValidation).toBe("pending");
    expect(() => f.repository.begin(f.projectId, finished.id)).toThrow(); expect(() => f.repository.retry(f.projectId, finished.id)).toThrow();
  });
  it("retains exact failed history across explicit pending retry and next-number completion", () => {
    const f = fixture(), started = running(f), first = started.units[0].attempts[0]!;
    const failed = f.repository.finish(f.projectId, started.id, first.id, "failed", undefined, "provider_failed");
    expect(f.repository.retry(f.projectId, started.id).status).toBe("pending");
    const retry = f.repository.begin(f.projectId, started.id);
    expect(retry.units[0].attempts[0]).toEqual(failed.units[0].attempts[0]); expect(retry.units[0].attempts[1]!.number).toBe(2);
    f.repository.finish(f.projectId, started.id, retry.units[0].attempts[1]!.id, "completed", deterministicFoundationBootstrapCandidate(f.plan.context));
    expect(f.repository.getJob(f.projectId, started.id).units[0].attempts.map((item) => item.status)).toEqual(["failed", "completed"]);
  });
  it.each(["pending", "running", "failed"] as const)("cancels %s work without allowing new attempts or late settlement", (state) => {
    const f = fixture(); let job = f.repository.createJob(f.projectId, f.plan.id, f.plan.fingerprint);
    if (state !== "pending") job = f.repository.begin(f.projectId, job.id);
    if (state === "failed") job = f.repository.finish(f.projectId, job.id, job.units[0].attempts[0]!.id, "failed", undefined, "provider_failed");
    const cancelled = f.repository.cancel(f.projectId, job.id); expect(cancelled.status).toBe("cancelled");
    expect(cancelled.units[0].attempts.at(-1)?.status).toBe(state === "running" ? "cancelled" : state === "failed" ? "failed" : undefined);
    expect(() => f.repository.retry(f.projectId, job.id)).toThrow(); expect(() => f.repository.begin(f.projectId, job.id)).toThrow();
    expect(() => f.repository.finish(f.projectId, job.id, job.units[0].attempts[0]?.id ?? "none", "completed", deterministicFoundationBootstrapCandidate(f.plan.context))).toThrow();
  });
  it("caps attempts at four with an explicit repreview recovery path", () => {
    const f = fixture(); let job = running(f);
    for (let count = 1; count <= 4; count++) {
      job = f.repository.finish(f.projectId, job.id, job.units[0].attempts.at(-1)!.id, "failed", undefined, "provider_failed");
      if (count < 4) { f.repository.retry(f.projectId, job.id); job = f.repository.begin(f.projectId, job.id); }
    }
    expect(() => f.repository.retry(f.projectId, job.id)).toThrow("bootstrap_retry_exhausted_repreview_required");
  });
  it("rejects wrong authorization and overlapping active jobs", () => {
    const f = fixture(); expect(() => f.repository.createJob(f.projectId, f.plan.id, "a".repeat(64))).toThrow("bootstrap_authorization_invalid");
    running(f); expect(() => f.repository.createJob(f.projectId, f.plan.id, f.plan.fingerprint)).toThrow("bootstrap_job_already_active");
  });
  it.each(["completed", "cancelled"] as const)("SQL cannot rewrite terminal %s jobs", (status) => {
    const f = fixture(), job = status === "completed" ? completed(f) : f.repository.cancel(f.projectId, running(f).id);
    const changed = structuredClone(job); changed.status = changed.units[0].status = "pending";
    expect(() => rewrite(f, changed)).toThrow(/append-only|lifecycle is invalid/); expect(f.repository.getJob(f.projectId, job.id)).toEqual(job);
  });
  it("SQL cannot rewrite a failed historical attempt or delete durable audit", () => {
    const f = fixture(), job = running(f); f.repository.finish(f.projectId, job.id, job.units[0].attempts[0]!.id, "failed", undefined, "provider_failed");
    const failed = f.repository.getJob(f.projectId, job.id), changed = structuredClone(failed); changed.units[0].attempts[0]!.diagnostic = "interrupted";
    expect(() => rewrite(f, changed)).toThrow("append-only");
    expect(() => f.database.prepare("DELETE FROM foundation_bootstrap_jobs WHERE id=?").run(job.id)).toThrow("immutable");
    expect(() => f.database.prepare("UPDATE foundation_bootstrap_plans SET content_json=? WHERE id=?").run(JSON.stringify({}), f.plan.id)).toThrow("immutable");
  });
  it("direct persistence rejects invalid candidates atomically and preserves the running attempt", () => {
    const f = fixture(), job = running(f), candidate = deterministicFoundationBootstrapCandidate(f.plan.context); candidate.provenance.pop();
    expect(() => f.repository.finish(f.projectId, job.id, job.units[0].attempts[0]!.id, "completed", candidate)).toThrow("bootstrap_provenance_incomplete");
    expect(f.repository.getJob(f.projectId, job.id)).toEqual(job); expect(f.database.prepare("SELECT id FROM foundation_bootstrap_candidates").all()).toEqual([]);
  });
  it("binds outcomes to exact attempts and forbids output on failure", () => {
    const f = fixture(), job = running(f), candidate = deterministicFoundationBootstrapCandidate(f.plan.context);
    expect(() => f.repository.finish(f.projectId, job.id, "foreign", "completed", candidate)).toThrow("bootstrap_attempt_not_running");
    expect(() => f.repository.finish(f.projectId, job.id, job.units[0].attempts[0]!.id, "failed", candidate)).toThrow("bootstrap_failed_output_forbidden");
  });
  it("recovers an interrupted attempt as failed and rejects the old attempt after retry begins", () => {
    const f = fixture(), job = running(f); f.repository.recoverInterrupted();
    const failed = f.repository.getJob(f.projectId, job.id); expect(failed.units[0].attempts[0]).toMatchObject({ status: "failed", diagnostic: "interrupted" });
    f.repository.retry(f.projectId, job.id); const retry = f.repository.begin(f.projectId, job.id);
    expect(() => f.repository.finish(f.projectId, job.id, job.units[0].attempts[0]!.id, "completed", deterministicFoundationBootstrapCandidate(f.plan.context))).toThrow("bootstrap_attempt_not_running");
    expect(f.repository.getJob(f.projectId, job.id)).toEqual(retry);
  });
});

describe("Foundation bootstrap atomic application and recovery", () => {
  it("rolls back all artifact versions, workflow state and audit after a forced fourth-write failure", () => {
    const f = fixture(), job = completed(f), before = new PortableProjectRepository(f.database).exportRows(f.projectId), preview = f.repository.previewApply(f.projectId, job.id, [...FOUNDATION_ARTIFACT_IDS]);
    let writes = 0;
    expect(() => f.repository.apply(f.projectId, job.id, [...FOUNDATION_ARTIFACT_IDS], preview.previewFingerprint, () => { if (++writes === 4) throw new Error("forced-late-failure"); })).toThrow("forced-late-failure");
    expect(writes).toBe(4); expect(new PortableProjectRepository(f.database).exportRows(f.projectId)).toEqual(before);
    expect(f.repository.applications(f.projectId, job.id)).toEqual([]);
    expect(Object.keys(apply(f, job.id).artifactVersionIds)).toHaveLength(6);
  });
  it("enforces dependency closure while supporting staged partial application", () => {
    const f = fixture(), job = completed(f), routes = f.repository.previewApply(f.projectId, job.id, ["routes"]);
    expect(routes.effectiveArtifactIds).toEqual([...FOUNDATION_ARTIFACT_IDS]);
    expect(() => f.repository.apply(f.projectId, job.id, ["routes"], routes.previewFingerprint)).toThrow("bootstrap_apply_selection_or_preview_invalid");
    apply(f, job.id, ["brief"]); apply(f, job.id, ["creative-direction"]); apply(f, job.id, ["bible"]);
    const remaining = f.repository.previewApply(f.projectId, job.id, ["routes"]); expect(remaining.effectiveArtifactIds).toEqual(["routes", "endings", "mechanics"]);
    f.repository.apply(f.projectId, job.id, remaining.effectiveArtifactIds, remaining.previewFingerprint);
    expect(Object.keys(f.repository.appliedVersions(f.projectId, job.id))).toHaveLength(6); expect(f.repository.applications(f.projectId, job.id)).toHaveLength(4);
    for (const id of FOUNDATION_ARTIFACT_IDS) expect(f.workflow.get(f.projectId, id).status).toBe("draft");
  });
  it("rejects stale absent/current preconditions without modifying already reviewed candidates", () => {
    const f = fixture(), job = completed(f), original = f.repository.candidate(f.projectId, job.id);
    f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "brief", content: defaultProjectBrief("Changed by author") });
    expect(() => f.repository.previewApply(f.projectId, job.id, [...FOUNDATION_ARTIFACT_IDS])).toThrow("bootstrap_base_stale");
    expect(f.repository.candidate(f.projectId, job.id)).toEqual(original);
  });
  it("duplicates pending review, survives original deletion and applies remapped independent candidates", () => {
    const f = fixture(), job = completed(f), copy = f.projects.duplicate(f.projectId); f.projects.remove(f.projectId);
    validateFoundationBootstrapDatabase(f.database, copy.id);
    const repository = new FoundationBootstrapRepository(f.database), copied = repository.listJobs(copy.id)[0]!;
    expect(copied.id).not.toBe(job.id); const candidate = repository.candidate(copy.id, copied.id);
    expect(candidate.candidate.canonAssessment[0]!.obligationId).not.toBe("identity");
    const preview = repository.previewApply(copy.id, copied.id, [...FOUNDATION_ARTIFACT_IDS]); repository.apply(copy.id, copied.id, preview.effectiveArtifactIds, preview.previewFingerprint);
    expect(new ArtifactRepository(f.database).getCurrent(copy.id, "routes")).toBeDefined(); validateFoundationBootstrapDatabase(f.database, copy.id);
  });
  it("duplicates applied audit and retains complete independent immutable history", () => {
    const f = fixture(), job = completed(f); apply(f, job.id);
    const copy = f.projects.duplicate(f.projectId); f.projects.remove(f.projectId); validateFoundationBootstrapDatabase(f.database, copy.id);
    const repository = new FoundationBootstrapRepository(f.database), copied = repository.listJobs(copy.id)[0]!;
    expect(Object.keys(repository.appliedVersions(copy.id, copied.id))).toHaveLength(6);
    expect(repository.candidate(copy.id, copied.id).candidate.artifacts.routes).toEqual(new ArtifactRepository(f.database).getCurrent(copy.id, "routes")!.content);
  });
  it("imports a completed candidate and applies it locally without a provider", () => {
    const f = fixture(), job = completed(f), bundle = new PortableProjectRepository(f.database).exportRows(f.projectId), target = database();
    new PortableProjectRepository(target).importRows(bundle, validateFoundationBootstrapDatabase);
    const repository = new FoundationBootstrapRepository(target), preview = repository.previewApply(f.projectId, job.id, [...FOUNDATION_ARTIFACT_IDS]);
    repository.apply(f.projectId, job.id, preview.effectiveArtifactIds, preview.previewFingerprint);
    expect(repository.applications(f.projectId, job.id)).toHaveLength(1); validateFoundationBootstrapDatabase(target, f.projectId);
  });
  it("rejects a malformed portable candidate atomically without partial project import", () => {
    const f = fixture(); completed(f); const bundle = new PortableProjectRepository(f.database).exportRows(f.projectId), row = bundle.tables.foundation_bootstrap_candidates[0]!;
    const candidate = JSON.parse(String(row.content_json)); candidate.canonAssessment[0].endingIds = ["invented-ending"]; row.content_json = JSON.stringify(candidate);
    const target = database(); expect(() => new PortableProjectRepository(target).importRows(bundle, validateFoundationBootstrapDatabase)).toThrow();
    expect(new ProjectRepository(target).list()).toEqual([]); expect(target.prepare("SELECT id FROM foundation_bootstrap_candidates").all()).toEqual([]);
  });
  it("imports interrupted work and recovers an append-only failed attempt before retry", () => {
    const f = fixture(), job = running(f), bundle = new PortableProjectRepository(f.database).exportRows(f.projectId), target = database();
    new PortableProjectRepository(target).importRows(bundle, validateFoundationBootstrapDatabase);
    const repository = new FoundationBootstrapRepository(target); repository.recoverInterrupted();
    expect(repository.getJob(f.projectId, job.id).units[0].attempts[0]).toMatchObject({ status: "failed", diagnostic: "interrupted" });
    repository.retry(f.projectId, job.id); const retry = repository.begin(f.projectId, job.id);
    expect(retry.units[0].attempts[1]!.number).toBe(2); expect(retry.units[0].attempts[0]!.id).toBe(job.units[0].attempts[0]!.id);
  });
});
