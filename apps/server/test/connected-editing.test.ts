import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceDigest } from "@story-to-cyoa/domain";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ArtifactRepository, ChangeSetRepository, ConversationRepository, PortableProjectRepository, ProjectRepository, WorkflowRepository, openDatabase } from "@story-to-cyoa/persistence";
import { LongFormProjectService } from "../src/services/long-form-project-service.js";
import { ConversationalEditService } from "../src/services/conversational-edit-service.js";
import { ConnectedEditService, CONNECTED_RESULT_BYTES, boundedConnectedResult } from "../src/services/connected-edit-service.js";
import { PublicationExportService } from "../src/services/publication-export-service.js";
import { buildApp } from "../src/app.js";
import { readRuntimeConfig } from "../src/config.js";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const token = "test-local-connected-credential-00000000";
function fixture(path = ":memory:") {
  const db = openDatabase(path), artifacts = new ArtifactRepository(db), workflow = new WorkflowRepository(db);
  const projects = new ProjectRepository(db), changes = new ChangeSetRepository(db), longForm = new LongFormProjectService(projects, artifacts, workflow, changes);
  const created = longForm.createProject("Disposable connected editing"), id = created.project.id;
  longForm.approveArtifact(id, "brief", created.brief.id);
  const generate = vi.fn(async () => { throw new Error("Provider calls forbidden"); });
  const edits = new ConversationalEditService(db, longForm, [{ id: "offline-edit", generate }, { id: "openrouter-edit", generate }]);
  const service = new ConnectedEditService(db, edits, [id], longForm);
  cleanups.push(() => { edits.shutdown(); db.close(); });
  return { db, artifacts, workflow, projects, longForm, id, edits, service, generate, created };
}
type Fixture = ReturnType<typeof fixture>;
const response = { message: "Assistant-authored title edit", groups: [{ id: "title", label: "Title", explanation: "Requested title only", dependsOnGroupIds: [],
  operations: [{ targetKey: "brief:root", kind: "set-fields", changes: { workingTitle: "Connected harbor" } }] }] };
function prepare(f: Fixture, extra = {}) {
  const input = { projectId: f.id, operationId: randomUUID(), message: "Change the project title", headFingerprint: f.edits.connectedState(f.id).headFingerprint,
    targets: [{ key: "brief:root", versionId: f.artifacts.getCurrent(f.id, "brief")!.id }], ...extra };
  return { input, result: f.service.call("prepare_edit", input) as any };
}
function submit(f: Fixture, p = prepare(f).result, extra = {}) {
  const input = { projectId: f.id, operationId: randomUUID(), planId: p.plan.id, fingerprint: p.plan.fingerprint, response, ...extra };
  return { input, result: f.service.call("submit_edit", input) as any };
}
function applyInput(f: Fixture, proposalId: string) {
  const review = f.service.call("review_edit", { projectId: f.id, proposalId, groupIds: ["title"] }) as any;
  return { projectId: f.id, operationId: randomUUID(), proposalId, groupIds: ["title"], fingerprint: review.fingerprint, approved: true };
}

describe("M1 shared connected editing operations", () => {
  it("discovers only configured projects and bounded targets, stores truthful external proposals and applies only reviewed draft versions", async () => {
    const f = fixture(), other = f.longForm.createProject("Excluded");
    expect(f.service.call("list_projects", {})).toEqual({ projects: [{ id: f.id, name: "Disposable connected editing", mode: "long-form" }] });
    expect(() => f.service.call("project_state", { projectId: other.project.id })).toThrow("access_denied");
    const targets = f.service.call("list_edit_targets", { projectId: f.id }) as any;
    expect(targets.items.length).toBeLessThanOrEqual(50); expect(targets.items[0]).not.toHaveProperty("value");
    const p = prepare(f); expect(p.result.plan.contextBytes).toBeLessThan(64000);
    expect(p.result.plan.request).toMatchObject({ providerId: "connected-assistant", modelId: "assistant-authored" });
    await expect(f.edits.generate(f.id, p.result.plan.id, p.result.plan.fingerprint)).rejects.toThrow("external_submission_required");
    const s = submit(f, p.result);
    expect(f.service.call("list_edits", { projectId: f.id })).toMatchObject({ total: 1, items: [{ id: s.result.proposalId, status: "proposed", provenance: "connected-assistant" }] });
    expect(f.artifacts.getCurrent(f.id, "brief")!.id).toBe(f.created.brief.id);
    const input = applyInput(f, s.result.proposalId);
    expect(() => f.service.call("apply_edit", { ...input, approved: false })).toThrow();
    expect(() => f.service.call("apply_edit", { ...input, fingerprint: "0".repeat(64) })).toThrow("preview_stale");
    const result = f.service.call("apply_edit", input) as any;
    expect(result.providerCalls).toBe(0); expect(f.generate).not.toHaveBeenCalled();
    expect(f.artifacts.getCurrent<any>(f.id, "brief")!.content.workingTitle).toBe("Connected harbor");
    expect(f.workflow.get(f.id, "brief")).toMatchObject({ status: "draft", approvedVersionId: f.created.brief.id });
    f.edits.validateArchiveHistory(f.id);
  });

  it("replays identical lost-response retries and rejects operation-ID reuse or a second submission for one captured plan", () => {
    const f = fixture(), p = prepare(f);
    expect(f.service.call("prepare_edit", p.input)).toEqual(p.result);
    expect(() => f.service.call("prepare_edit", { ...p.input, message: "Another request" })).toThrow("operation_id_conflict");
    const s = submit(f, p.result);
    expect(f.service.call("submit_edit", s.input)).toEqual(s.result);
    expect(() => f.service.call("submit_edit", { ...s.input, operationId: randomUUID() })).toThrow("already_submitted");
    expect(() => f.service.call("submit_edit", { ...s.input, response: { ...response, message: "Changed" } })).toThrow("operation_id_conflict");
    const input = applyInput(f, s.result.proposalId), applied = f.service.call("apply_edit", input);
    expect(f.service.call("apply_edit", input)).toEqual(applied);
    expect(f.artifacts.listVersions(f.id, "brief")).toHaveLength(2);
    expect(f.service.call("get_edit", { projectId: f.id, proposalId: s.result.proposalId })).toMatchObject({ status: "applied" });
    expect(f.generate).not.toHaveBeenCalled();
  });

  it.each(["prepare-head", "prepare-target", "submit", "apply"])("rejects a concurrent browser edit at the %s boundary without overwriting it", (boundary) => {
    const f = fixture();
    if (boundary === "prepare-target") {
      expect(() => prepare(f, { targets: [{ key: "brief:root", versionId: randomUUID() }] })).toThrow("target_version_stale");
      expect(new ConversationRepository(f.db).list(f.id)).toHaveLength(0); return;
    }
    const p = prepare(f), s = boundary === "apply" ? submit(f, p.result) : null, input = s ? applyInput(f, s.result.proposalId) : null;
    const browser = f.longForm.saveArtifact(f.id, "brief", { ...f.created.brief.content, workingTitle: "Browser revision" }).artifact;
    if (boundary === "prepare-head") expect(() => f.service.call("prepare_edit", { ...p.input, operationId: randomUUID() })).toThrow("base_stale");
    else if (boundary === "submit") expect(() => submit(f, p.result)).toThrow("base_stale");
    else expect(() => f.service.call("apply_edit", input)).toThrow("base_stale");
    expect(f.artifacts.getCurrent(f.id, "brief")!.id).toBe(browser.id);
    expect(f.generate).not.toHaveBeenCalled();
  });

  it.each(["scope", "lifecycle", "identity", "dependency", "overflow"])("rejects invalid external %s atomically and permits corrected submission", (attack) => {
    const f = fixture(), p = prepare(f), bad = structuredClone(response) as any;
    if (attack === "scope") bad.groups[0].operations.push({ ...bad.groups[0].operations[0], targetKey: "bible:root" });
    if (attack === "lifecycle") bad.groups[0].operations[0].changes = { planningStatus: "locked" };
    if (attack === "identity") bad.groups[0].operations[0].changes = { id: "replaced" };
    if (attack === "dependency") bad.groups[0].dependsOnGroupIds = ["missing"];
    if (attack === "overflow") bad.groups[0].operations[0].changes = { premise: "x".repeat(96001) };
    expect(() => submit(f, p.result, { response: bad })).toThrow();
    expect(f.artifacts.getCurrent(f.id, "brief")!.id).toBe(f.created.brief.id);
    expect(f.edits.history(f.id, p.result.plan.conversationId).proposals).toHaveLength(0);
    expect(submit(f, p.result).result.status).toBe("proposed");
  });

  it("rolls back the shared multi-target Apply and its receipt on persistence failure, then allows retry", () => {
    const f = fixture(), p = prepare(f, { targets: [{ key: "brief:root", versionId: f.created.brief.id },
      { key: "creative-direction:section:tone", versionId: f.created.creativeDirection.id }] });
    const batch = structuredClone(response) as any;
    batch.groups.push({ id: "tone", label: "Tone", explanation: "Related guidance", dependsOnGroupIds: ["title"],
      operations: [{ targetKey: "creative-direction:section:tone", kind: "set-fields", changes: { customGuidance: "Restrained harbor tension" } }] });
    const s = submit(f, p.result, { response: batch });
    expect(() => f.service.call("review_edit", { projectId: f.id, proposalId: s.result.proposalId, groupIds: ["tone"] })).toThrow("selection_incomplete");
    const review = f.service.call("review_edit", { projectId: f.id, proposalId: s.result.proposalId, groupIds: ["title", "tone"] }) as any;
    const input = { projectId: f.id, operationId: randomUUID(), proposalId: s.result.proposalId, groupIds: ["title", "tone"], fingerprint: review.fingerprint, approved: true };
    f.db.exec("CREATE TEMP TRIGGER fail_connected_receipt BEFORE INSERT ON messages WHEN json_type(NEW.metadata_json,'$.connectedOperation') IS NOT NULL BEGIN SELECT RAISE(ABORT,'receipt failure'); END");
    expect(() => f.service.call("apply_edit", input)).toThrow("receipt failure");
    expect(f.artifacts.listVersions(f.id, "brief")).toHaveLength(1);
    expect(f.artifacts.listVersions(f.id, "creative-direction")).toHaveLength(1);
    expect(f.edits.proposal(f.id, s.result.proposalId).status).toBe("proposed");
    f.db.exec("DROP TRIGGER fail_connected_receipt");
    expect(f.service.call("apply_edit", input)).toMatchObject({ status: "applied" });
    expect(f.artifacts.listVersions(f.id, "creative-direction")).toHaveLength(2);
  });

  it("does not trust a forged success receipt when canonical proposal/application lineage disagrees", () => {
    const f = fixture(), s = submit(f), input = applyInput(f, s.result.proposalId), result = f.service.call("apply_edit", input) as any;
    const row = f.db.prepare("SELECT conversation_id,metadata_json FROM messages WHERE json_extract(metadata_json,'$.connectedOperation.operationId')=?").get(input.operationId) as any;
    const forgedInput = { ...input, operationId: randomUUID() }, metadata = JSON.parse(row.metadata_json);
    metadata.connectedOperation = { ...metadata.connectedOperation, operationId: forgedInput.operationId, fingerprint: sourceDigest({ tool: "apply_edit", input: forgedInput }),
      result: { ...metadata.connectedOperation.result, resultingVersions: {} } };
    // Model a forged imported receipt without weakening the immutable-message trigger.
    new ConversationRepository(f.db).addMessage({ conversationId: row.conversation_id, role: "assistant", intent: "discuss", content: "Forged success",
      scope: { kind: "project", projectId: f.id }, context: {}, metadata });
    expect(() => f.service.call("apply_edit", forgedInput)).toThrow("receipt_lineage_invalid");
    expect(f.artifacts.getCurrent(f.id, "brief")!.id).toBe(result.resultingVersions.brief);
    expect(f.artifacts.listVersions(f.id, "brief")).toHaveLength(2);
  });

  it("rejects cancelled service submission and allows exact, retry-safe proposal rejection", () => {
    const f = fixture(), p = prepare(f), s = submit(f, p.result);
    const input = { projectId: f.id, operationId: randomUUID(), proposalId: s.result.proposalId };
    expect(f.service.call("reject_edit", input)).toEqual(f.service.call("reject_edit", input));
    expect(() => applyInput(f, s.result.proposalId)).toThrow();
    const next = prepare(f); f.edits.shutdown();
    expect(() => submit(f, next.result)).toThrow("service_closing");
    expect(f.artifacts.listVersions(f.id, "brief")).toHaveLength(1);
  });

  it("bounds responses and keeps full-fidelity/restricted history portable without leaking requests in privacy exports", () => {
    const f = fixture(), p = prepare(f, { message: "Private connected title request" }), s = submit(f, p.result);
    f.service.call("apply_edit", applyInput(f, s.result.proposalId));
    expect(() => boundedConnectedResult({ value: "x".repeat(CONNECTED_RESULT_BYTES) })).toThrow("overflow");
    const publication = new PublicationExportService(new PortableProjectRepository(f.db), undefined);
    for (const mode of ["full-fidelity", "privacy-redacted"] as const) {
      const target = openDatabase();
      try {
        new PublicationExportService(new PortableProjectRepository(target), undefined).importPortable(publication.exportStudioPortable(f.id, mode).bytes);
        const c = new ConversationRepository(target).list(f.id);
        expect(c.some((r) => r.title === "Connected editing operations")).toBe(mode === "full-fidelity");
        if (mode === "privacy-redacted") expect(JSON.stringify(new ArtifactRepository(target).listVersions(f.id, "brief"))).not.toContain("Private connected");
      } finally { target.close(); }
    }
  });
});

describe("M1 authenticated Streamable HTTP", () => {
  it("is disabled by default and fails closed for missing credentials, broad listeners or invalid project configuration", async () => {
    const app = buildApp(); cleanups.push(() => app.close());
    expect((await app.inject({ method: "POST", url: "/mcp", payload: {} })).statusCode).toBe(404);
    expect(readRuntimeConfig({})).not.toHaveProperty("connectedEditing");
    expect(() => readRuntimeConfig({ CYOA_MCP_ENABLED: "1" })).toThrow("strong token");
    expect(() => readRuntimeConfig({ HOST: "0.0.0.0" })).toThrow("loopback");
    expect(() => buildApp({ connectedEditing: { token, projectIds: [] } })).toThrow();
  });

  it.each(["missing", "wrong", "remote", "host", "origin", "delete", "oversize"])("rejects %s transport access before mutations", async (attack) => {
    const f = fixture(), app = buildApp({ connectedEditing: { token, projectIds: [f.id] } }); cleanups.push(() => app.close());
    const reply = await app.inject({ method: attack === "delete" ? "DELETE" : "POST", url: "/mcp", remoteAddress: attack === "remote" ? "192.0.2.1" : "127.0.0.1",
      headers: { host: attack === "host" ? "evil.example" : "localhost", ...(attack === "missing" ? {} : { authorization: `Bearer ${attack === "wrong" ? "bad" : token}` }), ...(attack === "origin" ? { origin: "https://evil.example" } : {}) },
      payload: attack === "oversize" ? { data: "x".repeat(196001) } : {} });
    expect(reply.statusCode).toBe(["missing", "wrong"].includes(attack) ? 401 : attack === "delete" ? 405 : attack === "oversize" ? 413 : 403);
  });

  it("uses real SDK clients for concurrent retries, cross-project rejection and restart recovery without model calls", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cyoa-connected-test-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "project.sqlite"), f = fixture(path);
    const start = async () => {
      const app = buildApp({ databasePath: path, connectedEditing: { token, projectIds: [f.id] }, conversationalEditProvider: { id: "offline-edit", generate: f.generate } });
      const address = await app.listen({ host: "127.0.0.1", port: 0 }); cleanups.push(() => app.close());
      const client = new Client({ name: "m1-real-sdk-client", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      cleanups.push(() => client.close());
      return { app, client };
    };
    const first = await start();
    const call = async (client: Client, name: string, args: unknown) => {
      const result = await client.callTool({ name, arguments: args as Record<string, unknown> });
      if (result.isError) throw new Error(JSON.stringify(result.content));
      return result.structuredContent as any;
    };
    const tools = (await first.client.listTools()).tools;
    expect(tools.map((t) => t.name)).toHaveLength(44); expect(tools.find((t) => t.name === "apply_edit")!.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((t) => t.name === "preview_chapter_transition")!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "read_world")!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "review_world")!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "apply_world")!.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === "review_scene")!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "apply_scene")!.annotations?.destructiveHint).toBe(true);
    await expect(call(first.client, "project_state", { projectId: randomUUID() })).rejects.toThrow("access_denied");
    const state = await call(first.client, "project_state", { projectId: f.id });
    const p = await call(first.client, "prepare_edit", { projectId: f.id, operationId: randomUUID(), message: "Change the title", headFingerprint: state.headFingerprint, targets: [{ key: "brief:root", versionId: f.created.brief.id }] });
    const input = { projectId: f.id, operationId: randomUUID(), planId: p.plan.id, fingerprint: p.plan.fingerprint, response };
    const second = await start();
    const [a, b] = await Promise.all([call(first.client, "submit_edit", input), call(second.client, "submit_edit", input)]);
    expect(a).toEqual(b); expect(f.edits.history(f.id, p.plan.conversationId).proposals).toHaveLength(1);
    const review = await call(first.client, "review_edit", { projectId: f.id, proposalId: a.proposalId, groupIds: ["title"] });
    const application = { projectId: f.id, operationId: randomUUID(), proposalId: a.proposalId, groupIds: ["title"], fingerprint: review.fingerprint, approved: true };
    const result = await call(first.client, "apply_edit", application);
    await first.client.close(); await first.app.close(); await second.client.close(); await second.app.close();
    const restarted = await start();
    expect(await call(restarted.client, "list_edits", { projectId: f.id })).toMatchObject({ items: [{ id: a.proposalId, status: "applied" }] });
    expect(await call(restarted.client, "submit_edit", input)).toEqual(a);
    expect(await call(restarted.client, "apply_edit", application)).toEqual(result);
    expect(await call(restarted.client, "get_edit", { projectId: f.id, proposalId: a.proposalId })).toMatchObject({ status: "applied" });
    expect(f.artifacts.listVersions(f.id, "brief")).toHaveLength(2); expect(f.generate).not.toHaveBeenCalled();
  });
});
