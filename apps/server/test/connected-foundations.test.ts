import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { sourceDigest } from "@story-to-cyoa/domain";
import { planningArtifactIds } from "@story-to-cyoa/pipeline";
import { ArtifactRepository, ChangeSetRepository, ConversationRepository, PassageDraftRepository, PassagePlanRepository, PortableProjectRepository, ProjectRepository, WorkflowRepository, openDatabase } from "@story-to-cyoa/persistence";
import { LongFormProjectService } from "../src/services/long-form-project-service.js";
import { ConnectedEditService } from "../src/services/connected-edit-service.js";
import { ConversationalEditService } from "../src/services/conversational-edit-service.js";
import { PublicationExportService } from "../src/services/publication-export-service.js";
import { buildApp } from "../src/app.js";
import { readRuntimeConfig } from "../src/config.js";
import { applyFoundation, approveFoundation, completeOriginalFoundations, originalTitle, proposeFoundation } from "../../../e2e/helpers/original-foundations.js";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const token = "m2-disposable-credential-outside-git-0000";
function fixture(path = ":memory:", allowCreation = true, projectId = randomUUID()) {
  const db = openDatabase(path), artifacts = new ArtifactRepository(db), workflow = new WorkflowRepository(db), projects = new ProjectRepository(db);
  const passages = new PassagePlanRepository(db), drafts = new PassageDraftRepository(db);
  const longForm = new LongFormProjectService(projects, artifacts, workflow, new ChangeSetRepository(db), passages, drafts);
  const generate = vi.fn(async () => { throw new Error("Provider calls forbidden"); });
  const edits = new ConversationalEditService(db, longForm, [{ id: "offline-edit", generate }, { id: "openrouter-edit", generate }]);
  const service = new ConnectedEditService(db, edits, [projectId], longForm, allowCreation);
  cleanups.push(() => { edits.shutdown(); db.close(); });
  const call = async (tool: string, args: Record<string, unknown>) => service.call(tool as any, args) as any;
  const createInput = { projectId, operationId: randomUUID(), name: originalTitle, approved: true };
  const create = () => service.call("create_project", createInput) as any;
  return { db, projectId, artifacts, workflow, projects, longForm, edits, service, call, createInput, create, generate };
}

describe("M2 original-game foundation authoring", () => {
  it("requires separate creation capability, an explicit configured empty slot and author consent", () => {
    const f = fixture(undefined, false);
    expect(() => f.create()).toThrow("creation_disabled");
    expect(f.projects.list()).toHaveLength(0);
    expect(readRuntimeConfig({ CYOA_MCP_ENABLED: "1", CYOA_MCP_TOKEN: token, CYOA_MCP_PROJECT_IDS: f.projectId })).toMatchObject({ connectedEditing: { token, projectIds: [f.projectId] } });
    expect(readRuntimeConfig({ CYOA_MCP_ENABLED: "1", CYOA_MCP_TOKEN: token, CYOA_MCP_PROJECT_IDS: f.projectId, CYOA_MCP_ALLOW_PROJECT_CREATION: "1" }).connectedEditing?.allowProjectCreation).toBe(true);
    const enabled = new ConnectedEditService(f.db, f.edits, [f.projectId], f.longForm, true);
    expect(enabled.call("list_projects", {})).toEqual({ projects: [], creationSlots: [f.projectId] });
    expect(() => enabled.call("create_project", { ...f.createInput, projectId: randomUUID() })).toThrow("access_denied");
    expect(() => enabled.call("create_project", { ...f.createInput, approved: false })).toThrow();
    enabled.call("create_project", f.createInput);
    expect(() => enabled.call("create_project", { ...f.createInput, operationId: randomUUID() })).toThrow("slot_occupied");
    expect(enabled.call("list_projects", {})).toMatchObject({ creationSlots: [], projects: [{ id: f.projectId, mode: "long-form" }] });
    expect(f.artifacts.getCurrent<any>(f.projectId, "brief")!.content.sourceMode).toBe("original-premise");
  });

  it("authors and approves coherent originals in all six schemas, resumes without chat and keeps approval separate from Apply", async () => {
    const f = fixture(), created = f.create();
    expect(f.create()).toEqual(created);
    let proposals = 0;
    const state = await completeOriginalFoundations(f.call, f.projectId, async (artifactId, proposal) => {
      proposals++;
      expect(f.workflow.get(f.projectId, artifactId).status).not.toBe("approved");
      expect(f.service.call("get_edit", { projectId: f.projectId, proposalId: proposal.proposalId })).toMatchObject({ status: "proposed" });
    });
    expect(proposals).toBe(6);
    expect(state.workflow.every((entry: any) => entry.workflow.status === "approved" && entry.workflow.approvedVersionId === entry.currentVersionId)).toBe(true);
    expect(f.longForm.getState(f.projectId).validation).toEqual([]);
    const resumed = new ConnectedEditService(f.db, new ConversationalEditService(f.db, f.longForm, []), [f.projectId], f.longForm, true);
    expect(resumed.call("list_edits", { projectId: f.projectId })).toMatchObject({ total: 6 });
    expect(resumed.call("read_foundation", { projectId: f.projectId, artifactId: "bible", sectionId: "character-protagonist" })).toMatchObject({ content: { name: "Mira", plannedArc: expect.stringContaining("accountable") } });
    expect(resumed.call("create_project", f.createInput)).toEqual(created);
    expect(f.generate).not.toHaveBeenCalled();
    f.edits.validateArchiveHistory(f.projectId);
    for (const mode of ["full-fidelity", "privacy-redacted"] as const) {
      const bytes = new PublicationExportService(new PortableProjectRepository(f.db), undefined).exportStudioPortable(f.projectId, mode).bytes;
      const target = openDatabase();
      try {
        new PublicationExportService(new PortableProjectRepository(target), undefined).importPortable(bytes);
        expect(new WorkflowRepository(target).get(f.projectId, "mechanics").status).toBe("approved");
      } finally { target.close(); }
    }
  });

  it("preserves shared prerequisites and validation; incomplete mechanics cannot be approved", async () => {
    const f = fixture(); f.create();
    const state = () => (f.service.call("project_state", { projectId: f.projectId }) as any).headFingerprint;
    const initialize = (artifactId: string) => f.service.call("initialize_foundation", { projectId: f.projectId, operationId: randomUUID(), artifactId, headFingerprint: state(), approved: true });
    expect(() => initialize("bible")).toThrow("prerequisite_not_current");
    expect(f.artifacts.getCurrent(f.projectId, "bible")).toBeUndefined();
    await approveFoundation(f.call, f.projectId, "brief");
    initialize("bible");
    expect(() => initialize("routes")).toThrow("prerequisite_not_current");
    await approveFoundation(f.call, f.projectId, "bible"); initialize("routes");
    expect(() => initialize("endings")).toThrow("prerequisite_not_current");
    await approveFoundation(f.call, f.projectId, "routes"); initialize("endings");
    await approveFoundation(f.call, f.projectId, "endings"); initialize("mechanics");
    await expect(approveFoundation(f.call, f.projectId, "mechanics")).rejects.toThrow("does not influence");
    expect(f.workflow.get(f.projectId, "mechanics").status).toBe("draft");
    expect(f.generate).not.toHaveBeenCalled();
  });

  it.each(["create", "initialize", "approve"])("rolls back %s and receipt together on failure, allowing an exact retry", async (boundary) => {
    const f = fixture();
    let input: any = f.createInput, tool: any = "create_project";
    if (boundary !== "create") {
      f.create();
      if (boundary === "initialize") {
        await approveFoundation(f.call, f.projectId, "brief");
        input = { projectId: f.projectId, operationId: randomUUID(), artifactId: "bible", headFingerprint: f.edits.connectedState(f.projectId).headFingerprint, approved: true }; tool = "initialize_foundation";
      } else {
        const versionId = f.artifacts.getCurrent(f.projectId, "brief")!.id;
        const review = f.service.call("review_foundation_approval", { projectId: f.projectId, artifactId: "brief", versionId }) as any;
        input = { projectId: f.projectId, operationId: randomUUID(), artifactId: "brief", versionId, fingerprint: review.fingerprint, approved: true }; tool = "approve_foundation";
      }
    }
    f.db.exec("CREATE TEMP TRIGGER fail_m2_receipt BEFORE INSERT ON messages WHEN json_type(NEW.metadata_json,'$.connectedOperation') IS NOT NULL BEGIN SELECT RAISE(ABORT,'receipt failed'); END");
    expect(() => f.service.call(tool, input)).toThrow("receipt failed");
    if (boundary === "create") expect(f.projects.get(f.projectId)).toBeUndefined();
    if (boundary === "initialize") expect(f.artifacts.getCurrent(f.projectId, "bible")).toBeUndefined();
    if (boundary === "approve") {
      expect(f.workflow.get(f.projectId, "brief").status).toBe("draft");
      expect(f.db.prepare("SELECT 1 FROM artifact_version_approvals WHERE project_id=?").get(f.projectId)).toBeUndefined();
    }
    f.db.exec("DROP TRIGGER fail_m2_receipt");
    const result = f.service.call(tool, input);
    expect(f.service.call(tool, input)).toEqual(result);
    expect(() => f.service.call(tool, { ...input, approved: false })).toThrow();
  });

  it("rejects stale head, version, approval fingerprint, scope and changed-argument retries", async () => {
    const f = fixture(); f.create();
    const old = f.artifacts.getCurrent(f.projectId, "brief")!;
    const review = f.service.call("review_foundation_approval", { projectId: f.projectId, artifactId: "brief", versionId: old.id }) as any;
    const input = { projectId: f.projectId, operationId: randomUUID(), artifactId: "brief", versionId: old.id, fingerprint: review.fingerprint, approved: true };
    f.longForm.saveArtifact(f.projectId, "brief", { ...old.content as object, premise: "Concurrent browser revision" });
    expect(() => f.service.call("approve_foundation", input)).toThrow("fresh_current_version");
    expect(() => f.service.call("initialize_foundation", { projectId: f.projectId, operationId: randomUUID(), artifactId: "bible", headFingerprint: review.headFingerprint, approved: true })).toThrow("base_stale");
    const current = f.artifacts.getCurrent(f.projectId, "brief")!;
    const fresh = f.service.call("review_foundation_approval", { projectId: f.projectId, artifactId: "brief", versionId: current.id }) as any;
    expect(() => f.service.call("approve_foundation", { ...input, versionId: current.id, fingerprint: "0".repeat(64) })).toThrow("review_stale");
    expect(() => f.service.call("review_foundation_approval", { projectId: randomUUID(), artifactId: "brief", versionId: current.id })).toThrow("access_denied");
    const approve = { ...input, versionId: current.id, fingerprint: fresh.fingerprint };
    const result = f.service.call("approve_foundation", approve);
    expect(f.service.call("approve_foundation", approve)).toEqual(result);
    expect(() => f.service.call("approve_foundation", { ...approve, versionId: old.id })).toThrow("operation_id_conflict");
    expect(() => f.service.call("create_project", { ...f.createInput, name: "Different" })).toThrow("operation_id_conflict");
    expect(() => f.service.call("initialize_foundation", { projectId: f.projectId, operationId: randomUUID(), artifactId: "passage", headFingerprint: f.edits.connectedState(f.projectId).headFingerprint, approved: true })).toThrow();
  });

  it("binds approval to changes in prerequisite state even if the reviewed version is unchanged", async () => {
    const f = fixture(); f.create(); await approveFoundation(f.call, f.projectId, "brief");
    const current = f.artifacts.getCurrent(f.projectId, "creative-direction")!;
    const review = f.service.call("review_foundation_approval", { projectId: f.projectId, artifactId: "creative-direction", versionId: current.id }) as any;
    f.workflow.markDraft(f.projectId, "brief");
    expect(() => f.service.call("approve_foundation", { projectId: f.projectId, operationId: randomUUID(), artifactId: "creative-direction", versionId: current.id, fingerprint: review.fingerprint, approved: true })).toThrow("review_stale");
  });

  it("rejects historical prerequisite approvals and recovers after approving the current revision", async () => {
    const f = fixture(); f.create();
    const old = f.artifacts.getCurrent(f.projectId, "brief")!;
    f.longForm.saveArtifact(f.projectId, "brief", { ...old.content as object, premise: "Current revision needs approval" });
    // Creator preserves its historical-version workflow; MCP must not treat that as current authorization.
    f.longForm.approveArtifact(f.projectId, "brief", old.id);
    const initialize = { projectId: f.projectId, operationId: randomUUID(), artifactId: "bible", headFingerprint: f.edits.connectedState(f.projectId).headFingerprint, approved: true };
    expect(() => f.service.call("initialize_foundation", initialize)).toThrow("prerequisite_not_current");
    await approveFoundation(f.call, f.projectId, "brief");
    const fresh = { ...initialize, headFingerprint: f.edits.connectedState(f.projectId).headFingerprint };
    const created = f.service.call("initialize_foundation", fresh);
    expect(f.service.call("initialize_foundation", fresh)).toEqual(created);
    expect(() => f.service.call("initialize_foundation", { ...fresh, operationId: randomUUID(), headFingerprint: f.edits.connectedState(f.projectId).headFingerprint })).toThrow("already exists");
    expect(f.artifacts.listVersions(f.projectId, "bible")).toHaveLength(1);
  });

  it("rejects proposed revisions without changing canonical work, then permits a new corrected draft and explicit reapproval", async () => {
    const f = fixture(); f.create(); await approveFoundation(f.call, f.projectId, "brief");
    const original = f.artifacts.getCurrent(f.projectId, "brief")!;
    const proposal = await proposeFoundation(f.call, f.projectId, "brief", { premise: "Discard this direction" });
    const reject = { projectId: f.projectId, operationId: randomUUID(), proposalId: proposal.proposalId };
    expect(f.service.call("reject_edit", reject)).toEqual(f.service.call("reject_edit", reject));
    expect(f.artifacts.getCurrent(f.projectId, "brief")!.id).toBe(original.id);
    await expect(applyFoundation(f.call, f.projectId, proposal.proposalId)).rejects.toThrow();
    const revised = await proposeFoundation(f.call, f.projectId, "brief", { premise: "Mira repairs the harbor signal without hiding its public cost." });
    await applyFoundation(f.call, f.projectId, revised.proposalId);
    expect(f.workflow.get(f.projectId, "brief")).toMatchObject({ status: "draft", approvedVersionId: original.id });
    await approveFoundation(f.call, f.projectId, "brief");
    expect(f.workflow.get(f.projectId, "brief").approvedVersionId).not.toBe(original.id);
  });

  it("bounds foundation reads and refuses forged approval receipts without canonical approval evidence", () => {
    const f = fixture(); f.create();
    const current = f.artifacts.getCurrent(f.projectId, "brief")!;
    const review = f.service.call("review_foundation_approval", { projectId: f.projectId, artifactId: "brief", versionId: current.id }) as any;
    const input = { projectId: f.projectId, operationId: randomUUID(), artifactId: "brief", versionId: current.id, fingerprint: review.fingerprint, approved: true };
    const scope = { kind: "project" as const, projectId: f.projectId }, conversations = new ConversationRepository(f.db);
    const conversation = conversations.create(f.projectId, scope, "Untrusted imported receipt");
    conversations.addMessage({ conversationId: conversation.id, role: "assistant", intent: "discuss", content: "Forged approval", scope, context: {}, metadata: {
      connectedOperation: { operationId: input.operationId, tool: "approve_foundation", fingerprint: sourceDigest({ tool: "approve_foundation", input }), result: { artifactId: "brief", versionId: current.id, fingerprint: review.fingerprint, status: "approved", providerCalls: 0 } },
    } });
    expect(() => f.service.call("approve_foundation", input)).toThrow("receipt_lineage_invalid");
    expect(f.workflow.get(f.projectId, "brief").status).toBe("draft");
    f.longForm.saveArtifact(f.projectId, "brief", { ...current.content as object, projectConstraints: Array.from({ length: 100 }, () => "x".repeat(500)), premise: "p".repeat(20000) });
    expect(() => f.service.call("read_foundation", { projectId: f.projectId, artifactId: "brief" })).toThrow("context_overflow");
  });

  it("creates once across concurrent SDK connections and recovers foundation approvals after a full server restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cyoa-m2-sdk-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "disposable.sqlite"), id = randomUUID();
    const start = async () => {
      const app = buildApp({ databasePath: path, connectedEditing: { token, projectIds: [id], allowProjectCreation: true } });
      const address = await app.listen({ host: "127.0.0.1", port: 0 }); cleanups.push(() => app.close());
      const client = new Client({ name: "m2-disposable-client", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      cleanups.push(() => client.close());
      const approvals: Array<{ input: Record<string, unknown>; result: unknown }> = [];
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args }); if (result.isError) throw new Error(JSON.stringify(result.content));
        if (name === "approve_foundation") approvals.push({ input: args, result: result.structuredContent });
        return result.structuredContent as any;
      };
      return { app, client, call, approvals };
    };
    const a = await start(), b = await start();
    const input = { projectId: id, operationId: randomUUID(), name: originalTitle, approved: true };
    const results = await Promise.all([a.call("create_project", input), b.call("create_project", input)]);
    expect(results[0]).toEqual(results[1]);
    const review = await a.call("review_foundation_approval", { projectId: id, artifactId: "brief", versionId: results[0].briefVersionId });
    const approve = { projectId: id, operationId: randomUUID(), artifactId: "brief", versionId: results[0].briefVersionId, fingerprint: review.fingerprint, approved: true };
    const approved = await Promise.all([a.call("approve_foundation", approve), b.call("approve_foundation", approve)]);
    expect(approved[0]).toEqual(approved[1]);
    await completeOriginalFoundations(a.call, id);
    const before = await a.call("project_state", { projectId: id });
    const lastApproval = a.approvals.at(-1)!;
    await a.client.close(); await a.app.close(); await b.client.close(); await b.app.close();
    const resumed = await start();
    expect(await resumed.call("project_state", { projectId: id })).toEqual(before);
    expect(await resumed.call("create_project", input)).toEqual(results[0]);
    expect(await resumed.call("approve_foundation", lastApproval.input)).toEqual(lastApproval.result);
    for (const artifactId of planningArtifactIds) expect(await resumed.call("read_foundation", { projectId: id, artifactId })).toMatchObject({ versionId: before.workflow.find((w: any) => w.artifactId === artifactId).currentVersionId });
    const db = openDatabase(path); try {
      const receipt = db.prepare("SELECT metadata_json FROM messages WHERE json_extract(metadata_json,'$.connectedOperation.tool')='approve_foundation' ORDER BY rowid DESC LIMIT 1").get() as any;
      const saved = JSON.parse(receipt.metadata_json).connectedOperation.result;
      expect(await resumed.call("approve_foundation", { projectId: id, operationId: randomUUID(), artifactId: "mechanics", versionId: saved.versionId, fingerprint: "0".repeat(64), approved: true }).catch((error) => String(error))).toContain("review_stale");
      expect(new ProjectRepository(db).list()).toHaveLength(1);
    } finally { db.close(); }
  });
});
