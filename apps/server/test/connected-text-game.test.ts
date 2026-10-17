import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { sourceDigest } from "@story-to-cyoa/domain";
import { ArtifactRepository, ChangeSetRepository, ConversationRepository, PassageDraftAcceptanceRepository, PassageDraftRepository, PassagePlanRepository, PortableProjectRepository, ProjectRepository, WorkflowRepository, openDatabase } from "@story-to-cyoa/persistence";
import { LongFormProjectService } from "../src/services/long-form-project-service.js";
import { ConversationalEditService } from "../src/services/conversational-edit-service.js";
import { ConnectedEditService } from "../src/services/connected-edit-service.js";
import { ConnectedGameService } from "../src/services/connected-game-service.js";
import { PassagePlanService } from "../src/services/passage-plan-service.js";
import { PassageDraftService } from "../src/services/passage-draft-service.js";
import { NativeCompilationService } from "../src/services/native-compilation-service.js";
import { SimulationService } from "../src/services/simulation-service.js";
import { PublicationExportService } from "../src/services/publication-export-service.js";
import { buildApp } from "../src/app.js";
import { validatePortableAuthoringProject } from "../src/services/portable-project-validator.js";
import { prepareStudioHistoryDuplicate } from "../src/services/studio-history-duplication.js";
import { completeOriginalFoundations, originalTitle } from "../../../e2e/helpers/original-foundations.js";
import { acceptGameDrafts, applyGameEdit, approveGamePlan, completeConnectedTextGame, proposeGameEdit, submitGameDraft } from "../../../e2e/helpers/connected-text-game.js";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
function fixture(db = openDatabase(), projectId = randomUUID()) {
  const projects = new ProjectRepository(db), artifacts = new ArtifactRepository(db), workflow = new WorkflowRepository(db), drafts = new PassageDraftRepository(db);
  const passages = new PassagePlanRepository(db, (mutation) => drafts.handlePassagePlanMutationInTransaction(mutation)), acceptance = new PassageDraftAcceptanceRepository(db, drafts);
  const longForm = new LongFormProjectService(projects, artifacts, workflow, new ChangeSetRepository(db), passages, drafts);
  const plans = new PassagePlanService(projects, artifacts, workflow, passages), prose = new PassageDraftService(db, projects, workflow, passages, drafts, acceptance);
  const simulations = new SimulationService(projects, artifacts, workflow, passages, drafts), compilation = new NativeCompilationService(projects, artifacts, workflow, passages, drafts);
  const generate = vi.fn(async () => { throw new Error("Provider calls forbidden"); });
  const edits = new ConversationalEditService(db, longForm, [{ id: "offline-edit", generate }, { id: "openrouter-edit", generate }]);
  const game = new ConnectedGameService(db, edits, plans, prose, simulations, compilation);
  const service = new ConnectedEditService(db, edits, [projectId], longForm, true, game);
  const calls: Array<{ tool: string; input: Record<string, unknown>; result: any }> = [];
  const call = async (tool: string, input: Record<string, unknown>) => { const result = service.call(tool as any, input) as any; calls.push({ tool, input, result }); return result; };
  if (!projects.get(projectId)) service.call("create_project", { projectId, operationId: randomUUID(), name: originalTitle, approved: true });
  cleanups.push(() => { edits.shutdown(); db.close(); });
  return { db, projectId, projects, artifacts, workflow, drafts, passages, plans, prose, acceptance, edits, simulations, compilation, service, call, calls, generate, longForm };
}
async function initialized() {
  const f = fixture(); await completeOriginalFoundations(f.call, f.projectId);
  const state = await f.call("game_state", { projectId: f.projectId });
  await f.call("initialize_game_plan", { projectId: f.projectId, operationId: randomUUID(), headFingerprint: state.headFingerprint, approved: true });
  return f;
}
async function completed() { const f = fixture(), proof = await completeConnectedTextGame(f.call, f.projectId); return { ...f, proof }; }

describe("M3 connected complete text-game lifecycle", () => {
  it("authors structure/new entities/prose, accepts exact candidates, validates, simulates all endings and compiles without provider calls", async () => {
    const f = await completed();
    expect(f.proof.passages).toHaveLength(8);
    expect(f.proof.readiness.ready).toBe(true);
    expect(f.proof.compiled.build.passageCount).toBe(8);
    expect(f.proof.simulation.result).toMatchObject({ kind: "completed-ending", endingId: "ending-1" });
    for (const [choiceIds, expectedEndingId] of [[f.proof.alternate, "ending-2"], [f.proof.detourPath, "ending-3"]] as const) {
      const result = await f.call("simulate_game", { projectId: f.projectId, operationId: randomUUID(), headFingerprint: (await f.call("game_state", { projectId: f.projectId })).headFingerprint, choiceIds, expectedEndingId, approved: true });
      expect(result.result).toMatchObject({ kind: "completed-ending", endingId: expectedEndingId });
      expect(await f.call("read_simulation", { projectId: f.projectId, versionId: result.runVersionId, offset: 1 })).toMatchObject({ totalSteps: choiceIds.length, offset: 1 });
    }
    expect(f.proof.exported).toMatchObject({ historical: false, delivery: "download-link-rendered-on-fetch" });
    const exported = await new PublicationExportService(new PortableProjectRepository(f.db), f.compilation).exportStandalone(f.projectId, f.proof.compiled.inputVersionId);
    expect(exported.html).toContain("connect-src 'none'");
    expect(exported.html).not.toContain("Connected assistant; no provider generation");
    expect(f.generate).not.toHaveBeenCalled();
    f.edits.validateArchiveHistory(f.projectId);
  });

  it("replays each game mutation receipt after subsequent work without adding versions or builds", async () => {
    const f = await completed(), count = () => f.db.prepare("SELECT (SELECT COUNT(*) FROM artifact_versions)+(SELECT COUNT(*) FROM passage_draft_versions)+(SELECT COUNT(*) FROM passage_plan_snapshots) n").get() as any;
    const before = count().n;
    for (const saved of f.calls.filter((c) => ["initialize_game_plan", "approve_game_plan", "submit_draft", "accept_drafts", "compile_game", "simulate_game"].includes(c.tool))) {
      expect(f.service.call(saved.tool as any, saved.input)).toEqual(saved.result);
      expect(() => f.service.call(saved.tool as any, { ...saved.input, approved: false })).toThrow();
    }
    expect(count().n).toBe(before);
  });

  it.each(["initialize_game_plan", "approve_game_plan", "submit_draft", "accept_drafts", "simulate_game", "compile_game"])("rolls back %s and its receipt atomically, then allows retry", async (tool) => {
    const f = await completed(), saved = f.calls.find((c) => c.tool === tool)!;
    // Replay is read-only; test rollback on a fresh legitimate mutation at the current boundary.
    let input: Record<string, unknown> = { ...saved.input, operationId: randomUUID() };
    if (tool === "initialize_game_plan") {
      const g = fixture(); await completeOriginalFoundations(g.call, g.projectId);
      input = { projectId: g.projectId, operationId: randomUUID(), headFingerprint: (await g.call("game_state", { projectId: g.projectId })).headFingerprint, approved: true };
      g.db.exec("CREATE TEMP TRIGGER fail_m3 BEFORE INSERT ON messages WHEN json_type(NEW.metadata_json,'$.connectedOperation') IS NOT NULL BEGIN SELECT RAISE(ABORT,'receipt failed'); END");
      expect(() => g.service.call(tool, input)).toThrow("receipt failed"); expect(g.passages.currentStructure(g.projectId)).toBeUndefined();
      g.db.exec("DROP TRIGGER fail_m3"); expect(g.service.call(tool, input)).toMatchObject({ status: "draft" }); return;
    }
    if (tool === "approve_game_plan") { const review = await f.call("review_game_plan", { projectId: f.projectId }); input = { ...input, headFingerprint: review.headFingerprint, fingerprint: review.fingerprint }; }
    if (tool === "submit_draft") input = { ...input, headFingerprint: (await f.call("game_state", { projectId: f.projectId })).headFingerprint, proseMarkdown: "A corrected harbor scene, still a candidate." };
    if (tool === "accept_drafts") {
      const draft = await submitGameDraft(f.call, f.projectId, "passage-shared-opening", "A corrected opening after the storm.");
      const selections = [{ passageId: draft.passageId, candidateDraftVersionId: draft.draftVersionId }], review = await f.call("review_drafts", { projectId: f.projectId, selections });
      input = { ...input, selections, fingerprint: review.fingerprint };
    }
    if (tool === "simulate_game") input = { ...input, headFingerprint: (await f.call("game_state", { projectId: f.projectId })).headFingerprint };
    if (tool === "compile_game") { const review = await f.call("publication_readiness", { projectId: f.projectId }); input = { ...input, headFingerprint: review.headFingerprint, fingerprint: review.fingerprint }; }
    const counts = () => f.db.prepare("SELECT (SELECT COUNT(*) FROM artifact_versions) a,(SELECT COUNT(*) FROM passage_draft_versions) d,(SELECT COUNT(*) FROM passage_plan_snapshots) s").get();
    const before = counts(), accepted = f.drafts.getHead(f.projectId, "passage-shared-opening")?.accepted?.id;
    f.db.exec("CREATE TEMP TRIGGER fail_m3 BEFORE INSERT ON messages WHEN json_type(NEW.metadata_json,'$.connectedOperation') IS NOT NULL BEGIN SELECT RAISE(ABORT,'receipt failed'); END");
    expect(() => f.service.call(tool, input)).toThrow("receipt failed");
    expect(counts()).toEqual(before); expect(f.drafts.getHead(f.projectId, "passage-shared-opening")?.accepted?.id).toBe(accepted);
    f.db.exec("DROP TRIGGER fail_m3"); expect(f.service.call(tool, input)).toEqual(f.service.call(tool, input));
  });

  it("rejects stale candidate/acceptance/compile bindings and permits revised recovery without replacing accepted prose", async () => {
    const f = await completed(), passageId = "passage-shared-opening", old = f.drafts.getHead(f.projectId, passageId)!.accepted!;
    const candidate = await submitGameDraft(f.call, f.projectId, passageId, "A revised opening, pending author review.");
    expect(f.drafts.getHead(f.projectId, passageId)!.accepted!.id).toBe(old.id);
    const selections = [{ passageId, candidateDraftVersionId: candidate.draftVersionId }], review = await f.call("review_drafts", { projectId: f.projectId, selections });
    const readiness = await f.call("publication_readiness", { projectId: f.projectId });
    await submitGameDraft(f.call, f.projectId, passageId, "A second current candidate, not an accepted replacement.");
    expect(() => f.service.call("accept_drafts", { projectId: f.projectId, operationId: randomUUID(), selections, fingerprint: review.fingerprint, approved: true })).toThrow();
    expect(() => f.service.call("compile_game", { projectId: f.projectId, operationId: randomUUID(), headFingerprint: readiness.headFingerprint, fingerprint: readiness.fingerprint, approved: true })).toThrow("head_stale");
    await acceptGameDrafts(f.call, f.projectId, selections);
    expect(f.drafts.getHead(f.projectId, passageId)!.accepted!.proseMarkdown).toBe("A revised opening, pending author review.");
    expect(() => f.service.call("export_game", { projectId: f.projectId, buildVersionId: f.proof.compiled.buildVersionId, format: "standalone" })).toThrow("historical");
    expect(f.service.call("export_game", { projectId: f.projectId, buildVersionId: f.proof.compiled.buildVersionId, format: "standalone", allowHistorical: true })).toMatchObject({ historical: true });
  });

  it("protects locked accepted prose and preserves old candidates and approval state", async () => {
    const f = await completed(), passageId = "passage-shared-opening";
    const accepted = f.drafts.getHead(f.projectId, passageId)!.accepted!;
    const reviewed = f.prose.transition(f.projectId, passageId, accepted.id, "reviewed").draft;
    const locked = f.prose.transition(f.projectId, passageId, reviewed.id, "locked").draft;
    const candidate = await submitGameDraft(f.call, f.projectId, passageId, "Candidate while locked; never an implicit unlock.");
    const selections = [{ passageId, candidateDraftVersionId: candidate.draftVersionId }];
    expect((await f.call("review_drafts", { projectId: f.projectId, selections })).issues).toContainEqual(expect.objectContaining({ code: "locked_accepted_replacement" }));
    await expect(acceptGameDrafts(f.call, f.projectId, selections)).rejects.toThrow();
    expect(f.drafts.getHead(f.projectId, passageId)).toMatchObject({ acceptedLocked: true, accepted: { id: locked.id, proseMarkdown: accepted.proseMarkdown } });
  });

  it("recovers after a reviewed material plan revision without accepting stale prose", async () => {
    const f = await completed(), passageId = "passage-shared-opening", old = f.drafts.getHead(f.projectId, passageId)!.accepted!;
    const record = (await f.call("read_game_record", { projectId: f.projectId, kind: "passage", entityId: passageId })).record;
    const edit = await proposeGameEdit(f.call, f.projectId, "Revise the opening purpose with explicit evidence", [{ key: `passage:${passageId}`, versionId: record.id }], [
      { targetKey: `passage:${passageId}`, kind: "set-fields", changes: { purpose: "Mira verifies the false signal before taking the ledger to the quay." } },
    ]);
    await applyGameEdit(f.call, f.projectId, edit.proposalId);
    expect(f.drafts.getHead(f.projectId, passageId)!.accepted).toMatchObject({ id: old.id, stale: true });
    await expect(submitGameDraft(f.call, f.projectId, passageId, "Unapproved plan prose")).rejects.toThrow("approved_current_plan_required");
    await approveGamePlan(f.call, f.projectId);
    expect((await f.call("publication_readiness", { projectId: f.projectId })).ready).toBe(false);
    await expect(acceptGameDrafts(f.call, f.projectId, [{ passageId, candidateDraftVersionId: f.proof.selections.find((s) => s.passageId === passageId)!.candidateDraftVersionId }])).rejects.toThrow();
    const revised = await submitGameDraft(f.call, f.projectId, passageId, "Mira verifies the false signal and carries its evidence to the quay.");
    await acceptGameDrafts(f.call, f.projectId, [{ passageId, candidateDraftVersionId: revised.draftVersionId }]);
    expect((await f.call("publication_readiness", { projectId: f.projectId })).ready).toBe(true);
  });

  it.each(["scope", "lifecycle", "duplicate", "schema"])("rejects new entity %s violations before canonical mutation", async (attack) => {
    const f = await initialized(), structure = f.passages.currentStructure(f.projectId)!, template = f.passages.currentEntities<any>(f.projectId, "passage")[0]!;
    const item = { ...template.content, id: "$new:record" } as any;
    if (attack === "lifecycle") item.planningStatus = "locked";
    if (attack === "schema") item.proseMarkdown = "Smuggled prose";
    const target = attack === "scope" ? { key: `passage:${template.entityId}`, versionId: template.id } : { key: "passage-structure:root", versionId: structure.id };
    const operations = [{ targetKey: target.key, kind: "add-entity", entityKind: "passage", item }];
    if (attack === "duplicate") operations.push({ ...operations[0]! });
    await expect(proposeGameEdit(f.call, f.projectId, "Add a scoped record", [target], operations)).rejects.toThrow();
    expect(f.passages.currentEntities(f.projectId, "passage")).toHaveLength(7);
  });

  it("requires current foundations/plan approval and rejects unauthorized or foreign version reads", async () => {
    const f = fixture(), head = (await f.call("game_state", { projectId: f.projectId })).headFingerprint;
    expect(() => f.service.call("initialize_game_plan", { projectId: f.projectId, operationId: randomUUID(), headFingerprint: head, approved: true })).toThrow("foundation_approvals_required");
    expect(() => f.service.call("game_state", { projectId: randomUUID() })).toThrow("access_denied");
    const g = await initialized(), passage = g.passages.currentEntities(g.projectId, "passage")[0]!;
    await expect(submitGameDraft(g.call, g.projectId, passage.entityId, "Draft before plan approval")).rejects.toThrow("approved_current_plan_required");
    expect(() => g.service.call("read_game_record", { projectId: g.projectId, kind: "passage", entityId: passage.entityId, versionId: randomUUID() })).toThrow("not_found");
    await approveGamePlan(g.call, g.projectId);
    expect(() => g.service.call("submit_draft", { projectId: g.projectId, operationId: randomUUID(), headFingerprint: (g.service.call("game_state", { projectId: g.projectId }) as any).headFingerprint,
      passageId: passage.entityId, passageVersionId: randomUUID(), request: "Exact new candidate", proseMarkdown: "Candidate", approved: true })).toThrow("passage_version_stale");
  });

  it("rejects forged game receipts against canonical lineage and retains complete full/privacy archive history", async () => {
    const f = await completed(), saved = f.calls.find((c) => c.tool === "compile_game")!;
    const input = { ...saved.input, operationId: randomUUID() }, scope = { kind: "project" as const, projectId: f.projectId };
    const conversations = new ConversationRepository(f.db), conversation = conversations.create(f.projectId, scope, "Untrusted import");
    conversations.addMessage({ conversationId: conversation.id, role: "assistant", content: "Forged compile", intent: "discuss", scope, context: {}, metadata: {
      connectedOperation: { operationId: input.operationId, tool: "compile_game", fingerprint: sourceDigest({ tool: "compile_game", input }), result: { ...saved.result, inputVersionId: randomUUID() } },
    } });
    expect(() => f.service.call("compile_game", input)).toThrow("receipt_lineage_invalid");
    const publication = new PublicationExportService(new PortableProjectRepository(f.db), f.compilation);
    for (const mode of ["full-fidelity", "privacy-redacted"] as const) {
      const bytes = publication.exportStudioPortable(f.projectId, mode).bytes, target = openDatabase();
      try { new PublicationExportService(new PortableProjectRepository(target), undefined).importPortable(bytes); expect(new PassageDraftRepository(target).projectSummary(f.projectId).acceptedDraftCount).toBe(8); }
      finally { target.close(); }
    }
  });

  it("uses actual SDK connections across restart, including byte export retrieval and identical compile/simulation retries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cyoa-m3-sdk-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const projectId = randomUUID(), token = "m3-disposable-auth-credential-00000000000", databasePath = join(dir, "game.sqlite");
    const start = async () => {
      const app = buildApp({ databasePath, connectedEditing: { token, projectIds: [projectId], allowProjectCreation: true } });
      const address = await app.listen({ host: "127.0.0.1", port: 0 }); cleanups.push(() => app.close());
      const client = new Client({ name: "m3-no-model-test", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })); cleanups.push(() => client.close());
      const calls: Array<{ tool: string; input: Record<string, unknown>; result: any }> = [];
      const call = async (tool: string, input: Record<string, unknown>) => { const r = await client.callTool({ name: tool, arguments: input }); if (r.isError) throw new Error(JSON.stringify(r.content)); calls.push({ tool, input, result: r.structuredContent }); return r.structuredContent as any; };
      return { app, client, call, calls, address };
    };
    const first = await start(); await first.call("create_project", { projectId, operationId: randomUUID(), name: originalTitle, approved: true });
    const proof = await completeConnectedTextGame(first.call, projectId);
    const download = await fetch(`${first.address}${proof.exported.downloadPath}`); expect(download.ok).toBe(true); expect(await download.text()).toContain("connect-src 'none'");
    const saved = first.calls.filter((c) => ["compile_game", "simulate_game", "accept_drafts"].includes(c.tool));
    await first.client.close(); await first.app.close(); const fresh = await start();
    expect((await fresh.call("game_state", { projectId })).total).toBe(8);
    for (const item of saved) expect(await fresh.call(item.tool, item.input)).toEqual(item.result);
  });

  it("restores all game mutation receipts and duplicates newly authored entities with valid audit history", async () => {
    const f = await completed(), publication = new PublicationExportService(new PortableProjectRepository(f.db), f.compilation);
    const target = openDatabase();
    new PublicationExportService(new PortableProjectRepository(target), undefined).importPortable(publication.exportStudioPortable(f.projectId, "full-fidelity").bytes);
    const restored = fixture(target, f.projectId);
    for (const saved of f.calls.filter((c) => ["initialize_game_plan", "approve_game_plan", "submit_draft", "accept_drafts", "compile_game", "simulate_game"].includes(c.tool))) {
      expect(restored.service.call(saved.tool as any, saved.input)).toEqual(saved.result);
    }
    const copy = restored.projects.duplicate(f.projectId, "Copied complete text game", validatePortableAuthoringProject, prepareStudioHistoryDuplicate);
    expect(restored.passages.currentEntities(copy.id, "passage")).toHaveLength(8);
    expect(restored.drafts.projectSummary(copy.id).acceptedDraftCount).toBe(8);
    restored.edits.validateArchiveHistory(copy.id);
    expect(restored.compilation.readiness(copy.id).ready).toBe(true);
  });
});
