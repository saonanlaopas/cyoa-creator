import { testDraftingContext } from "./helpers/authoring-context.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { builtinFictionCraft, sourceDigest } from "@story-to-cyoa/domain";
import { ArtifactRepository, ChangeSetRepository, ConversationRepository, PassageDraftAcceptanceRepository, PassageDraftRepository, PassagePlanRepository, PortableProjectRepository, ProjectRepository, WorkflowRepository, openDatabase } from "@story-to-cyoa/persistence";
import { LongFormProjectService } from "../src/services/long-form-project-service.js";
import { ConversationalEditService } from "../src/services/conversational-edit-service.js";
import { ConnectedEditService } from "../src/services/connected-edit-service.js";
import { ConnectedGameInputs, ConnectedGameService } from "../src/services/connected-game-service.js";
import { PassagePlanService } from "../src/services/passage-plan-service.js";
import { PassageDraftService } from "../src/services/passage-draft-service.js";
import { NativeCompilationService } from "../src/services/native-compilation-service.js";
import { SimulationService } from "../src/services/simulation-service.js";
import { PublicationExportService } from "../src/services/publication-export-service.js";
import { buildApp } from "../src/app.js";
import { validatePortableAuthoringProject } from "../src/services/portable-project-validator.js";
import { prepareStudioHistoryDuplicate } from "../src/services/studio-history-duplication.js";
import { applyFoundation, approveFoundation, completeOriginalFoundations, originalTitle, proposeFoundation } from "../../../e2e/helpers/original-foundations.js";
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
  const game = new ConnectedGameService(db, edits, plans, prose, simulations, compilation, testDraftingContext(db));
  const service = new ConnectedEditService(db, edits, [projectId], longForm, true, game);
  const calls: Array<{ tool: string; input: Record<string, unknown>; result: any }> = [];
  const call = async (tool: string, input: Record<string, unknown>) => { const result = service.call(tool as any, input) as any; calls.push({ tool, input, result }); return result; };
  if (!projects.get(projectId)) service.call("create_project", { projectId, operationId: randomUUID(), name: originalTitle, approved: true });
  cleanups.push(() => { edits.shutdown(); db.close(); });
  return { db, projectId, projects, artifacts, workflow, drafts, passages, plans, prose, acceptance, edits, simulations, compilation, service, call, calls, generate, longForm };
}
async function initialized(effectMechanics = false) {
  const f = fixture(); await completeOriginalFoundations(f.call, f.projectId);
  if (effectMechanics) {
    const mechanics = (await f.call("read_foundation", { projectId: f.projectId, artifactId: "mechanics" })).content;
    const proposal = await proposeFoundation(f.call, f.projectId, "mechanics", {
      choiceEffectPlans: mechanics.choiceEffectPlans.map((plan: { mechanicKeys: string[] }) => ({ ...plan, mechanicKeys: [...plan.mechanicKeys, "clock_minutes", "signal_seen"] })),
    }, [
      { targetKey: "mechanics:root", kind: "add-item", collection: "resources", item: { id: "$new:clock", key: "clock_minutes", label: "Fixture counter", kind: "counter", initial: 0, meaning: "An isolated numeric test input, not world time." } },
      { targetKey: "mechanics:root", kind: "add-item", collection: "flags", item: { id: "$new:seen", key: "signal_seen", label: "Signal seen", meaning: "Whether the signal is remembered." } },
    ]);
    await applyFoundation(f.call, f.projectId, proposal.proposalId);
    await approveFoundation(f.call, f.projectId, "mechanics");
  }
  const state = await f.call("game_state", { projectId: f.projectId });
  await f.call("initialize_game_plan", { projectId: f.projectId, operationId: randomUUID(), headFingerprint: state.headFingerprint, approved: true });
  return f;
}
async function completed() { const f = fixture(), proof = await completeConnectedTextGame(f.call, f.projectId); return { ...f, proof }; }

describe("PF004 connected choice effects", () => {
  const openingId = "passage-shared-opening", choiceId = "choice-passage-shared-opening-continue";
  const effect = { id: "$new:effect", mechanicKey: "resolve", operation: "add", value: 2, feedback: "The choice changes resolve.", visibility: "visible" };
  const counts = (f: Awaited<ReturnType<typeof initialized>>) => f.db.prepare(`SELECT
    (SELECT COUNT(*) FROM messages) messages, (SELECT COUNT(*) FROM change_sets) proposals,
    (SELECT COUNT(*) FROM passage_entity_versions) versions, (SELECT COUNT(*) FROM artifact_versions) artifacts`).get();
  const group = (id: string, operations: unknown[]) => ({ id, label: id, explanation: "Review the exact scoped change.", dependsOnGroupIds: [], operations });
  async function prepare(f: Awaited<ReturnType<typeof initialized>>, targets: Array<{ key: string; versionId: string }>) {
    const { plan } = await f.call("prepare_edit", { projectId: f.projectId, operationId: randomUUID(), message: "Review choice effects",
      headFingerprint: (await f.call("project_state", { projectId: f.projectId })).headFingerprint, targets });
    return { projectId: f.projectId, operationId: randomUUID(), planId: plan.id, fingerprint: plan.fingerprint };
  }

  it("rejects a literal ID on an existing choice, but accepts the scoped effects append", async () => {
    const f = await initialized(true), choice = f.passages.currentEntity(f.projectId, "choice", choiceId)!;
    const target = { key: `choice:${choiceId}`, versionId: choice.id };
    const clock = { ...effect, mechanicKey: "clock_minutes", value: 15, feedback: "The fixture counter advances fifteen." };
    const input = await prepare(f, [target]), before = counts(f);
    const submit = (op: unknown) => f.call("submit_edit", { ...input, response: { message: "Add one effect", groups: [group("game", [op])] } });
    await expect(submit({ targetKey: target.key, kind: "set-fields", changes: { effects: [{ ...clock, id: "effect-opening-clock-minimal" }] } })).rejects.toThrow("edit_generated_id_invalid");
    expect(counts(f)).toEqual(before);
    expect(f.passages.currentEntity(f.projectId, "choice", choiceId)).toEqual(choice);
    const proposal = await submit({ targetKey: target.key, kind: "add-item", collection: "effects", item: clock });
    const review = await f.call("review_edit", { projectId: f.projectId, proposalId: proposal.proposalId, groupIds: ["game"] });
    const first = { ...clock, id: review.generatedIds[clock.id] };
    expect(review.outputs).toEqual([{ owner: "choice", targetId: choiceId, before: choice.content,
      after: { ...choice.content as object, effects: [first] } }]);
    const applied = await applyGameEdit(f.call, f.projectId, proposal.proposalId);
    const existing = f.passages.currentEntity(f.projectId, "choice", choiceId)!;
    expect(existing.content).toEqual(review.outputs[0].after);
    const next = await proposeGameEdit(f.call, f.projectId, "Append a second effect", [{ ...target, versionId: existing.id }], [
      { targetKey: target.key, kind: "add-item", collection: "effects", item: { ...effect, id: "$new:subtract", operation: "subtract" } },
    ]);
    await applyGameEdit(f.call, f.projectId, next.proposalId);
    expect(f.passages.currentEntity(f.projectId, "choice", choiceId)?.content).toMatchObject({ id: choiceId, effects: [first, { operation: "subtract", value: 2 }] });
    expect(applied.resultingVersions[target.key]).toBe(existing.id);
    expect(f.generate).not.toHaveBeenCalled();
  });

  it("declares and resolves a new choice's nested effect before reviewing and applying the complete record", async () => {
    const f = await initialized(true), structure = f.passages.currentStructure(f.projectId)!;
    const choice = f.passages.currentEntity(f.projectId, "choice", choiceId)!;
    const opening = f.passages.currentEntity<{ choiceIds: string[] }>(f.projectId, "passage", openingId)!;
    const parent = { key: "passage-structure:root", versionId: structure.id }, source = { key: `passage:${openingId}`, versionId: opening.id };
    const flag = { ...effect, id: "$new:set", mechanicKey: "signal_seen", operation: "set", value: true };
    const clear = { ...flag, id: "$new:clear", operation: "clear", value: null, visibility: "hidden" };
    const item = { ...choice.content as object, id: "$new:alternative", label: "Choose an alternative", position: 1, effects: [effect, flag, clear] };
    const create = { targetKey: parent.key, kind: "add-entity", entityKind: "choice", item };
    const link = { targetKey: source.key, kind: "set-fields", changes: { choiceIds: [...opening.content.choiceIds, item.id] } };
    const input = await prepare(f, [parent, source]), groupIds = ["create", "link"];
    const proposal = await f.call("submit_edit", { ...input, response: { message: "Author an alternative with effects", groups: [group("create", [create]), group("link", [link])] } });
    const before = counts(f);
    const reviewInput = { projectId: f.projectId, proposalId: proposal.proposalId, groupIds };
    await expect(f.call("review_edit", { ...reviewInput, groupIds: ["link"] })).rejects.toThrow("edit_dependency_selection_incomplete");
    await expect(f.call("apply_edit", { ...reviewInput, groupIds: ["link"], operationId: randomUUID(), approved: true, fingerprint: input.fingerprint })).rejects.toThrow("edit_dependency_selection_incomplete");
    expect(counts(f)).toEqual(before);
    const review = await f.call("review_edit", reviewInput);
    const createdId = review.generatedIds[item.id], effectId = review.generatedIds[effect.id];
    expect(createdId).toMatch(/^a6_[0-9a-f]{24}$/);
    expect(effectId).toMatch(/^a6_[0-9a-f]{24}$/);
    expect(createdId).not.toBe(effectId);
    const expected = { ...item, id: createdId, effects: item.effects.map(item => ({ ...item, id: review.generatedIds[item.id] })) };
    expect(new Set(expected.effects.map(item => item.id)).size).toBe(3);
    expect(review.outputs).toContainEqual({ owner: "choice", targetId: createdId, before: null, after: expected });
    expect(f.passages.currentEntity(f.projectId, "choice", createdId)).toBeUndefined();
    const competing = await proposeGameEdit(f.call, f.projectId, "Append an effect on the original choice", [{ key: `choice:${choiceId}`, versionId: choice.id }], [
      { targetKey: `choice:${choiceId}`, kind: "add-item", collection: "effects", item: effect },
    ]);
    const oldReview = await f.call("review_edit", { projectId: f.projectId, proposalId: competing.proposalId, groupIds: ["game"] });
    const projectBefore = await f.call("project_state", { projectId: f.projectId });
    const gameBefore = await f.call("game_state", { projectId: f.projectId });
    await f.call("apply_edit", { ...reviewInput, operationId: randomUUID(), fingerprint: review.fingerprint, approved: true });
    expect(f.passages.currentEntity(f.projectId, "choice", createdId)?.content).toEqual(expected);
    expect(f.passages.currentEntity(f.projectId, "choice", choiceId)).toEqual(choice);
    expect(f.passages.currentEntity(f.projectId, "passage", openingId)?.content).toMatchObject({ choiceIds: [...opening.content.choiceIds, createdId] });
    const projectAfter = await f.call("project_state", { projectId: f.projectId });
    const gameAfter = await f.call("game_state", { projectId: f.projectId });
    expect(projectAfter.workflow).toEqual(projectBefore.workflow);
    expect(gameAfter.state).toMatchObject({ status: "draft", approvedSnapshotId: gameBefore.state.approvedSnapshotId });
    expect(gameAfter.items.every((item: { acceptedDraftVersionId: string | null }) => !item.acceptedDraftVersionId)).toBe(true);
    const after = counts(f);
    await expect(f.call("apply_edit", { projectId: f.projectId, proposalId: competing.proposalId, groupIds: ["game"], operationId: randomUUID(),
      fingerprint: oldReview.fingerprint, approved: true })).rejects.toThrow("edit_base_stale_repreview");
    expect(counts(f)).toEqual(after);
    f.edits.validateArchiveHistory(f.projectId);
  });

  it("rejects invalid identities, ownership, and mechanic references without a proposal or receipt", async () => {
    const f = await initialized(), structure = f.passages.currentStructure(f.projectId)!;
    const opening = f.passages.currentEntity<{ choiceIds: string[] }>(f.projectId, "passage", openingId)!;
    const choice = f.passages.currentEntity(f.projectId, "choice", choiceId)!;
    const parent = { key: "passage-structure:root", versionId: structure.id }, source = { key: `passage:${openingId}`, versionId: opening.id };
    const existing = { key: `choice:${choiceId}`, versionId: choice.id };
    const item = { ...choice.content as object, id: "$new:alternative", label: "Choose an alternative", position: 1, effects: [effect] };
    const link = { targetKey: source.key, kind: "set-fields", changes: { choiceIds: [...opening.content.choiceIds, item.id] } };
    const create = (effects: unknown[], targetKey = parent.key) => ({ targetKey, kind: "add-entity", entityKind: "choice", item: { ...item, effects } });
    const input = await prepare(f, [parent, source, existing]), before = counts(f);
    const cases: Array<[string, unknown[]]> = [
      ["edit_generated_id_invalid", [create([{ ...effect, id: "effect-literal" }]), link]],
      ["edit_generated_id_invalid", [create([{ ...effect, id: choiceId }]), link]],
      ["edit_generated_id_invalid", [create([{ ...effect, id: item.id }]), link]],
      ["edit_generated_id_invalid", [create([effect, effect]), link]],
      ["edit_scope_exceeded", [create([effect]), link, { ...link, targetKey: "passage:unprepared" }]],
      ["edit_entity_creation_scope_invalid", [create([], existing.key), link]],
      ["edit_generated_reference_invalid", [create([{ ...effect, mechanicKey: "$new:missing" }]), link]],
      ["edit_validation_failed", [create([{ ...effect, mechanicKey: "unknown-mechanic" }]), link]],
      ["edit_validation_failed", [create([{ ...effect, operation: "clear", value: null }]), link]],
      ["edit_effect_creation_scope_invalid", [create([effect]), link, { targetKey: existing.key, kind: "set-fields", changes: { effects: [effect] } }]],
      ["edit_generated_id_collision", [create([effect]), link, { targetKey: parent.key, kind: "set-fields",
        changes: { sequences: [...(structure.content as { sequences: object[] }).sequences, { ...(structure.content as { sequences: object[] }).sequences[0], id: effect.id }] } }]],
    ];
    for (const [error, operations] of cases) {
      await expect(f.call("submit_edit", { ...input, response: { message: "Invalid choice effect", groups: [group("game", operations)] } })).rejects.toThrow(error);
      expect(counts(f)).toEqual(before);
      expect(f.passages.currentEntity(f.projectId, "choice", choiceId)).toEqual(choice);
    }
  });
});

describe("M3 connected complete text-game lifecycle", () => {
  it("requires fresh v2 authoring context, preserves retry identity, and replays a completed legacy receipt", async () => {
    const f = await completed(), passageId = "passage-shared-opening", saved = f.calls.find(c => c.tool === "submit_draft")!;
    const context = await f.call("read_authoring_context", { projectId: f.projectId, passageId, request: "Review a neutral candidate" });
    const record = (await f.call("read_game_record", { projectId: f.projectId, kind: "passage", entityId: passageId })).record;
    const input = { projectId: f.projectId, operationId: randomUUID(), headFingerprint: context.headFingerprint, passageId, passageVersionId: record.id, request: "Review a neutral candidate", proseMarkdown: "The room remains quiet.", approved: true };
    expect(() => f.service.call("submit_draft", input)).toThrow("authoring_context_v2_required");
    const current = await f.call("read_authoring_settings", { projectId: f.projectId }), settingsInput = { projectId: f.projectId, expectedVersionId: current.versionId, enabled: false };
    const settingsReview = await f.call("review_authoring_settings", settingsInput);
    await f.call("apply_authoring_settings", { ...settingsInput, fingerprint: settingsReview.fingerprint, operationId: randomUUID(), approved: true });
    expect(() => f.service.call("submit_draft", { ...input, contextVersion: 2, authoringContextFingerprint: context.fingerprint })).toThrow("authoring_context_stale");
    const fresh = await f.call("read_authoring_context", { projectId: f.projectId, passageId, request: input.request });
    const args = { ...input, operationId: randomUUID(), contextVersion: 2, authoringContextFingerprint: fresh.fingerprint }, result = await f.call("submit_draft", args);
    expect(await f.call("submit_draft", args)).toEqual(result);
    const audit = f.artifacts.getCurrent<any>(f.projectId, `draft-authoring-context:${result.draftVersionId}`)!;
    expect(audit.content.authoringInstructions).toMatchObject({ enabled: false, appliedGuide: null });
    expect(audit.content.contextFingerprint).toBe(fresh.fingerprint);
    // Model a completed pre-v2 manual-input receipt, whose immutable candidate already exists.
    const { contextVersion: _v, authoringContextFingerprint: _f, ...old } = saved.input;
    const legacy = ConnectedGameInputs.submit_draft.parse({ ...old, operationId: randomUUID() });
    const conversations = new ConversationRepository(f.db), scope = { kind: "project" as const, projectId: f.projectId }, c = conversations.create(f.projectId, scope, "Legacy receipt fixture");
    conversations.addMessage({ conversationId: c.id, role: "assistant", intent: "discuss", scope, context: {}, content: "submit_draft completed", metadata: { connectedOperation: { operationId: legacy.operationId, tool: "submit_draft", fingerprint: sourceDigest({ tool: "submit_draft", input: legacy }), result: saved.result } } });
    expect(await f.call("submit_draft", legacy)).toEqual(saved.result);
  });

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
    expect(exported.html).not.toContain(builtinFictionCraft().sha256);
    expect(exported.html).not.toContain("project-authoring-settings");
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
    if (tool === "submit_draft") input = { ...input, authoringContextFingerprint: (await f.call("read_authoring_context", { projectId: f.projectId, passageId: input.passageId, request: input.request })).fingerprint, headFingerprint: (await f.call("game_state", { projectId: f.projectId })).headFingerprint, proseMarkdown: "A corrected harbor scene, still a candidate." };
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
    const saved = first.calls.filter((c) => ["compile_game", "simulate_game", "accept_drafts", "submit_edit", "apply_edit"].includes(c.tool));
    expect(saved.filter(c => c.result.proposalId === proof.graphProposalId)).toHaveLength(2);
    await first.client.close(); await first.app.close(); const fresh = await start();
    expect((await fresh.call("game_state", { projectId })).total).toBe(8);
    const choiceInput = { projectId, kind: "choice", entityId: proof.generated["$new:beacon-exit"] };
    const before = await fresh.call("read_game_record", choiceInput);
    expect(before.record.content.effects).toEqual([expect.objectContaining({ id: proof.generated["$new:beacon-insight"], mechanicKey: "insight", operation: "add", value: 1 })]);
    const proposals = await fresh.call("list_edits", { projectId });
    for (const item of saved) expect(await fresh.call(item.tool, item.input)).toEqual(item.result);
    for (const item of saved.filter(c => c.result.proposalId === proof.graphProposalId)) {
      const changed = item.tool === "submit_edit" ? { response: { ...item.input.response as object, message: "A different response" } } : { fingerprint: sourceDigest("changed-fingerprint") };
      await expect(fresh.call(item.tool, { ...item.input, ...changed })).rejects.toThrow("connected_operation_id_conflict");
    }
    expect(await fresh.call("read_game_record", choiceInput)).toEqual(before);
    expect(await fresh.call("list_edits", { projectId })).toEqual(proposals);
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
