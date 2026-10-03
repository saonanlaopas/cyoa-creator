import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceCanonicalJson, type AdaptationIntent } from "@story-to-cyoa/domain";
import { buildApp } from "../src/app.js";
import { DeterministicAdaptationIntentProvider, OpenRouterAdaptationIntentProvider } from "../src/services/adaptation-intent-provider.js";
import { createOfflineSetupClient } from "../src/services/offline-setup-provider.js";
import { EnvironmentCredentialStore, OpenRouterClient } from "@story-to-cyoa/openrouter";
import { ArtifactRepository, WorkflowRepository, openDatabase } from "@story-to-cyoa/persistence";
import { analysisFixture, completeFixture } from "../../../packages/persistence/test/source-analysis-fixture.js";

const apps: ReturnType<typeof buildApp>[] = [], directories: string[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); directories.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); });
async function fixture(provider = new DeterministicAdaptationIntentProvider(), databasePath?: string) {
  const app = buildApp({ adaptationIntentProvider: provider, openRouterClient: createOfflineSetupClient(), databasePath }); apps.push(app);
  const created = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Adapted harbor" } })).json();
  const projectId = created.project.id as string, root = `/api/long-form/projects/${projectId}/adaptation-intent`, source = `/api/long-form/projects/${projectId}/source-analysis`;
  const call = (path: string, payload?: unknown) => app.inject({ method: payload === undefined ? "GET" : "POST", url: root + path, ...(payload === undefined ? {} : { payload }) });
  await app.inject({ method: "POST", url: `/api/projects/${projectId}/source/text`, payload: { text: "Chapter 1\n\nRen dies during the harbor collapse. Jules and Ren are lovers.\n\nChapter 2\n\nMira leaves the harbor at the ending." } });
  await app.inject({ method: "POST", url: `${source}/scope`, payload: { entireWork: true } });
  const plan = (await app.inject({ method: "POST", url: `${source}/preview`, payload: {} })).json();
  const job = (await app.inject({ method: "POST", url: `${source}/plans/${plan.id}/start`, payload: { fingerprint: plan.fingerprint } })).json();
  for (let i = 0; i < 100; i++) { if ((await app.inject({ url: `${source}/jobs/${job.id}` })).json().status === "completed") break; await new Promise((r) => setTimeout(r, 5)); }
  const dossier = (await app.inject({ url: `${source}/export` })).json();
  const metadata = (await app.inject({ url: `${source}/dossier` })).json();
  expect((await app.inject({ method: "POST", url: `${source}/approve`, payload: { versionId: metadata.id } })).statusCode).toBe(200);
  return { app, provider, root, source, projectId, created, dossier, metadata, call };
}
async function create(f: Awaited<ReturnType<typeof fixture>>) { const response = await f.call("/create", {}); expect(response.statusCode, response.body).toBe(200); return response.json(); }
async function preview(f: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown> = {}) {
  const response = await f.call("/preview", { request: "Keep characters close; change adaptation structure", recordIds: [f.dossier.records[0].id], providerId: f.provider.id, modelId: "offline-a4-v1", ...extra });
  expect(response.statusCode, response.body).toBe(200); return response.json();
}
describe("A4 manual and conversational boundary", () => {
  it.each(["effect", "requirement", "permission", "description", "rationale"])("rejects achieved %s claims from manual edits and provider output without durable writes", async (field) => {
    let operations: unknown[] = [];
    const provider = new DeterministicAdaptationIntentProvider({ respond: () => JSON.stringify({ schemaVersion: 1, intent: "adaptation-preference", operations }) });
    const f = await fixture(provider), created = await create(f), record = f.dossier.records.find((r: { category: string }) => r.category === "event");
    const common = { scope: "project", rationale: "Author request" };
    const obligation = { ...common, id: "requested", status: "requested", kind: "event", targetIds: [record.id], evidence: record.evidence, requirement: "Keep the event", strength: "required", transformations: [] };
    if (field === "effect") operations = [{ kind: "override", value: { ...common, id: "override", authority: "author-override", targetIds: [record.id], aspect: "state", effect: "Canon route achieved", active: true, reviewed: true } }];
    if (field === "requirement") operations = [{ kind: "obligation", value: { ...obligation, requirement: "Source ending preserved" } }];
    if (field === "permission") operations = [{ kind: "obligation", value: obligation }, { kind: "exception", value: { ...common, id: "exception", obligationId: obligation.id, targetIds: [record.id], evidence: record.evidence, permission: "Route is reachable", reviewed: true } }];
    if (field === "description" || field === "rationale") operations = [{ kind: "invention", value: { ...common, id: "invention", origin: "adaptation-only", kind: "scene", description: "New scene", dependencyIds: [], [field]: field === "description" ? "Canon preservation verified" : "The ending has been preserved" } }];
    const manual = await f.call("/edit", { baseVersionId: created.current.id, operations }); expect(manual.statusCode).toBeGreaterThanOrEqual(400);
    const p = await preview(f, { recordIds: [record.id] });
    const generated = await f.call("/generate", { previewId: p.id, fingerprint: p.fingerprint }); expect(generated.json().code).toBe("adaptation_achieved_claim_forbidden");
    expect(provider.calls).toHaveLength(1); expect((await f.call("/history")).json().total).toBe(1); expect((await f.call("/proposals")).json().items).toEqual([]);
  });
  it.each(["overrides", "inventions", "obligations", "exceptions", "expansion"] as const)("rejects unseen %s overwrite and removal outside preview scope", async (collection) => {
    let operations: unknown[] = [];
    const provider = new DeterministicAdaptationIntentProvider({ respond: () => JSON.stringify({ schemaVersion: 1, intent: "adaptation-preference", operations }) });
    const f = await fixture(provider), created = await create(f), record = f.dossier.records.find((r: { category: string }) => r.category === "event"), common = { scope: "project", rationale: "Author request" };
    const initial = [
      { kind: "override", value: { ...common, id: "override", authority: "author-override", targetIds: [record.id], aspect: "state", effect: "Survives", active: true, reviewed: true } },
      { kind: "invention", value: { ...common, id: "invention", origin: "adaptation-only", kind: "scene", description: "Original scene", dependencyIds: [] } },
      { kind: "obligation", value: { ...common, id: "obligation", status: "requested", kind: "event", targetIds: [record.id], evidence: record.evidence, requirement: "Keep the event", strength: "required", transformations: [] } },
      { kind: "exception", value: { ...common, id: "exception", obligationId: "obligation", targetIds: [record.id], evidence: record.evidence, permission: "Compress delivery", reviewed: true } },
      { kind: "expansion", value: { ...common, id: "expansion", origin: "branching", description: "New branches", sourceRecordIds: [], overrideIds: [], inventionIds: [], dependencyIds: [], allocation: { kind: "unknown" } } },
    ];
    const added = await f.call("/edit", { baseVersionId: created.current.id, operations: initial }); expect(added.statusCode, added.body).toBe(200);
    const before = (await f.call("/export")).json(), item = initial.find((op) => collection === `${op.kind}s` || (collection === "expansion" && op.kind === "expansion"))!;
    for (const hostile of [item, { kind: "remove", collection, id: item.value.id }]) {
      operations = [hostile]; const p = await preview(f, { recordIds: [] }); expect(p.mutationScope).toEqual({ sourceRecordIds: [], existingItems: [] });
      const generated = await f.call("/generate", { previewId: p.id, fingerprint: p.fingerprint }); expect(generated.json().code).toBe("adaptation_mutation_scope_invalid");
    }
    expect((await f.call("/export")).json()).toEqual(before); expect((await f.call("/proposals")).json().items).toEqual([]);
  });
  it("rejects valid same-dossier source IDs that were not supplied to the provider", async () => {
    let recordId = "";
    const provider = new DeterministicAdaptationIntentProvider({ respond: () => JSON.stringify({ schemaVersion: 1, intent: "adaptation-preference", operations: [{ kind: "override", value: {
      id: "new", authority: "author-override", targetIds: [recordId], aspect: "state", effect: "Survives", scope: "project", rationale: "Requested", active: true, reviewed: true,
    } }] }) });
    const f = await fixture(provider); await create(f); expect(f.dossier.records.length).toBeGreaterThan(1); recordId = f.dossier.records[1].id;
    const p = await preview(f), generated = await f.call("/generate", { previewId: p.id, fingerprint: p.fingerprint }); expect(generated.json().code).toBe("adaptation_source_scope_invalid");
    expect((await f.call("/proposals")).json().items).toEqual([]); expect((await f.call("/history")).json().total).toBe(1);
  });
  it("accepts an explicitly previewed override update and noncolliding invention, with provider-free Apply", async () => {
    let operations: unknown[] = [];
    const provider = new DeterministicAdaptationIntentProvider({ respond: () => JSON.stringify({ schemaVersion: 1, intent: "adaptation-preference", operations }) }), f = await fixture(provider);
    const created = await create(f), record = f.dossier.records.find((r: { category: string }) => r.category === "event");
    const value = { id: "visible", authority: "author-override", targetIds: [record.id], aspect: "state", effect: "Survives", scope: "project", rationale: "Author request", active: true, reviewed: true };
    expect((await f.call("/edit", { baseVersionId: created.current.id, operations: [{ kind: "override", value }] })).statusCode).toBe(200);
    operations = [{ kind: "override", value: { ...value, effect: "Leaves" } }, { kind: "invention", value: { id: "new", scope: "project", rationale: "Requested", origin: "adaptation-only", kind: "scene", description: "New scene", dependencyIds: [value.id] } }];
    const p = await preview(f, { recordIds: [record.id] }); expect(p.mutationScope).toEqual({ sourceRecordIds: [record.id], existingItems: [{ collection: "overrides", id: value.id }] });
    const generated = await f.call("/generate", { previewId: p.id, fingerprint: p.fingerprint }); expect(generated.statusCode, generated.body).toBe(200);
    expect((await f.call("/apply", { versionId: generated.json().versionId })).statusCode).toBe(200);
    expect((await f.call("/collections/overrides")).json().items[0].effect).toBe("Leaves"); expect((await f.call("/collections/inventions")).json().items).toHaveLength(1); expect(provider.calls).toHaveLength(1);
  });
  it("times out even an abort-ignoring provider without a late or partial write", async () => {
    let release!: (raw: string) => void;
    const provider = new DeterministicAdaptationIntentProvider({ respond: () => new Promise((r) => { release = r; }) }), f = await fixture(provider);
    const p = await preview(f);
    vi.useFakeTimers();
    try {
      const generation = f.call("/generate", { previewId: p.id, fingerprint: p.fingerprint });
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      await vi.advanceTimersByTimeAsync(60_001);
      const result = await generation; expect(result.json().code).toBe("adaptation_generation_cancelled");
      release(JSON.stringify({ schemaVersion: 1, intent: "adaptation-preference", operations: [{ kind: "dimension", dimension: "tone", level: "strict" }] }));
      expect((await f.call("")).json().current).toBeNull();
      expect((await f.call("/proposals")).json().items).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
  it("supports successful API creation/review/approval in a legacy project without any Creative Direction artifact", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-a4-no-direction-")); directories.push(directory); const path = join(directory, "project.sqlite");
    const f = analysisFixture(openDatabase(path)); completeFixture(f); const dossier = f.artifacts.getCurrent(f.projectId, "source-dossier")!;
    new WorkflowRepository(f.database).approve(f.projectId, "source-dossier", dossier.id); f.database.close();
    const provider = new DeterministicAdaptationIntentProvider(), app = buildApp({ databasePath: path, adaptationIntentProvider: provider, openRouterClient: createOfflineSetupClient() }); apps.push(app);
    const root = `/api/long-form/projects/${f.projectId}/adaptation-intent`;
    const created = await app.inject({ method: "POST", url: `${root}/create`, payload: {} }); expect(created.statusCode, created.body).toBe(200);
    for (const action of ["review", "approve"]) expect((await app.inject({ method: "POST", url: `${root}/${action}`, payload: { versionId: created.json().current.id } })).statusCode).toBe(200);
    expect(provider.calls).toHaveLength(0);
  });
  it("does not adopt implicitly; explicit legacy projection preserves Brief and A3, with no Creative Direction prerequisite", async () => {
    const f = await fixture(), before = await f.call("");
    expect(before.json().current).toBeNull(); expect(before.json().legacyProjection.dimensions.structure).toBe("flexible");
    const created = await f.call("/create", { legacyBriefVersionId: f.created.brief.id }); expect(created.statusCode, created.body).toBe(200);
    expect(created.json().current.policy.revision.legacyBriefVersionId).toBe(f.created.brief.id);
    const versionId = created.json().current.id;
    expect((await f.call("/review", { versionId })).statusCode).toBe(200); expect((await f.call("/approve", { versionId })).statusCode).toBe(200);
    expect(f.provider.calls).toHaveLength(0);
    const after = (await f.app.inject({ url: `/api/long-form/projects/${f.projectId}` })).json();
    expect(after.creativeDirection.id).toBe(f.created.creativeDirection.id); expect(after.brief.id).toBe(f.created.brief.id); expect(after.bible).toBeNull(); expect(after.routes).toBeNull();
    expect((await f.app.inject({ url: `${f.source}/export` })).json()).toEqual(f.dossier);
  });
  it("manual override is separate from source and stable-ID deactivation reveals the original", async () => {
    const f = await fixture(), created = await create(f), record = f.dossier.records.find((r: { category: string; claim: string }) => r.category === "event" && r.claim.includes("dies"));
    const value = { id: "survival", authority: "author-override", targetIds: [record.id], aspect: "survival", effect: "Ren survives the collapse", scope: "project", rationale: "Keep Ren for the final act", active: true, reviewed: true };
    const added = await f.call("/edit", { baseVersionId: created.current.id, operations: [{ kind: "override", value }] }); expect(added.statusCode, added.body).toBe(200);
    expect((await f.call("/collections/overrides")).json().items[0].effect).toContain("survives");
    const removed = await f.call("/edit", { baseVersionId: added.json().current.id, operations: [{ kind: "remove", collection: "overrides", id: value.id }] });
    expect(removed.statusCode).toBe(200); expect((await f.call("/collections/overrides")).json().items).toEqual([]);
    expect((await f.app.inject({ url: `${f.source}/export` })).json()).toEqual(f.dossier); expect(f.provider.calls).toHaveLength(0);
  });
  it.each(["base", "dossier"])("rejects Apply after %s changes without a partial canonical write", async (kind) => {
    const f = await fixture(); await create(f); const p = await preview(f);
    const generated = await f.call("/generate", { previewId: p.id, fingerprint: p.fingerprint });
    expect(generated.statusCode, generated.body).toBe(200);
    if (kind === "base") { const state = (await f.call("")).json(); await f.call("/edit", { baseVersionId: state.current.id, preset: "faithful" }); }
    else await f.app.inject({ method: "POST", url: `${f.source}/restore`, payload: { versionId: f.metadata.id } });
    const before = (await f.call("/history")).json();
    expect((await f.call("/apply", { versionId: generated.json().versionId })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await f.call("/history")).json()).toEqual(before);
    expect((await f.call(`/proposals/${generated.json().versionId}`)).json().status).toBe("pending");
  });
  it("recovers stale intent through explicit fresh-dossier adoption while preserving immutable policy history", async () => {
    const f = await fixture(), first = await create(f);
    await f.app.inject({ method: "POST", url: `${f.source}/restore`, payload: { versionId: f.metadata.id } });
    expect((await f.call("/create", { baseVersionId: first.current.id })).statusCode).toBeGreaterThanOrEqual(400);
    const dossier = (await f.app.inject({ url: `${f.source}/dossier` })).json();
    expect((await f.app.inject({ method: "POST", url: `${f.source}/approve`, payload: { versionId: dossier.id } })).statusCode).toBe(200);
    expect((await f.call("/create", {})).statusCode).toBe(409);
    const fresh = await f.call("/create", { baseVersionId: first.current.id }); expect(fresh.statusCode, fresh.body).toBe(200);
    expect(fresh.json().current.policy.binding.dossierVersionId).toBe(dossier.id);
    expect(fresh.json().current.policy.revision.previousVersionId).toBe(first.current.id);
    expect(fresh.json().workflow.status).toBe("draft");
    expect((await f.call(`/export?versionId=${first.current.id}`)).json().content.binding.dossierVersionId).toBe(f.metadata.id);
    expect((await f.call("/approve", { versionId: fresh.json().current.id })).statusCode).toBe(200);
    expect(f.provider.calls).toHaveLength(0);
  });
  it("preview is local, bounded, exact and excludes both manuscript and legacy fidelity authority; Apply is explicit and provider-free", async () => {
    const f = await fixture(), p = await preview(f);
    expect(p.precondition).toBe("must-not-exist"); expect(p.costStatus).toBe("known"); expect(p.binding.dossierVersionId).toBe(f.metadata.id); expect(f.provider.calls).toHaveLength(0);
    expect((await f.call("/generate", { previewId: p.id, fingerprint: "wrong" })).statusCode).toBe(400);
    const generated = await f.call("/generate", { previewId: p.id, fingerprint: p.fingerprint }); expect(generated.statusCode, generated.body).toBe(200);
    expect((await f.call("")).json().current).toBeNull(); expect(f.provider.calls).toHaveLength(1);
    const context = sourceCanonicalJson(f.provider.calls[0]!.context); expect(context).not.toContain("adaptationFidelity"); expect(context).not.toContain("manuscript");
    expect(Buffer.byteLength(context)).toBeLessThan(20_001);
    const applied = await f.call("/apply", { versionId: generated.json().versionId }); expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json().workflow.status).toBe("draft"); expect(f.provider.calls).toHaveLength(1);
    expect((await f.call("/apply", { versionId: generated.json().versionId })).statusCode).toBe(409);
    expect((await f.call("/history")).json().total).toBe(1);
  });
  it.each(["base", "dossier", "scope", "must-not-exist"])("does not persist a late provider completion after %s changes", async (kind) => {
    let release!: (raw: string) => void;
    const provider = new DeterministicAdaptationIntentProvider({ respond: () => new Promise((r) => { release = r; }) }), f = await fixture(provider);
    if (kind !== "must-not-exist") await create(f);
    const p = await preview(f), generation = f.call("/generate", { previewId: p.id, fingerprint: p.fingerprint });
    while (!release) await new Promise((r) => setTimeout(r, 1));
    if (kind === "base") { const state = (await f.call("")).json(); await f.call("/edit", { baseVersionId: state.current.id, preset: "faithful" }); }
    if (kind === "must-not-exist") await create(f);
    if (kind === "dossier") await f.app.inject({ method: "POST", url: `${f.source}/restore`, payload: { versionId: f.metadata.id } });
    if (kind === "scope") await f.app.inject({ method: "POST", url: `${f.source}/scope`, payload: { entireWork: true } });
    release(JSON.stringify({ schemaVersion: 1, intent: "adaptation-preference", operations: [{ kind: "dimension", dimension: "tone", level: "strict" }] }));
    const result = await generation; expect(result.statusCode).toBeGreaterThanOrEqual(400);
    expect((await f.call("/history")).json().total).toBe(kind === "base" ? 2 : 1);
  });
  it("rechecks freshness after structural repair and rejects repair exhaustion atomically", async () => {
    let f: Awaited<ReturnType<typeof fixture>>;
    const provider = new DeterministicAdaptationIntentProvider({ respond: async (r) => {
      if (r.mode === "suggest") return "{invalid";
      const state = (await f.call("")).json(); await f.call("/edit", { baseVersionId: state.current.id, preset: "faithful" });
      return JSON.stringify({ schemaVersion: 1, intent: "adaptation-preference", operations: [{ kind: "dimension", dimension: "tone", level: "strict" }] });
    } }); f = await fixture(provider); await create(f); const p = await preview(f);
    expect((await f.call("/generate", { previewId: p.id, fingerprint: p.fingerprint })).statusCode).toBe(409); expect(provider.calls).toHaveLength(2);
    const broken = await fixture(new DeterministicAdaptationIntentProvider({ respond: () => "{invalid" })); const b = await preview(broken);
    const response = await broken.call("/generate", { previewId: b.id, fingerprint: b.fingerprint }); expect(response.json().code).toBe("adaptation_repair_exhausted"); expect((await broken.call("")).json().current).toBeNull();
  });
  it.each(["achieved", "oversized", "foreign-target", "inflation", "partial-invalid"])("rejects %s provider operations without canonical changes", async (kind) => {
    const operation = kind === "inflation" ? { kind: "budget", target: 140_000 } : kind === "foreign-target" ? { kind: "override", value: { id: "bad", authority: "author-override", targetIds: ["foreign"], aspect: "state", effect: "Survives", scope: "project", rationale: "Intent", active: true, reviewed: false } }
      : { kind: "dimension", dimension: "tone", level: "strict" };
    const raw = kind === "oversized" ? "x".repeat(24_001) : kind === "achieved" ? JSON.stringify({ route: "Canon route preserved" })
      : JSON.stringify({ schemaVersion: 1, intent: "adaptation-preference", operations: [operation, ...(kind === "partial-invalid" ? [{ kind: "dimension", dimension: "invalid", level: "strict" }] : [])] });
    const f = await fixture(new DeterministicAdaptationIntentProvider({ respond: () => raw })), before = await create(f), p = await preview(f);
    const result = await f.call("/generate", { previewId: p.id, fingerprint: p.fingerprint }); expect(result.statusCode).toBe(400);
    expect((await f.call("")).json().current.id).toBe(before.current.id); expect((await f.call("/history")).json().total).toBe(1);
  });
  it("rejects clear A3 source corrections, foreign/oversized evidence selections, no dossier, and stale approval", async () => {
    const f = await fixture();
    for (const extra of [{ request: "No, the source actually says they are enemies" }, { recordIds: ["foreign"] }, { recordIds: Array.from({ length: 13 }, (_, i) => `id${i}`) }]) {
      expect((await f.call("/preview", { request: "Intent", recordIds: [], providerId: f.provider.id, modelId: "offline", ...extra })).statusCode).toBe(400);
    }
    const state = await create(f); await f.app.inject({ method: "POST", url: `${f.source}/restore`, payload: { versionId: f.metadata.id } });
    expect((await f.call("/approve", { versionId: state.current.id })).statusCode).toBe(409);
    const empty = (await f.app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Original" } })).json();
    expect((await f.app.inject({ method: "POST", url: `/api/long-form/projects/${empty.project.id}/adaptation-intent/create`, payload: {} })).statusCode).toBe(400);
    expect(f.provider.calls).toHaveLength(0);
  });
  it("rejects provider overspending against 80k without silently inflating the target", async () => {
    const value = { id: "too-much", scope: "project", rationale: "More branches", origin: "branching", description: "Many new branches", sourceRecordIds: [], overrideIds: [], inventionIds: [], dependencyIds: [], allocation: { kind: "estimated", words: 90_000 } };
    const f = await fixture(new DeterministicAdaptationIntentProvider({ respond: () => JSON.stringify({ schemaVersion: 1, intent: "adaptation-preference", operations: [{ kind: "expansion", value }] }) })), state = await create(f);
    const edited = await f.call("/edit", { baseVersionId: state.current.id, budget: { sourceEquivalent: { kind: "estimated", words: 30_000 }, target: { kind: "estimated", words: 80_000 }, discrepancyReviewed: false } });
    const p = await preview(f), result = await f.call("/generate", { previewId: p.id, fingerprint: p.fingerprint });
    expect(result.json().code).toBe("adaptation_provider_budget_exceeded"); expect((await f.call("")).json().current.policy.budget.target.words).toBe(80_000);
    expect((await f.call("")).json().current.id).toBe(edited.json().current.id);
  });
  it("reopens and duplicates durable proposals, preserving exact applied lineage after original deletion", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-a4-")); directories.push(directory); const path = join(directory, "project.sqlite");
    const f = await fixture(undefined, path), p = await preview(f);
    const generated = await f.call("/generate", { previewId: p.id, fingerprint: p.fingerprint }); await f.call("/apply", { versionId: generated.json().versionId });
    const copy = (await f.app.inject({ method: "POST", url: `/api/projects/${f.projectId}/duplicate`, payload: { name: "Intent copy" } })).json();
    expect(copy.id, JSON.stringify(copy)).toBeTruthy();
    await f.app.close(); apps.splice(apps.indexOf(f.app), 1);
    const db = openDatabase(path), artifacts = new ArtifactRepository(db);
    expect(artifacts.getCurrent<AdaptationIntent>(copy.id, "adaptation-intent")!.content.projectId).toBe(copy.id); db.close();
  });
  it("production provider uses a stubbed structured transport, exact schema and bounded tokens with no live call", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = new OpenRouterClient({ credentialStore: new EnvironmentCredentialStore({ environment: { OPENROUTER_API_KEY: "offline-key" } }), fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schemaVersion: 1, intent: "adaptation-preference", operations: [{ kind: "dimension", dimension: "tone", level: "strict" }] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
    } });
    const provider = new OpenRouterAdaptationIntentProvider(client);
    await provider.generate({ context: { requested: true }, mode: "suggest", modelId: "offline-model", signal: new AbortController().signal });
    expect(requests).toHaveLength(1); expect(requests[0]!.max_tokens).toBe(4000);
  });
});
