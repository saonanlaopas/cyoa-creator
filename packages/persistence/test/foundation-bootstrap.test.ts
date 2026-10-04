import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FOUNDATION_ARTIFACT_IDS, FoundationBootstrapContextSchema, defaultCreativeDirection, defaultProjectBrief, newAdaptationIntent,
  creativeDirectionFingerprints, foundationFieldPaths, LongFormStoryBibleSchema, normalizeCreativeDirection, normalizeAdaptationIntent, sourceCanonicalJson, sourceDigest, type FoundationArtifactId, type SourceDossier } from "@story-to-cyoa/domain";
import { ArtifactRepository, FoundationBootstrapRepository, PortableProjectRepository, ProjectRepository, WorkflowRepository,
  ConversationRepository, openDatabase, validateFoundationBootstrapDatabase, type FoundationBootstrapJob, type StoryDatabase } from "../src/index.js";
import { analysisFixture, completeFixture } from "./source-analysis-fixture.js";
import { deterministicFoundationBootstrapCandidate } from "../../../apps/server/src/services/foundation-bootstrap-provider.js";
import { PublicationExportService } from "../../../apps/server/src/services/publication-export-service.js";
import { RecoveryService } from "../../../apps/server/src/services/recovery-service.js";

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
function replan(f: Fixture, request = f.plan.context.request) {
  const context = structuredClone(f.plan.context);
  context.request = request;
  for (const artifactId of FOUNDATION_ARTIFACT_IDS) {
    const current = f.artifacts.getCurrent(f.projectId, artifactId);
    context.baseVersionIds[artifactId] = current?.id ?? null; Object.assign(context.baseArtifacts, { [artifactId]: current?.content ?? null });
  }
  const intent = f.artifacts.getCurrent(f.projectId, "adaptation-intent")!;
  context.intentVersionId = intent.id; context.intent = intent.content as typeof context.intent;
  const contextFingerprint = sourceDigest(context), contextBytes = Buffer.byteLength(sourceCanonicalJson(context));
  f.plan = f.repository.savePlan({ ...f.plan, id: randomUUID(), context, contextFingerprint, contextBytes, estimatedInputTokens: Math.ceil(contextBytes / 4),
    fingerprint: sourceDigest({ contextFingerprint, units: f.plan.units, providerId: context.providerId, modelId: context.modelId }) });
  return f.plan;
}
function directionProvenance(f: Fixture, kind: "migration-derived" | "user-message") {
  let reference: { kind: typeof kind; targetId: string; versionId?: string; excerpt?: string } = { kind, targetId: "brief", versionId: f.plan.context.baseVersionIds.brief! };
  if (kind === "user-message") {
    const conversations = new ConversationRepository(f.database), scope = { kind: "project" as const, projectId: f.projectId };
    const conversation = conversations.create(f.projectId, scope, "Setup", "setup");
    const message = conversations.addMessage({ conversationId: conversation.id, role: "user", content: "Keep a quiet tone.", intent: "discuss", scope, context: {}, metadata: {} });
    reference = { kind, targetId: message.id, excerpt: message.content };
  }
  f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "creative-direction", content: normalizeCreativeDirection({ ...defaultCreativeDirection(), fieldProvenance: [{ fieldPath: "/tone", reference }] }) });
  replan(f);
}
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
  it.each(["invented", "contradictory"])("rejects an appended %s sentence under genuine source-canon provenance", (kind) => {
    const f = fixture(), job = running(f), candidate = deterministicFoundationBootstrapCandidate(f.plan.context);
    candidate.artifacts.bible.canonFacts[0]!.statement += kind === "invented" ? "\nAlex rules the moon." : "\nAlex does not exist.";
    expect(() => f.repository.finish(f.projectId, job.id, job.units[0].attempts[0]!.id, "completed", candidate)).toThrow("bootstrap_canon_fact_ungrounded");
    expect(f.repository.getJob(f.projectId, job.id)).toEqual(job);
    expect(() => apply(f, job.id)).toThrow("bootstrap_candidate_missing");
    expect(f.artifacts.getCurrent(f.projectId, "bible")).toBeUndefined();
  });
  it("requires every independent active override outside canon obligations and carries them downstream", () => {
    const f = fixture(), intent = structuredClone(f.plan.context.intent);
    const target = f.plan.context.dossier.records.find((record) => record.status === "supported" && !intent.obligations.some((obligation) => obligation.targetIds.includes(record.id)))!;
    const common = { scope: "project", rationale: "Reviewed author policy", provenance: { origin: "manual" as const, projectId: f.projectId }, authority: "author-override" as const, targetIds: [target.id], active: true, reviewed: true };
    intent.overrides = [{ ...common, id: "occupation", aspect: "occupation", effect: "Alex is a librarian and has never sailed." },
      { ...common, id: "memory", aspect: "memory", effect: "Alex remembers every visitor." }];
    intent.revision = { kind: "manual", previousVersionId: f.plan.context.intentVersionId };
    const version = f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "adaptation-intent", content: normalizeAdaptationIntent(intent) });
    f.workflow.approve(f.projectId, "adaptation-intent", version.id); replan(f);
    const job = running(f), candidate = deterministicFoundationBootstrapCandidate(f.plan.context);
    for (const override of intent.overrides) {
      const forged = structuredClone(candidate), entry = forged.provenance.find((entry) => entry.overrideIds.includes(override.id))!;
      const index = Number(entry.fieldPath.split("/")[2]);
      forged.artifacts.bible.adaptationOpportunities[index]!.description = "The old source account is unchanged.";
      expect(() => f.repository.finish(f.projectId, job.id, job.units[0].attempts[0]!.id, "completed", forged)).toThrow("bootstrap_active_override_ungrounded");
    }
    const omitted = structuredClone(candidate);
    omitted.artifacts.bible.adaptationOpportunities = [];
    omitted.provenance = omitted.provenance.filter((entry) => !entry.fieldPath.startsWith("/adaptationOpportunities/"));
    omitted.provenance.push({ artifactId: "bible", fieldPath: "/adaptationOpportunities", origin: "adaptation-only", sourceRecordIds: [], correctionIds: [], overrideIds: [], inventionIds: [], rationale: "Empty proposed adaptation opportunities." });
    expect(() => f.repository.finish(f.projectId, job.id, job.units[0].attempts[0]!.id, "completed", omitted)).toThrow("bootstrap_active_override_ungrounded");
    f.repository.finish(f.projectId, job.id, job.units[0].attempts[0]!.id, "completed", candidate); apply(f, job.id);
    for (const id of FOUNDATION_ARTIFACT_IDS) f.workflow.approve(f.projectId, id, f.artifacts.getCurrent(f.projectId, id)!.id);
    expect(f.artifacts.foundationAuthority(f.projectId)?.activeOverrides).toEqual(f.plan.context.intent.overrides);
  });
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
  it("recovers pending work after a crash before dispatch without blocking a new explicit start", () => {
    const f = fixture(), pending = f.repository.createJob(f.projectId, f.plan.id, f.plan.fingerprint);
    f.repository.recoverInterrupted();
    expect(f.repository.getJob(f.projectId, pending.id)).toMatchObject({ status: "cancelled", units: [{ attempts: [] }] });
    expect(f.repository.createJob(f.projectId, f.plan.id, f.plan.fingerprint).status).toBe("pending");
  });
  it.each(["completed", "failed"] as const)("SQL rejects pending -> %s with no real running attempt", (outcome) => {
    const f = fixture(), job = f.repository.createJob(f.projectId, f.plan.id, f.plan.fingerprint), changed = structuredClone(job);
    changed.status = changed.units[0].status = outcome;
    expect(() => rewrite(f, changed)).toThrow("lifecycle is invalid");
  });
  it("SQL forbids appending a terminal synthetic retry without pending and running transitions", () => {
    const f = fixture(), job = running(f), failed = f.repository.finish(f.projectId, job.id, job.units[0].attempts[0]!.id, "failed", undefined, "provider_failed");
    const forged = structuredClone(failed); forged.units[0].attempts.push({ ...forged.units[0].attempts[0]!, id: "forged", number: 2 });
    expect(() => rewrite(f, forged)).toThrow("lifecycle is invalid");
  });
  it("SQL cannot settle a running attempt as failed while claiming unit cancellation", () => {
    const f = fixture(), job = running(f), changed = structuredClone(job);
    changed.status = changed.units[0].status = "cancelled";
    Object.assign(changed.units[0].attempts[0]!, { status: "failed", finishedAt: new Date().toISOString() });
    expect(() => rewrite(f, changed)).toThrow("lifecycle is invalid");
  });
});

describe("Foundation bootstrap atomic application and recovery", () => {
  it.each(["before-generation", "applied"])("preserves valid unsorted material through portable import and backup restore at %s", async (stage) => {
    for (const conversational of [false, true]) {
      const f = fixture();
      if (conversational) directionProvenance(f, "user-message");
      const direction = structuredClone(f.artifacts.getCurrent<ReturnType<typeof defaultCreativeDirection>>(f.projectId, "creative-direction")?.content ?? defaultCreativeDirection());
      direction.tone.descriptors = ["restrained", "quiet"];
      Object.assign(direction, creativeDirectionFingerprints(direction));
      const version = f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "creative-direction", content: direction }); replan(f);
      if (stage === "applied") apply(f, completed(f).id);
      const portable = new PortableProjectRepository(f.database), bundle = portable.exportRows(f.projectId), target = database();
      const exportedVersion = JSON.parse(String(bundle.tables.artifact_versions.find((row) => row.id === version.id)!.content_json));
      const exportedPlan = JSON.parse(String(bundle.tables.foundation_bootstrap_plans.find((row) => row.id === f.plan.id)!.content_json));
      expect(exportedVersion.tone.descriptors).toEqual(["restrained", "quiet"]);
      expect(exportedPlan.context.baseArtifacts["creative-direction"]).toEqual(exportedVersion);
      new PortableProjectRepository(target).importRows(bundle, validateFoundationBootstrapDatabase);
      expect(new PortableProjectRepository(target).exportRows(f.projectId)).toEqual(bundle);
      expect(f.artifacts.getVersion(version.id)!.content).toEqual(direction);
      const publication = new PublicationExportService(portable, undefined);
      const backup = await new RecoveryService(f.database, portable, publication, { applicationVersion: "A5-rereview" }).createVerifiedBackup(f.projectId);
      expect(backup.record.verificationStatus).toBe("verified");
      const restored = database(), restoredPortable = new PortableProjectRepository(restored);
      await new RecoveryService(restored, restoredPortable, new PublicationExportService(restoredPortable, undefined), { applicationVersion: "A5-rereview" }).restoreBackup(backup.bytes);
      expect(restoredPortable.exportRows(f.projectId)).toEqual(bundle);
    }
  }, 30_000);
  it("does not heal a forged original plan fingerprint while resealing portable conversation evidence", () => {
    const f = fixture(); directionProvenance(f, "user-message");
    const forged = { ...f.plan, id: randomUUID(), contextFingerprint: "a".repeat(64) };
    f.database.prepare("INSERT INTO foundation_bootstrap_plans VALUES(?,?,?)").run(forged.id, f.projectId, JSON.stringify(forged));
    expect(() => new PortableProjectRepository(f.database).exportRows(f.projectId)).toThrow("bootstrap_plan_fingerprint_invalid");
  });
  it.each(["migration-derived", "user-message"] as const)("duplicates unapplied/partially applied bundles with real %s direction provenance", (kind) => {
    for (const partial of [false, true]) {
      const f = fixture(); directionProvenance(f, kind); const job = completed(f);
      if (partial) apply(f, job.id, ["brief"]);
      const copy = f.projects.duplicate(f.projectId); f.projects.remove(f.projectId);
      validateFoundationBootstrapDatabase(f.database, copy.id);
      const repository = new FoundationBootstrapRepository(f.database), copied = repository.listJobs(copy.id)[0]!;
      const direction = repository.candidate(copy.id, copied.id).candidate.artifacts["creative-direction"];
      expect(direction.fieldProvenance).toHaveLength(1);
      const originalReference = f.plan.context.baseArtifacts["creative-direction"]!.fieldProvenance[0]!.reference!;
      if (kind === "migration-derived") expect(direction.fieldProvenance[0]!.reference?.versionId).not.toBe(originalReference.versionId);
      else expect(direction.fieldProvenance[0]!.reference?.targetId).not.toBe(originalReference.targetId);
      const remaining = FOUNDATION_ARTIFACT_IDS.filter((id) => !repository.appliedVersions(copy.id, copied.id)[id]);
      const preview = repository.previewApply(copy.id, copied.id, remaining); repository.apply(copy.id, copied.id, preview.effectiveArtifactIds, preview.previewFingerprint);
      validateFoundationBootstrapDatabase(f.database, copy.id);
    }
  });
  it("round-trips four partial applications with equal timestamps and arbitrary serialized order", () => {
    const clock = vi.spyOn(Date.prototype, "toISOString").mockReturnValue("2026-10-04T00:00:00.000Z");
    try {
      const f = fixture(), job = completed(f); apply(f, job.id, ["brief"]); apply(f, job.id, ["creative-direction"]); apply(f, job.id, ["bible"]); apply(f, job.id, ["routes"]);
      const before = f.repository.applications(f.projectId, job.id), bundle = new PortableProjectRepository(f.database).exportRows(f.projectId);
      bundle.tables.foundation_bootstrap_applications.reverse();
      const target = database(); new PortableProjectRepository(target).importRows(bundle, validateFoundationBootstrapDatabase);
      expect(new FoundationBootstrapRepository(target).applications(f.projectId, job.id)).toEqual(before);
      expect(new PortableProjectRepository(target).exportRows(f.projectId)).toEqual(new PortableProjectRepository(f.database).exportRows(f.projectId));
      const forged = structuredClone(bundle); const row = forged.tables.foundation_bootstrap_applications[0]!;
      row.content_json = JSON.stringify({ ...JSON.parse(String(row.content_json)), fingerprint: "a".repeat(64) });
      expect(() => new PortableProjectRepository(database()).importRows(forged, validateFoundationBootstrapDatabase)).toThrow("bootstrap_application_sequence_invalid");
    } finally { clock.mockRestore(); }
  });
  it.each(["before-generation", "pending-review", "applied"])("round-trips conversational direction and verified backup at %s", async (stage) => {
    const f = fixture(); directionProvenance(f, "user-message");
    const before = new ArtifactRepository(f.database).getCurrent(f.projectId, "creative-direction")!;
    let job: FoundationBootstrapJob | undefined;
    if (stage !== "before-generation") job = completed(f);
    if (stage === "applied") { apply(f, job!.id, ["brief"]); apply(f, job!.id, ["creative-direction"]); apply(f, job!.id, ["bible"]); apply(f, job!.id, ["routes"]); }
    const portable = new PortableProjectRepository(f.database), bundle = portable.exportRows(f.projectId), target = database();
    new PortableProjectRepository(target).importRows(bundle, validateFoundationBootstrapDatabase);
    expect(new ArtifactRepository(f.database).getVersion(before.id)?.content).toEqual(before.content);
    const imported = new ArtifactRepository(target).getVersion<ReturnType<typeof defaultCreativeDirection>>(before.id)!;
    expect(imported.content.materialFingerprint).toBe((before.content as ReturnType<typeof defaultCreativeDirection>).materialFingerprint);
    expect(imported.content.fieldProvenance[0]!.reference?.unavailable).toBe(true);
    expect(target.prepare("SELECT id FROM messages").all()).toEqual([]);
    const publication = new PublicationExportService(portable, undefined), recovery = new RecoveryService(f.database, portable, publication, { applicationVersion: "A5-review" });
    const backup = await recovery.createVerifiedBackup(f.projectId); expect(backup.record.verificationStatus).toBe("verified");
    const restored = database(), restoredPortable = new PortableProjectRepository(restored), restoredPublication = new PublicationExportService(restoredPortable, undefined);
    await new RecoveryService(restored, restoredPortable, restoredPublication, { applicationVersion: "A5-review" }).restoreBackup(backup.bytes);
    validateFoundationBootstrapDatabase(restored, f.projectId);
    expect(restoredPortable.exportRows(f.projectId)).toEqual(bundle);
    if (job && stage === "pending-review") {
      const repository = new FoundationBootstrapRepository(restored), preview = repository.previewApply(f.projectId, job.id, [...FOUNDATION_ARTIFACT_IDS]);
      repository.apply(f.projectId, job.id, preview.effectiveArtifactIds, preview.previewFingerprint);
    }
  }, 30_000);
  it("reuses equivalent previews and archives only unused previews to recover at the bounded cache limit", () => {
    const f = fixture(), initial = f.plan;
    expect(replan(f).id).toBe(initial.id); expect(f.repository.listPlans(f.projectId)).toHaveLength(1);
    const job = completed(f); apply(f, job.id, ["brief"]);
    const artifactsBefore = f.artifacts.listVersions(f.projectId, "brief"), applicationsBefore = f.repository.applications(f.projectId, job.id);
    for (let i = 0; i < 64; i++) replan(f, `Preview ${i}`);
    expect(() => replan(f, "Overflow")).toThrow("bootstrap_preview_budget_exceeded_archive_unused_previews");
    f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "brief", content: defaultProjectBrief("Fresh author work") });
    expect(() => f.repository.createJob(f.projectId, f.plan.id, f.plan.fingerprint)).toThrow("bootstrap_base_stale");
    const archive = f.repository.archiveUnusedPreviews(f.projectId); expect(archive.plans).toHaveLength(64);
    expect(archive.plans.some((plan) => plan.id === initial.id)).toBe(false);
    expect(() => f.repository.retireUnusedPreviews(f.projectId, "a".repeat(64))).toThrow("bootstrap_preview_archive_stale");
    expect(f.repository.retireUnusedPreviews(f.projectId, archive.fingerprint)).toEqual({ retired: 64 });
    const fresh = replan(f, "Fresh reviewed request"); expect(f.repository.createJob(f.projectId, fresh.id, fresh.fingerprint).status).toBe("pending");
    expect(f.artifacts.listVersions(f.projectId, "brief").slice(1)).toEqual(artifactsBefore);
    expect(f.repository.applications(f.projectId, job.id)).toEqual(applicationsBefore);
    expect(() => f.database.prepare("DELETE FROM foundation_bootstrap_plans WHERE id=?").run(initial.id)).toThrow("immutable");
    expect(archive.fingerprint).toBe(sourceDigest({ projectId: f.projectId, plans: archive.plans }));
  }, 30_000);
  it("keeps honestly blocked required obligations reviewable but does not restore AI passage authority", () => {
    const f = fixture(), job = running(f), candidate = deterministicFoundationBootstrapCandidate(f.plan.context);
    candidate.canonAssessment[0] = { ...candidate.canonAssessment[0]!, status: "blocked", routeIds: [], actIds: [], endingIds: [], structuralEvidence: [], rationale: "Required identity needs structural placement." };
    f.repository.finish(f.projectId, job.id, job.units[0].attempts[0]!.id, "completed", candidate); apply(f, job.id);
    for (const id of FOUNDATION_ARTIFACT_IDS) f.workflow.approve(f.projectId, id, f.artifacts.getCurrent(f.projectId, id)!.id);
    expect(f.artifacts.foundationAuthority(f.projectId, false)).toBeDefined();
    expect(() => f.artifacts.foundationAuthority(f.projectId)).toThrow("bootstrap_approved_compatible_foundations_required");
  });
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
  it("closes scoped Creative Direction over the actual new Bible rather than storing dangling references", () => {
    const f = fixture(), job = running(f), candidate = deterministicFoundationBootstrapCandidate(f.plan.context);
    candidate.artifacts.bible = LongFormStoryBibleSchema.parse({ ...candidate.artifacts.bible, characters: [{ id: "mira", name: "Mira" }] });
    candidate.artifacts["creative-direction"] = normalizeCreativeDirection({ ...candidate.artifacts["creative-direction"], scopedVariations: [{ id: "mira-voice", scopeKind: "character", scopeId: "mira" }] });
    const provenance = new Map(candidate.provenance.map((item) => [`${item.artifactId}:${item.fieldPath}`, item]));
    candidate.provenance = FOUNDATION_ARTIFACT_IDS.flatMap((artifactId) => foundationFieldPaths(candidate.artifacts[artifactId]).map((fieldPath) => provenance.get(`${artifactId}:${fieldPath}`)
      ?? { artifactId, fieldPath, origin: "adaptation-only" as const, sourceRecordIds: [], correctionIds: [], overrideIds: [], inventionIds: [], rationale: "Reviewed new adaptation field." }));
    f.repository.finish(f.projectId, job.id, job.units[0].attempts[0]!.id, "completed", candidate);
    const preview = f.repository.previewApply(f.projectId, job.id, ["creative-direction"]);
    expect(preview.effectiveArtifactIds).toEqual(["brief", "creative-direction", "bible"]);
    expect(() => f.repository.apply(f.projectId, job.id, ["creative-direction"], preview.previewFingerprint)).toThrow("bootstrap_apply_selection_or_preview_invalid");
    f.repository.apply(f.projectId, job.id, preview.effectiveArtifactIds, preview.previewFingerprint);
    expect(f.artifacts.getCurrent(f.projectId, "bible")!.content).toEqual(candidate.artifacts.bible);
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
  it("duplicates multiple partial applications with independently recomputed exact audit fingerprints", () => {
    const f = fixture(), job = completed(f); apply(f, job.id, ["brief"]); apply(f, job.id, ["bible"]); apply(f, job.id, ["routes"]);
    const copy = f.projects.duplicate(f.projectId); f.projects.remove(f.projectId); validateFoundationBootstrapDatabase(f.database, copy.id);
    const repository = new FoundationBootstrapRepository(f.database), copied = repository.listJobs(copy.id)[0]!;
    expect(repository.applications(copy.id, copied.id)).toHaveLength(3); expect(Object.keys(repository.appliedVersions(copy.id, copied.id))).toHaveLength(6);
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
