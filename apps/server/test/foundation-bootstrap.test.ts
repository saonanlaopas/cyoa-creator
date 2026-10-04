import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FOUNDATION_ARTIFACT_IDS, FOUNDATION_BOOTSTRAP_LIMITS, ProjectBriefSchema, defaultCreativeDirection, newAdaptationIntent, normalizeAdaptationIntent, type SourceDossier } from "@story-to-cyoa/domain";
import { ArtifactRepository, WorkflowRepository, openDatabase } from "@story-to-cyoa/persistence";
import { analysisFixture, completeFixture } from "../../../packages/persistence/test/source-analysis-fixture.js";
import { buildApp } from "../src/app.js";
import { createOfflineSetupClient } from "../src/services/offline-setup-provider.js";
import { DeterministicFoundationBootstrapProvider, deterministicFoundationBootstrapCandidate } from "../src/services/foundation-bootstrap-provider.js";
import { assertPassageFidelityAuthority } from "../src/services/adaptation-passage-authority.js";

const apps: ReturnType<typeof buildApp>[] = [], directories: string[] = [];
afterEach(async () => { vi.useRealTimers(); for (const app of apps.splice(0)) await app.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture(provider = new DeterministicFoundationBootstrapProvider(), existingDirection = true) {
  const directory = mkdtempSync(join(tmpdir(), "cyoa-a5-server-")); directories.push(directory); const path = join(directory, "project.sqlite");
  const f = analysisFixture(openDatabase(path)); completeFixture(f);
  const dossier = f.artifacts.getCurrent<SourceDossier>(f.projectId, "source-dossier")!, workflow = new WorkflowRepository(f.database);
  workflow.approve(f.projectId, "source-dossier", dossier.id);
  const record = dossier.content.records.find((item) => item.status === "supported" && item.category === "character")!;
  const intent = normalizeAdaptationIntent({ ...newAdaptationIntent(f.projectId, { dossierVersionId: dossier.id, dossierMaterialFingerprint: dossier.content.materialFingerprint, source: dossier.content.binding }), preserveCanonRoute: true,
    obligations: [{ id: "source-identity", scope: "project", rationale: "Keep the source character identity", provenance: { origin: "manual", projectId: f.projectId }, kind: "character-state", status: "requested", targetIds: [record.id], evidence: record.evidence, requirement: "Request the source character identity", strength: "required", transformations: ["change-delivery"] }] });
  const saved = f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "adaptation-intent", content: intent }); workflow.approve(f.projectId, "adaptation-intent", saved.id);
  f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "brief", content: ProjectBriefSchema.parse({ workingTitle: "Harbor adaptation" }) });
  if (existingDirection) f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "creative-direction", content: defaultCreativeDirection() });
  f.database.close();
  const app = buildApp({ databasePath: path, foundationBootstrapProvider: provider, openRouterClient: createOfflineSetupClient() }); apps.push(app);
  const projectId = f.projectId, project = `/api/long-form/projects/${projectId}`, root = `${project}/foundation-bootstrap`;
  const call = (suffix: string, payload?: unknown) => app.inject({ method: payload === undefined ? "GET" : "POST", url: root + suffix, ...(payload === undefined ? {} : { payload }) });
  return { app, path, provider, projectId, project, root, call };
}
type Fixture = ReturnType<typeof fixture>;
async function preview(f: Fixture) {
  const response = await f.call("/preview", { message: "Create draft foundations from this exact reviewed source and intent", providerId: f.provider.id, modelId: "offline-foundation-v1" });
  expect(response.statusCode, response.body).toBe(200); return response.json();
}
async function start(f: Fixture) { const plan = await preview(f), response = await f.call("/start", { planId: plan.id, fingerprint: plan.fingerprint }); expect(response.statusCode, response.body).toBe(200); return { plan, job: response.json() }; }
async function terminal(f: Fixture, id: string) {
  let job: any;
  await vi.waitFor(async () => { job = (await f.call(`/jobs/${id}`)).json(); expect(["completed", "failed", "cancelled"]).toContain(job.status); }, { timeout: 5000, interval: 10 });
  return job;
}
function blocker() {
  let release!: (raw: string) => void;
  const provider = new DeterministicFoundationBootstrapProvider({ respond: () => new Promise((resolve) => { release = resolve; }) });
  return { provider, release: () => release(JSON.stringify(deterministicFoundationBootstrapCandidate(provider.calls[0]!.context))) };
}
async function assertNoFoundationWrite(f: Fixture, before: any) {
  const after = (await f.app.inject({ url: f.project })).json();
  for (const id of ["brief", "creativeDirection", "bible", "routes", "endings", "mechanics"]) expect(after[id]).toEqual(before[id]);
  expect((await f.app.inject({ url: `${f.project}/passage-plan` })).json().passages).toEqual([]);
}

describe("A5 exact foundation generation and review boundary", () => {
  it("reuses exact previews and retires only the explicitly archived unused selection without provider use", async () => {
    const f = fixture(), first = await preview(f), repeated = await preview(f);
    expect(repeated.id).toBe(first.id); expect((await f.call("")).json().plans).toHaveLength(1);
    const archive = (await f.call("/preview-history/archive")).json();
    expect(archive.plans).toHaveLength(1); expect(f.provider.calls).toHaveLength(0);
    expect((await f.call("/preview-history/retire", { fingerprint: archive.fingerprint, archiveSaved: false })).statusCode).toBe(400);
    const changed = await f.call("/preview", { message: "An independent second preview", providerId: f.provider.id, modelId: "offline-foundation-v1" });
    expect(changed.statusCode).toBe(200);
    expect((await f.call("/preview-history/retire", { fingerprint: archive.fingerprint, archiveSaved: true })).statusCode).toBe(409);
    const current = (await f.call("/preview-history/archive")).json();
    expect((await f.call("/preview-history/retire", { fingerprint: current.fingerprint, archiveSaved: true })).json()).toEqual({ retired: 2 });
    expect((await f.call("")).json().plans).toEqual([]); expect(f.provider.calls).toHaveLength(0);
    const started = await start(f); await terminal(f, started.job.id);
    expect((await f.call("/preview-history/archive")).json().plans).toEqual([]);
    expect((await f.call("")).json().jobs).toHaveLength(1);
  });
  it.each([true, false])("generates all six ordinary unapproved drafts with existing Creative Direction=%s", async (existingDirection) => {
    const f = fixture(undefined, existingDirection), before = (await f.app.inject({ url: f.project })).json();
    expect((await f.call("")).json().availability.allowed).toBe(true);
    const plan = await preview(f); expect(f.provider.calls).toHaveLength(0);
    expect(plan.context.baseVersionIds["creative-direction"]).toBe(existingDirection ? before.creativeDirection.id : null);
    const rejected = await f.call("/start", { planId: plan.id, fingerprint: "incorrect" }); expect(rejected.statusCode).toBeGreaterThanOrEqual(400); expect(f.provider.calls).toHaveLength(0);
    const started = (await f.call("/start", { planId: plan.id, fingerprint: plan.fingerprint })).json(), job = await terminal(f, started.id); expect(job.status).toBe("completed");
    await assertNoFoundationWrite(f, before);
    const reviewResponse = await f.call(`/jobs/${job.id}/review`); expect(reviewResponse.statusCode, reviewResponse.body).toBe(200); const review = reviewResponse.json();
    expect(review.candidates.map((item: any) => item.artifactId).sort()).toEqual([...FOUNDATION_ARTIFACT_IDS].sort());
    expect(review.canonAssessment).toHaveLength(1); expect(review.canonAssessment[0].status).toBe("pending-passage-validation");
    expect(review.canonAssessment[0].routeIds.length).toBeGreaterThan(0); expect(review.canonAssessment[0].actIds.length).toBeGreaterThan(0); expect(review.canonAssessment[0].endingIds.length).toBeGreaterThan(0);
    expect(review.candidates.every((item: any) => item.provenance.length > 0)).toBe(true);
    const application = await f.call(`/jobs/${job.id}/preview-apply`, { artifactIds: ["routes"] }); expect(application.statusCode, application.body).toBe(200);
    expect(application.json().effectiveArtifactIds.sort()).toEqual([...FOUNDATION_ARTIFACT_IDS].sort());
    const incomplete = await f.call(`/jobs/${job.id}/apply`, { artifactIds: ["routes"], fingerprint: application.json().previewFingerprint }); expect(incomplete.statusCode).toBe(409);
    const applied = await f.call(`/jobs/${job.id}/apply`, { artifactIds: application.json().effectiveArtifactIds, fingerprint: application.json().previewFingerprint }); expect(applied.statusCode, applied.body).toBe(200); expect(f.provider.calls).toHaveLength(1);
    const state = (await f.app.inject({ url: f.project })).json();
    for (const id of FOUNDATION_ARTIFACT_IDS) { expect(state.workflow[id].status).toBe("draft"); expect(state.workflow[id].approvedVersionId).toBeNull(); }
    expect((await f.app.inject({ url: `${f.project}/passage-plan` })).json().structure).toBeNull(); expect((await f.app.inject({ url: `${f.project}/drafts/review-queue` })).json().items).toEqual([]);
    for (const id of ["creative-direction", "brief", "bible", "routes", "endings", "mechanics"] as const) {
      const artifact = state[id === "creative-direction" ? "creativeDirection" : id];
      const approved = await f.app.inject({ method: "POST", url: `${f.project}/${id}/approve`, payload: { versionId: artifact.id } }); expect(approved.statusCode, approved.body).toBeLessThan(300);
    }
    const passagePlan = await f.app.inject({ method: "POST", url: `${f.project}/passage-plan` }); expect(passagePlan.statusCode, passagePlan.body).toBe(201);
    const snapshot = (await f.app.inject({ method: "POST", url: `${f.project}/passage-plan/snapshots` })).json();
    const approvedPlan = await f.app.inject({ method: "POST", url: `${f.project}/passage-plan/approve`, payload: { snapshotId: snapshot.id } }); expect(approvedPlan.statusCode, approvedPlan.body).toBe(201);
    const sequenceId = passagePlan.json().structure.content.sequences[0].id;
    const generationPreview = await f.app.inject({ method: "POST", url: `${f.project}/passage-generation/plans/preview`, payload: { scope: { kind: "sequence", sequenceId }, providerId: "offline-kernel", modelId: "deterministic-fixture-v1" } });
    expect(generationPreview.statusCode, generationPreview.body).toBe(200); expect(f.provider.calls).toHaveLength(1);
    const context = generationPreview.json().units[0].context;
    expect(context.foundationAuthority.intentVersionId).toBe(plan.context.intentVersionId);
    expect(context.foundationAuthority.dossierVersionId).toBe(plan.context.dossierVersionId);
    expect(context.upstream.brief).not.toHaveProperty("adaptationFidelity");
    const db = openDatabase(f.path), artifacts = new ArtifactRepository(db);
    expect(() => assertPassageFidelityAuthority(artifacts, f.projectId, undefined, true)).toThrow("A5 foundation bootstrap");
    expect(assertPassageFidelityAuthority(artifacts, f.projectId, context.foundationAuthority, true)).toEqual(context.foundationAuthority);
    db.close();
    const created = await f.app.inject({ method: "POST", url: `${f.project}/passage-generation/plans`, payload: { scope: { kind: "sequence", sequenceId }, providerId: "offline-kernel", modelId: "deterministic-fixture-v1" } });
    expect(created.statusCode, created.body).toBe(201);
    const generated = created.json();
    expect((await f.app.inject({ method: "POST", url: `${f.project}/passage-generation/plans/${generated.id}/authorize`, payload: { fingerprint: generated.fingerprint } })).statusCode).toBe(200);
    expect((await f.app.inject({ method: "POST", url: `${f.project}/passage-generation/jobs/${generated.jobId}/start` })).statusCode).toBe(202);
    await vi.waitFor(async () => expect((await f.app.inject({ url: `${f.project}/passage-generation/jobs/${generated.jobId}` })).json().status).toBe("completed"));
    const intent = (await f.app.inject({ url: `${f.project}/adaptation-intent` })).json();
    expect((await f.app.inject({ method: "POST", url: `${f.project}/adaptation-intent/edit`, payload: { baseVersionId: intent.current.id, preset: "loose" } })).statusCode).toBe(200);
    const changedDb = openDatabase(f.path);
    expect(() => assertPassageFidelityAuthority(new ArtifactRepository(changedDb), f.projectId, context.foundationAuthority, true)).toThrow("A5 foundation bootstrap"); changedDb.close();
    expect((await f.call(`/jobs/${job.id}/review`)).json().currentState.status).toBe("stale");
  });

  it.each(["malformed", "oversized", "duplicate-id", "invalid-reference", "missing-provenance"])("rejects %s output without any canonical write", async (kind) => {
    const provider = new DeterministicFoundationBootstrapProvider({ respond: ({ context }) => {
      if (kind === "malformed") return "{malformed";
      if (kind === "oversized") return "x".repeat(FOUNDATION_BOOTSTRAP_LIMITS.outputBytes + 1);
      const candidate = deterministicFoundationBootstrapCandidate(context);
      if (kind === "duplicate-id") candidate.artifacts.routes.routes[1]!.id = candidate.artifacts.routes.routes[0]!.id;
      if (kind === "invalid-reference") candidate.artifacts.endings.endings[0]!.routeId = "unknown-route";
      if (kind === "missing-provenance") candidate.provenance.pop();
      return JSON.stringify(candidate);
    } });
    const f = fixture(provider), before = (await f.app.inject({ url: f.project })).json(), { job } = await start(f);
    expect((await terminal(f, job.id)).status).toBe("failed"); expect((await f.call(`/jobs/${job.id}/review`)).statusCode).toBeGreaterThanOrEqual(400); await assertNoFoundationWrite(f, before);
  });

  it("retries a failed unit with a distinct next attempt and preserves the failed history", async () => {
    let calls = 0;
    const provider = new DeterministicFoundationBootstrapProvider({ respond: ({ context }) => { if (++calls === 1) throw new Error("Temporary offline failure"); return JSON.stringify(deterministicFoundationBootstrapCandidate(context)); } });
    const f = fixture(provider), { job } = await start(f), failed = await terminal(f, job.id); expect(failed.status).toBe("failed");
    const retried = await f.call(`/jobs/${job.id}/retry`, {}); expect(retried.statusCode, retried.body).toBe(200);
    const completed = await terminal(f, job.id); expect(completed.status).toBe("completed"); expect(completed.units[0].attempts.map((attempt: any) => [attempt.number, attempt.status])).toEqual([[1, "failed"], [2, "completed"]]); expect(completed.units[0].attempts[0]).toEqual(failed.units[0].attempts[0]);
  });

  it("cancels an abort-ignoring provider and rejects late candidate settlement and cancelled retry", async () => {
    const held = blocker(), f = fixture(held.provider), before = (await f.app.inject({ url: f.project })).json(), { job } = await start(f);
    await vi.waitFor(() => expect(held.provider.calls).toHaveLength(1));
    const cancelled = await f.call(`/jobs/${job.id}/cancel`, {}); expect(cancelled.json().status).toBe("cancelled"); held.release();
    await new Promise((resolve) => setTimeout(resolve, 20)); expect((await f.call(`/jobs/${job.id}`)).json()).toEqual(cancelled.json()); expect((await f.call(`/jobs/${job.id}/retry`, {})).statusCode).toBeGreaterThanOrEqual(400);
    expect((await f.call(`/jobs/${job.id}/review`)).statusCode).toBeGreaterThanOrEqual(400); await assertNoFoundationWrite(f, before);
  });

  it.each(["intent", "dossier", "existing-direction", "absent-direction"])("rejects a provider race after %s mutation", async (kind) => {
    const held = blocker(), f = fixture(held.provider, kind !== "absent-direction"), { job } = await start(f);
    await vi.waitFor(() => expect(held.provider.calls).toHaveLength(1));
    if (kind === "intent") {
      const intent = (await f.app.inject({ url: `${f.project}/adaptation-intent` })).json();
      const updated = await f.app.inject({ method: "POST", url: `${f.project}/adaptation-intent/edit`, payload: { baseVersionId: intent.current.id, preset: "loose" } }); expect(updated.statusCode, updated.body).toBe(200);
    } else if (kind === "dossier") {
      const db = openDatabase(f.path), artifacts = new ArtifactRepository(db), current = artifacts.getCurrent<SourceDossier>(f.projectId, "source-dossier")!;
      expect(current).toBeTruthy(); new WorkflowRepository(db).markDraft(f.projectId, "source-dossier"); db.close();
    } else {
      if (kind === "absent-direction") {
        const adopted = await f.app.inject({ method: "POST", url: `${f.project}/creative-direction/adopt-legacy`, payload: {} }); expect(adopted.statusCode, adopted.body).toBe(201);
      }
      const content = defaultCreativeDirection(); content.tone.customGuidance = "A newly reviewed presentation request";
      const updated = await f.app.inject({ method: "PUT", url: `${f.project}/creative-direction`, payload: content }); expect(updated.statusCode, updated.body).toBe(201);
    }
    const before = (await f.app.inject({ url: f.project })).json(); held.release();
    const failed = await terminal(f, job.id); expect(failed.status).toBe("failed"); expect(failed.units[0].attempts[0].diagnostic).toBe("stale"); await assertNoFoundationWrite(f, before);
  });

  it("rejects stale candidate Apply after a previously absent artifact appears", async () => {
    const f = fixture(undefined, false), { job } = await start(f); expect((await terminal(f, job.id)).status).toBe("completed");
    const application = (await f.call(`/jobs/${job.id}/preview-apply`, { artifactIds: ["routes"] })).json();
    expect((await f.app.inject({ method: "POST", url: `${f.project}/creative-direction/adopt-legacy`, payload: {} })).statusCode).toBe(201);
    const before = (await f.app.inject({ url: f.project })).json(), applied = await f.call(`/jobs/${job.id}/apply`, { artifactIds: ["routes"], fingerprint: application.previewFingerprint });
    expect(applied.statusCode).toBe(409); expect((await f.call(`/jobs/${job.id}/review`)).json().currentState.status).toBe("stale"); await assertNoFoundationWrite(f, before);
  });

  it("reopens a stopped job, safely retries, and ignores the old provider's late response", async () => {
    const held = blocker(), f = fixture(held.provider), { job } = await start(f); await vi.waitFor(() => expect(held.provider.calls).toHaveLength(1));
    await f.app.close(); apps.splice(apps.indexOf(f.app), 1);
    const provider = new DeterministicFoundationBootstrapProvider(), reopened = buildApp({ databasePath: f.path, foundationBootstrapProvider: provider, openRouterClient: createOfflineSetupClient() }); apps.push(reopened);
    const call = (path: string, payload?: unknown) => reopened.inject({ method: payload === undefined ? "GET" : "POST", url: f.root + path, ...(payload === undefined ? {} : { payload }) });
    expect((await call(`/jobs/${job.id}`)).json().status).toBe("failed");
    const retried = await call(`/jobs/${job.id}/retry`, {}); expect(retried.statusCode, retried.body).toBe(200);
    const completed = await terminal({ ...f, app: reopened, call }, job.id); expect(completed.status).toBe("completed");
    held.release(); await new Promise((resolve) => setTimeout(resolve, 20)); expect((await call(`/jobs/${job.id}`)).json()).toEqual(completed); expect(provider.calls).toHaveLength(1);
  });

  it("times out an abort-ignoring provider with no late candidate write", async () => {
    const held = blocker(), f = fixture(held.provider), before = (await f.app.inject({ url: f.project })).json(), plan = await preview(f);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const started = await f.call("/start", { planId: plan.id, fingerprint: plan.fingerprint }); expect(started.statusCode, started.body).toBe(200);
      const job = started.json(); await vi.waitFor(() => expect(held.provider.calls).toHaveLength(1));
      expect((await f.call(`/jobs/${job.id}`)).json().status).toBe("running");
      await vi.advanceTimersByTimeAsync(60_001);
      const failed = (await f.call(`/jobs/${job.id}`)).json(); expect(failed.status).toBe("failed"); expect(failed.units[0].attempts[0].status).toBe("failed");
      expect(held.provider.calls[0]!.signal.aborted).toBe(true);
      held.release(); await vi.advanceTimersByTimeAsync(10);
      expect((await f.call(`/jobs/${job.id}`)).json()).toEqual(failed);
      expect((await f.call(`/jobs/${job.id}/review`)).statusCode).toBeGreaterThanOrEqual(400); await assertNoFoundationWrite(f, before);
    } finally { vi.useRealTimers(); }
  });
  it("binds the exact reviewed author request and rejects unused setup pointer inputs", async () => {
    const f = fixture(), first = await preview(f);
    const second = (await f.call("/preview", { message: "A different reviewed generation decision", providerId: f.provider.id, modelId: "offline-foundation-v1" })).json();
    expect(second.contextFingerprint).not.toBe(first.contextFingerprint); expect(second.fingerprint).not.toBe(first.fingerprint);
    expect((await f.call("/start", { planId: second.id, fingerprint: first.fingerprint })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await f.call("/preview", { message: "Unused evidence", providerId: f.provider.id, modelId: "offline-foundation-v1", setup: { conversationId: "unused" } })).statusCode).toBe(400);
    expect(f.provider.calls).toHaveLength(0);
  });
});
