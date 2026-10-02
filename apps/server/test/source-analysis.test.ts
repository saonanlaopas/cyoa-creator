import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOURCE_ANALYSIS_POLICY, type SourceDossier } from "@story-to-cyoa/domain";
import { buildApp } from "../src/app.js";
import { DeterministicSourceAnalysisProvider, OpenRouterSourceAnalysisProvider } from "../src/services/source-analysis-provider.js";
import { OpenRouterClient } from "@story-to-cyoa/openrouter";

const apps: ReturnType<typeof buildApp>[] = [], directories: string[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); directories.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); });
const manuscript = "Chapter 1\n\nAlex and Mira are friends. Alex is twenty. Alexander watched the harbor.\n\nMira is Alex's sister. Ren is Mira's rival. Jules and Ren are lovers.\n\nChapter 2\n\nAlex is twenty-one. He remained behind. Perhaps he feared the sea.";
async function fixture(provider = new DeterministicSourceAnalysisProvider(), text = manuscript, databasePath?: string) {
  const app = buildApp({ sourceAnalysisProvider: provider, databasePath }); apps.push(app);
  const created = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Supplied story" } })).json();
  const projectId = created.project.id as string, root = `/api/long-form/projects/${projectId}/source-analysis`;
  expect((await app.inject({ method: "POST", url: `/api/projects/${projectId}/source/text`, payload: { text } })).statusCode).toBe(201);
  return { app, provider, projectId, root };
}
async function preview(f: Awaited<ReturnType<typeof fixture>>) {
  expect((await f.app.inject({ method: "POST", url: `${f.root}/scope`, payload: { entireWork: true } })).statusCode).toBe(201);
  const response = await f.app.inject({ method: "POST", url: `${f.root}/preview`, payload: {} });
  expect(response.statusCode, response.body).toBe(200); return response.json();
}
async function start(f: Awaited<ReturnType<typeof fixture>>, plan: { id: string; fingerprint: string }) {
  const response = await f.app.inject({ method: "POST", url: `${f.root}/plans/${plan.id}/start`, payload: { fingerprint: plan.fingerprint } });
  expect(response.statusCode, response.body).toBe(201); return response.json();
}
async function settle(f: Pick<Awaited<ReturnType<typeof fixture>>, "app" | "root">, id: string) {
  for (let count = 0; count < 400; count++) {
    const response = await f.app.inject({ method: "GET", url: `${f.root}/jobs/${id}` });
    const job = response.json(); if (!job.executing) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Offline source analysis did not settle");
}
describe("A3 source-analysis lifecycle API", () => {
  it("requires explicit scope and exact authorization, analyzes offline, reviews evidence and explicitly approves without foundations", async () => {
    const f = await fixture();
    expect((await f.app.inject({ method: "POST", url: `${f.root}/preview`, payload: {} })).statusCode).toBe(400);
    const plan = await preview(f);
    expect(f.provider.calls).toHaveLength(0); expect(plan.cost).toBe(0);
    expect((await f.app.inject({ method: "POST", url: `${f.root}/plans/${plan.id}/start`, payload: { fingerprint: "wrong" } })).statusCode).toBe(400);
    const job = await start(f, plan), completed = await settle(f, job.id);
    expect(completed.status).toBe("completed"); expect(completed.counts.completed).toBe(plan.unitCount);
    const dossier = (await f.app.inject({ method: "GET", url: `${f.root}/export` })).json() as SourceDossier;
    const metadata = (await f.app.inject({ method: "GET", url: `${f.root}/dossier` })).json();
    expect(metadata.workflow.status).toBe("draft"); expect(metadata.workflow.approvedVersionId).toBeNull();
    expect(dossier.records.filter((r) => r.category === "relationship").map((r) => r.claim)).toEqual(expect.arrayContaining(["friendship", "romance", "family", "rivalry"]));
    expect(dossier.records.some((r) => r.classification === "inference")).toBe(true);
    expect(dossier.conflicts.map((c) => c.kind)).toEqual(expect.arrayContaining(["ambiguity", "contradiction"]));
    const record = dossier.records.find((r) => r.category === "relationship" && r.claim === "friendship")!;
    const evidence = (await f.app.inject({ method: "POST", url: `${f.root}/evidence`, payload: record.evidence[0] })).json();
    expect(evidence.text).toContain("friends");
    expect((await f.app.inject({ method: "POST", url: `${f.root}/evidence`, payload: { ...record.evidence[0], projectId: "other-project" } })).statusCode).toBe(400);
    const callCount = f.provider.calls.length;
    expect((await f.app.inject({ method: "POST", url: `${f.root}/approve`, payload: { versionId: metadata.id } })).statusCode).toBe(200);
    expect(f.provider.calls).toHaveLength(callCount);
    const project = (await f.app.inject({ method: "GET", url: `/api/long-form/projects/${f.projectId}` })).json();
    expect(project.bible).toBeNull(); expect(project.routes).toBeNull();
  });
  it("retries provider failure and performs at most one structural repair without duplicate observations", async () => {
    const f = await fixture(new DeterministicSourceAnalysisProvider({ failFirst: true, malformedFirst: true })), plan = await preview(f);
    const job = await start(f, plan), failed = await settle(f, job.id);
    expect(failed.status).toBe("failed");
    const completedBeforeRetry = failed.counts.completed;
    expect((await f.app.inject({ method: "POST", url: `${f.root}/jobs/${job.id}/resume` })).statusCode).toBe(200);
    const completed = await settle(f, job.id);
    expect(completed.status).toBe("completed"); expect(completedBeforeRetry).toBeGreaterThan(0);
    expect(completed.units.filter((u: { attempts: unknown[] }) => u.attempts.length === 2)).toHaveLength(1);
    expect(f.provider.calls.filter((c) => c.mode === "repair").length).toBeLessThanOrEqual(1);
    const dossier = (await f.app.inject({ method: "GET", url: `${f.root}/export` })).json() as SourceDossier;
    expect(new Set(dossier.provenance.map((p) => p.observationId)).size).toBe(dossier.provenance.length);
  });
  it("repairs malformed JSON once and redacts provider error/source bodies from diagnostics", async () => {
    const f = await fixture(new DeterministicSourceAnalysisProvider({ malformedFirst: true })), plan = await preview(f), job = await start(f, plan);
    const completed = await settle(f, job.id);
    expect(completed.status).toBe("completed"); expect(f.provider.calls.filter((c) => c.mode === "repair")).toHaveLength(1);
    expect(completed.units.flatMap((u: { attempts: Array<{ repairCount: number }> }) => u.attempts).some((a: { repairCount: number }) => a.repairCount === 1)).toBe(true);
    expect(JSON.stringify(completed)).not.toContain("Alex and Mira");
  });
  it.each(["source", "scope", "cancel"])("prevents late valid output on in-flight %s mutation", async (mutation) => {
    const f = await fixture(new DeterministicSourceAnalysisProvider({ delayMs: 60 })), plan = await preview(f), job = await start(f, plan);
    while (!f.provider.calls.length) await new Promise((r) => setTimeout(r, 2));
    if (mutation === "source") await f.app.inject({ method: "POST", url: `/api/projects/${f.projectId}/source/text`, payload: { text: "Changed immutable source" } });
    if (mutation === "scope") await f.app.inject({ method: "POST", url: `${f.root}/scope`, payload: { entireWork: true } });
    if (mutation === "cancel") await f.app.inject({ method: "POST", url: `${f.root}/jobs/${job.id}/cancel` });
    const stopped = await settle(f, job.id);
    expect(stopped.counts.completed).toBe(0); expect(stopped.status).toBe(mutation === "cancel" ? "cancelled" : "failed");
    expect((await f.app.inject({ method: "GET", url: `${f.root}/dossier` })).statusCode).toBe(404);
    if (mutation === "cancel") expect((await f.app.inject({ method: "POST", url: `${f.root}/jobs/${job.id}/resume` })).statusCode).toBe(409);
  });
  it.each([{ invalidEvidence: true }, { oversized: true }])("rejects ungrounded or oversized output without publication: %j", async (options) => {
    const f = await fixture(new DeterministicSourceAnalysisProvider(options)), plan = await preview(f), job = await start(f, plan);
    const stopped = await settle(f, job.id); expect(stopped.status).toBe("failed"); expect(stopped.counts.completed).toBe(0);
    expect((await f.app.inject({ method: "GET", url: `${f.root}/dossier` })).statusCode).toBe(404);
  });
  it("preserves completed units across shutdown/reopen and resumes only remaining units on explicit action", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-source-analysis-restart-")); directories.push(directory);
    const databasePath = join(directory, "story.sqlite"), provider = new DeterministicSourceAnalysisProvider({ delayMs: 50 });
    const f = await fixture(provider, manuscript, databasePath), plan = await preview(f), job = await start(f, plan);
    while (provider.calls.length < 2) await new Promise((r) => setTimeout(r, 3));
    await f.app.close(); apps.splice(apps.indexOf(f.app), 1);
    const reopenedProvider = new DeterministicSourceAnalysisProvider(), app = buildApp({ databasePath, sourceAnalysisProvider: reopenedProvider }); apps.push(app);
    const reopened = { ...f, app }, interrupted = await settle(reopened, job.id);
    expect(interrupted.counts.completed).toBe(1); expect(reopenedProvider.calls).toHaveLength(0);
    expect((await app.inject({ method: "POST", url: `${f.root}/jobs/${job.id}/resume` })).statusCode).toBe(200);
    expect((await settle(reopened, job.id)).status).toBe("completed"); expect(reopenedProvider.calls).toHaveLength(plan.unitCount - 1);
  });
  it("bounds a large synthetic corpus and paginates metadata/evidence instead of returning source bodies", async () => {
    const text = Array.from({ length: 70 }, (_, i) => `Chapter ${i + 1}\n\n${"A quiet harbor. ".repeat(i === 0 ? 1500 : 150)}`).join("\n\n");
    const f = await fixture(undefined, text), plan = await preview(f), job = await start(f, plan);
    expect(plan.unitCount).toBeGreaterThan(70);
    const done = await settle(f, job.id); expect(done.status).toBe("completed");
    expect(done.units).toHaveLength(50);
    for (const call of f.provider.calls) {
      expect(call.context.evidence.reduce((sum, e) => sum + e.text.length, 0)).toBeLessThanOrEqual(SOURCE_ANALYSIS_POLICY.maxSourceCharacters);
      expect(JSON.stringify(call.context)).not.toContain(text);
    }
    const metadata = (await f.app.inject({ method: "GET", url: `${f.root}/source` })).json();
    expect(metadata.chapters).toHaveLength(50); expect(metadata.chapterCount).toBe(70); expect(JSON.stringify(metadata)).not.toContain("A quiet harbor.");
    const records = (await f.app.inject({ method: "GET", url: `${f.root}/records?limit=10` })).json();
    expect(records.items).toHaveLength(10); expect(records.total).toBeGreaterThan(50); expect(records.items[0].evidence).toBeUndefined();
    const record = (await f.app.inject({ method: "GET", url: `${f.root}/records/${records.items[0].id}` })).json();
    const evidence = (await f.app.inject({ method: "POST", url: `${f.root}/evidence`, payload: record.evidence[0] })).json();
    expect(evidence.text.length).toBeLessThanOrEqual(4000);
  }, 20_000);
  it("wires production structured output to a stub only, forwarding exact bounded evidence and abort signal", async () => {
    let request: unknown;
    const client = new OpenRouterClient({ fetch: async () => { throw new Error("No network allowed"); } });
    client.generateStructuredRaw = async (input) => { request = input; return { content: '{"schemaVersion":1,"observations":[]}', usage: { inputTokens: 4, outputTokens: 4 }, cost: null, attempt: {} } as Awaited<ReturnType<OpenRouterClient["generateStructuredRaw"]>>; };
    const provider = new OpenRouterSourceAnalysisProvider(client), controller = new AbortController();
    await provider.generate({ mode: "analyze", modelId: "stubbed-model", context: { schemaVersion: 1, evidence: [] }, maximumOutputTokens: 100, signal: controller.signal });
    expect(request).toMatchObject({ model: "stubbed-model", signal: controller.signal, maxTokens: 100, temperature: 0 });
  });
});
