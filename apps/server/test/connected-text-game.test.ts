import { testDraftingContext } from "./helpers/authoring-context.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { builtinFictionCraft, selectCreativeDirectionContext, sourceCanonicalJson, sourceDigest, type CreativeDirection, type LongFormEndingPlan, type LongFormMechanicsPlan, type LongFormRoutePlan } from "@story-to-cyoa/domain";
import { ArtifactRepository, ChangeSetRepository, CommandRepository, ConversationRepository, PassageDraftAcceptanceRepository, PassageDraftRepository, PassagePlanRepository, PortableProjectRepository, ProjectRepository, WorkflowRepository, openDatabase } from "@story-to-cyoa/persistence";
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
import { applyPreviewWorld, boundaryProse, completePreviewOpening, initializePreviewOpening, openingSelection, previewChoice, previewStart, previewStop, previewWorld } from "../../../e2e/helpers/partial-preview.js";
import { authoredWorld } from "../../../e2e/helpers/world.js";
import { withAuthoredProgression } from "../../../e2e/helpers/progression.js";
import { boundedSelection, boundedWorld } from "../../../e2e/helpers/bounded-playtest.js";
import { actNativePlayerWorld, chooseNativePlayerSession, createNativePlayerSave, createNativePlayerSession, loadNativePlayerSave, mandatoryEventStatus,
  nativePlayerView, presentCharacters, previewChapterTransition, transitionWorld, visiblePlaytestRestrictions, type WorldCommand } from "@story-to-cyoa/runtime";
import { inspectNativePreviewBoundary, type NativePreviewSelection, type PassageStructure } from "@story-to-cyoa/pipeline";
import { resolveWorld } from "../src/services/world-service.js";

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
  const drafting = testDraftingContext(db);
  const game = new ConnectedGameService(db, edits, plans, prose, simulations, compilation, drafting);
  const service = new ConnectedEditService(db, edits, [projectId], longForm, true, game);
  const calls: Array<{ tool: string; input: Record<string, unknown>; result: any }> = [];
  const call = async (tool: string, input: Record<string, unknown>) => { const result = service.call(tool as any, input) as any; calls.push({ tool, input, result }); return result; };
  if (!projects.get(projectId)) service.call("create_project", { projectId, operationId: randomUUID(), name: originalTitle, approved: true });
  let closed = false;
  const close = () => { if (!closed) { closed = true; edits.shutdown(); db.close(); } };
  cleanups.push(close);
  return { db, projectId, projects, artifacts, workflow, drafts, passages, plans, prose, acceptance, edits, simulations, compilation, service, call, calls, generate, longForm, drafting, close };
}
async function initialized(effectMechanics = false, f = fixture()) {
  await completeOriginalFoundations(f.call, f.projectId);
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

async function largePassagePlan(f: ReturnType<typeof fixture>, sequenceSize = 410) {
  const { projectId } = f;
  const bundle = f.plans.bundle(projectId);
  const anchor = bundle.passages.find(item => item.id === "passage-route-1-act")!;
  const outgoing = bundle.choices.find(item => item.id === "choice-passage-route-1-act-continue")!;
  const sequence = bundle.structure.sequences.find(item => item.id === anchor.sequenceId)!;
  const ids = Array.from({ length: sequenceSize - sequence.passageIds.length }, (_, i) => `passage-harbor-watch-route-public-quay-ledger-investigation-and-testimony-at-the-signal-station-before-the-next-shift-with-the-port-watch-and-dockworkers-${i + 1}`);
  const destination = outgoing.destinationPassageId;
  outgoing.destinationPassageId = ids[0]!;
  ids.forEach((id, i) => {
    const choiceId = `choice-harbor-watch-${i + 1}-continue`;
    bundle.passages.push({ ...anchor, id, title: `Watch testimony ${i + 1}`, summary: "The harbor watch records a new witness and checks the ledger.", wordTarget: 180, choiceIds: [choiceId], position: i + 1 });
    bundle.choices.push({ ...outgoing, id: choiceId, sourcePassageId: id, destinationPassageId: ids[i + 1] ?? destination, position: 0 });
  });
  sequence.passageIds.push(...ids);
  sequence.summary += " Keep the testimony attributed and separate eyewitness accounts from inference. Preserve the ledger's chronology and the risks to the harbor crew.".repeat(25);
  f.plans.saveBundle(projectId, bundle);
  await approveGamePlan(f.call, projectId);
  return { bundle, anchor, outgoing, sequence };
}

describe("PF-005 bounded passage-plan creation", () => {
  const writes = (f: ReturnType<typeof fixture>) => f.db.prepare(`SELECT
    (SELECT COUNT(*) FROM messages) messages, (SELECT COUNT(*) FROM change_sets) proposals,
    (SELECT COUNT(*) FROM artifact_versions) artifacts, (SELECT COUNT(*) FROM passage_structure_versions) structures,
    (SELECT COUNT(*) FROM passage_entity_versions) entities, (SELECT COUNT(*) FROM passage_draft_versions) drafts`).get();
  const prepare = async (f: ReturnType<typeof fixture>, targets: Array<{ key: string; versionId: string }>) => {
    const { projectId, call } = f;
    const { headFingerprint } = await call("project_state", { projectId });
    return call("prepare_edit", { projectId, operationId: randomUUID(), message: "Add a ledger inspection beat and link it to the harbor investigation.", headFingerprint, targets });
  };
  const create = (kind: string) => `create:passage-plan:${kind}`;
  const link = (sequenceId: string) => `collection:sequence:${sequenceId}:passageIds`;
  async function prepared(f: ReturnType<typeof fixture>, data: Awaited<ReturnType<typeof largePassagePlan>>, extraKeys: string[] = []) {
    const { projectId, call } = f, { anchor, sequence, outgoing } = data;
    const keys = [create("passage"), create("choice"), create("thread"), link(sequence.id), `passage:${anchor.id}`, ...extraKeys];
    const targets = await Promise.all(keys.map(async key => {
      const result = await call("list_edit_targets", { projectId, search: key });
      const target = result.items.find((item: { key: string }) => item.key === key);
      expect(target, key).toBeDefined();
      return { key, versionId: target.versionId };
    }));
    const { plan } = await prepare(f, targets);
    const add = (entityKind: string, item: object) => ({ kind: "add-entity", targetKey: create(entityKind), entityKind, item });
    const additions = [
      add("passage", { ...anchor, id: "$new:inspection", title: "Check the ledger seal", position: sequence.passageIds.length,
        choiceIds: ["$new:resume"], payoffThreadIds: ["$new:seal-thread"] }),
      add("choice", { ...outgoing, id: "$new:resume", label: "Resume the watch", sourcePassageId: "$new:inspection",
        effects: [{ id: "$new:resolve-effect", mechanicKey: "resolve", operation: "add", value: 1, feedback: "Mira commits to the inquiry.", visibility: "visible" }] }),
      add("choice", { ...outgoing, id: "$new:inspect", label: "Check the seal first", destinationPassageId: "$new:inspection", position: 2 }),
      add("thread", { id: "$new:seal-thread", label: "The broken seal", description: "The opened ledger confirms the earlier clue.",
        setupPassageIds: [anchor.id], payoffPassageIds: ["$new:inspection"], routeIds: anchor.routeIds, required: false, status: "planned", waiverRationale: "" }),
    ];
    const linking = [
      { kind: "append-passage", targetKey: link(sequence.id), passageId: "$new:inspection" },
      { kind: "set-fields", targetKey: `passage:${anchor.id}`, changes: { choiceIds: [...anchor.choiceIds, "$new:inspect"], setupThreadIds: [...anchor.setupThreadIds, "$new:seal-thread"] } },
    ];
    const group = (id: string, operations: unknown[]) => ({ id, label: id, explanation: "Connect the evidence to its consequence.", dependsOnGroupIds: [], operations });
    const submit = { projectId, operationId: randomUUID(), planId: plan.id, fingerprint: plan.fingerprint,
      response: { message: "An optional ledger inspection with a visible Resolve effect.", groups: [group("create", additions), group("link", linking)] } };
    return { plan, additions, linking, group, submit, targets };
  }

  it("reproduces the sole-root overflow on a valid, large sequence with real passage and choice records", async () => {
    const f = await initialized(), { sequence } = await largePassagePlan(f);
    expect(Buffer.byteLength(sourceCanonicalJson(sequence))).toBeGreaterThan(64_000);
    const { id: versionId } = f.passages.currentStructure(f.projectId)!;
    const before = writes(f);
    await expect(prepare(f, [{ key: "passage-structure:root", versionId }])).rejects.toThrow("edit_dependency_overflow_narrow_scope");
    expect(writes(f)).toEqual(before);
  });

  it("reviews and atomically applies linked records without the root, then replays exact receipts after reopening", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cyoa-pf005-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "fixture.sqlite"), f = await initialized(false, fixture(openDatabase(path))), { call, projectId } = f;
    const data = await largePassagePlan(f, 999), { bundle, anchor, sequence, outgoing } = data;
    expect(sequence.passageIds).toHaveLength(999);
    const unrelated = await submitGameDraft(call, projectId, previewStart, "Mira leaves the lamp burning and takes the ledger into the rain.");
    await acceptGameDrafts(call, projectId, [{ passageId: previewStart, candidateDraftVersionId: unrelated.draftVersionId }]);
    const accepted = f.drafts.getHead(projectId, previewStart), state = f.passages.state(projectId);
    const foundations = (await call("project_state", { projectId })).workflow;
    const outgoingBefore = f.passages.currentEntity(projectId, "choice", outgoing.id);
    const { plan, submit, targets } = await prepared(f, data);
    expect(plan.targets.map((item: { key: string }) => item.key)).toEqual(targets.map(item => item.key));
    expect(plan.context.authoringInstructions).toEqual(f.artifacts.authoringInstructions(projectId));
    expect(plan.context.approvedDirection.versionId).toBe(f.workflow.get(projectId, "creative-direction").approvedVersionId);
    expect(plan.targets.find((item: { key: string }) => item.key === link(sequence.id)).value).toMatchObject({ itemCount: sequence.passageIds.length, maxItems: 1000 });
    expect(sourceCanonicalJson(plan.context)).not.toContain(sequence.passageIds.at(-1)!);
    expect(plan.contextBytes).toBeLessThan(64_000);
    const proposed = await call("submit_edit", submit);
    const { proposal, omittedDraftImpactCount } = await call("get_edit", { projectId, proposalId: proposed.proposalId });
    expect(omittedDraftImpactCount).toBeGreaterThanOrEqual(1000);
    expect(proposal.expectedDraftImpacts).toBeUndefined();
    const ids = proposal.generatedIds;
    const before = writes(f), canonicalBefore = sourceDigest(f.plans.bundle(projectId));
    const groupIds = ["create", "link"], reviewInput = { projectId, proposalId: proposed.proposalId, groupIds };
    await expect(call("review_edit", { ...reviewInput, groupIds: ["link"] })).rejects.toThrow("edit_dependency_selection_incomplete");
    await expect(call("review_edit", { ...reviewInput, groupIds: ["create"] })).rejects.toThrow("edit_sequence_passage_link_required");
    const review = await call("review_edit", reviewInput);
    const next = await call("review_edit", { ...reviewInput, draftImpactOffset: 50 });
    expect(next.fingerprint).toBe(review.fingerprint);
    expect(next.draftImpactPage).toMatchObject({ offset: 50, total: expect.any(Number) });
    expect(next.draftImpactPage.total).toBe(omittedDraftImpactCount);
    expect(next.draftImpacts[0]).not.toEqual(review.draftImpacts[0]);
    expect(review.outputs).toEqual(expect.arrayContaining([
      { owner: "passage-structure", targetId: sequence.id, before: expect.objectContaining({ count: sequence.passageIds.length }),
        after: { sequenceId: sequence.id, count: sequence.passageIds.length + 1, appendedPassageIds: [ids["$new:inspection"]], existingOrderUnchanged: true } },
      { owner: "choice", targetId: ids["$new:resume"], before: null,
        after: expect.objectContaining({ sourcePassageId: ids["$new:inspection"], effects: [expect.objectContaining({ id: ids["$new:resolve-effect"], mechanicKey: "resolve", value: 1 })] }) },
      { owner: "thread", targetId: ids["$new:seal-thread"], before: null, after: expect.objectContaining({ payoffPassageIds: [ids["$new:inspection"]] }) },
    ]));
    const apply = { ...reviewInput, operationId: randomUUID(), fingerprint: review.fingerprint, approved: true };
    await expect(call("apply_edit", { ...apply, approved: false })).rejects.toThrow();
    await expect(call("apply_edit", { ...apply, fingerprint: "0".repeat(64) })).rejects.toThrow("edit_apply_preview_stale");
    f.db.exec("CREATE TEMP TRIGGER fail_pf005 BEFORE INSERT ON messages WHEN json_extract(NEW.metadata_json,'$.connectedOperation.tool')='apply_edit' BEGIN SELECT RAISE(ABORT,'PF-005 receipt failed'); END");
    await expect(call("apply_edit", apply)).rejects.toThrow("PF-005 receipt failed");
    expect(writes(f)).toEqual(before);
    expect(sourceDigest(f.plans.bundle(projectId))).toBe(canonicalBefore);
    f.db.exec("DROP TRIGGER fail_pf005");
    const applied = await call("apply_edit", apply);
    const expected = structuredClone(bundle.structure);
    expected.sequences.find(item => item.id === sequence.id)!.passageIds.push(ids["$new:inspection"]);
    expect(f.passages.currentStructure(projectId)?.content).toEqual(expected);
    expect(f.passages.currentEntity(projectId, "choice", outgoing.id)).toEqual(outgoingBefore);
    expect(f.passages.currentEntity(projectId, "passage", anchor.id)?.content).toEqual({ ...anchor,
      choiceIds: [...anchor.choiceIds, ids["$new:inspect"]], setupThreadIds: [...anchor.setupThreadIds, ids["$new:seal-thread"]] });
    expect(f.passages.currentEntity(projectId, "passage", ids["$new:inspection"])?.content).toMatchObject({ sequenceId: sequence.id,
      choiceIds: [ids["$new:resume"]], payoffThreadIds: [ids["$new:seal-thread"]] });
    expect(f.passages.state(projectId)).toMatchObject({ status: "draft", approvedSnapshotId: state.approvedSnapshotId });
    expect((await call("project_state", { projectId })).workflow).toEqual(foundations);
    expect(f.drafts.getHead(projectId, previewStart)).toEqual(accepted);
    expect(f.drafts.getHead(projectId, ids["$new:inspection"])).toBeUndefined();
    await expect(prepare(f, targets)).rejects.toThrow("edit_target_version_stale_repreview");
    const preparedCall = f.calls.find(item => item.result?.plan?.id === plan.id)!;
    const after = writes(f);
    f.edits.validateArchiveHistory(projectId);
    f.close();
    const reopened = fixture(openDatabase(path), projectId);
    expect(await reopened.call("prepare_edit", preparedCall.input)).toEqual(preparedCall.result);
    expect(await reopened.call("submit_edit", submit)).toEqual(proposed);
    expect(await reopened.call("apply_edit", apply)).toEqual(applied);
    await expect(reopened.call("apply_edit", { ...apply, groupIds: ["create"] })).rejects.toThrow("connected_operation_id_conflict");
    await expect(reopened.call("submit_edit", { ...submit, response: { ...submit.response, message: "A different request." } })).rejects.toThrow("connected_operation_id_conflict");
    expect(writes(reopened)).toEqual(after);
    const overflow = await prepared(reopened, data);
    const beforeOverflow = writes(reopened);
    await expect(reopened.call("submit_edit", overflow.submit)).rejects.toThrow("edit_sequence_passage_capacity_exceeded");
    expect(writes(reopened)).toEqual(beforeOverflow);
    expect(f.generate).not.toHaveBeenCalled();
    expect(reopened.generate).not.toHaveBeenCalled();
  });

  it("rejects wrong scope, references, locked or mismatched links, and stale submit/Apply without writes", async () => {
    const f = await initialized(), { projectId, call } = f, data = await largePassagePlan(f);
    const otherSequence = data.bundle.structure.sequences.find(item => item.id !== data.sequence.id)!;
    const { additions, linking, submit, group } = await prepared(f, data, [link(otherSequence.id)]);
    const [passage, choice, , thread] = additions, [append, changeSource] = linking;
    const replace = (index: number, changes: object) => additions.map((op, i) => i === index ? { ...op, ...changes } : op);
    const input = (creates: unknown[], links: unknown[]) => ({ ...submit, response: { ...submit.response,
      groups: [group("create", creates), group("link", links)] } });
    const errors: Array<[string, unknown[], unknown[]]> = [
      ["edit_entity_creation_scope_invalid", replace(0, { targetKey: create("thread") }), linking],
      ["edit_scope_exceeded", replace(0, { targetKey: "passage-structure:root" }), linking],
      ["edit_entity_creation_scope_invalid", [...additions, { kind: "set-fields", targetKey: create("thread"), changes: { label: "Not authorized" } }], linking],
      ["edit_generated_id_invalid", replace(0, { item: { ...passage!.item, id: "literal-passage" } }), linking],
      ["edit_generated_id_invalid", replace(1, { item: { ...choice!.item, effects: [
        { id: "$new:inspection", mechanicKey: "resolve", operation: "add", value: 1, feedback: "", visibility: "visible" },
      ] } }), linking],
      ["edit_generated_reference_invalid", replace(1, { item: { ...choice!.item, destinationPassageId: "$new:unknown" } }), linking],
      ["edit_validation_failed", replace(1, { item: { ...choice!.item, destinationPassageId: "missing-passage" } }), linking],
      ["edit_validation_failed", replace(3, { item: { ...thread!.item, setupPassageIds: ["missing-passage"] } }), linking],
      ["edit_sequence_passage_scope_invalid", additions, [{ ...append, targetKey: changeSource!.targetKey }, changeSource]],
      ["edit_sequence_passage_scope_invalid", additions, [{ kind: "set-fields", targetKey: append!.targetKey, changes: { passageIds: [] } }, changeSource]],
      ["edit_sequence_passage_link_invalid", additions, [{ ...append, targetKey: link(otherSequence.id) }, changeSource]],
      ["edit_sequence_passage_link_invalid", additions, [{ ...append, passageId: data.anchor.id }, changeSource]],
      ["edit_sequence_passage_duplicate", additions, [...linking, append]],
      ["edit_sequence_passage_link_required", additions, [changeSource]],
      ["edit_validation_failed", additions, [append]],
    ];
    const before = writes(f);
    for (const [error, creates, links] of errors) {
      await expect(call("submit_edit", input(creates, links)), error).rejects.toThrow(error);
      expect(writes(f)).toEqual(before);
    }
    f.db.exec("CREATE TEMP TRIGGER fail_pf005_submit BEFORE INSERT ON messages WHEN json_extract(NEW.metadata_json,'$.connectedOperation.tool')='submit_edit' BEGIN SELECT RAISE(ABORT,'PF-005 submit receipt failed'); END");
    await expect(call("submit_edit", submit)).rejects.toThrow("PF-005 submit receipt failed");
    expect(writes(f)).toEqual(before);
    f.db.exec("DROP TRIGGER fail_pf005_submit");
    const proposal = await call("submit_edit", submit);
    const reviewArgs = { projectId, proposalId: proposal.proposalId, groupIds: ["create", "link"] };
    const review = await call("review_edit", reviewArgs);
    const unsent = await prepared(f, data);
    const structure = f.passages.currentStructure<PassageStructure>(projectId)!.content;
    structure.sequences.find(item => item.id === data.sequence.id)!.planningStatus = "locked";
    f.plans.saveStructure(projectId, structure);
    const afterLock = writes(f);
    await expect(call("submit_edit", unsent.submit)).rejects.toThrow("edit_base_stale_repreview");
    await expect(call("apply_edit", { ...reviewArgs, operationId: randomUUID(), fingerprint: review.fingerprint, approved: true })).rejects.toThrow("edit_base_stale_repreview");
    expect(writes(f)).toEqual(afterLock);
    const locked = await prepared(f, data);
    const beforeLockedSubmit = writes(f);
    await expect(call("submit_edit", locked.submit)).rejects.toThrow("edit_planning_lock_protected");
    expect(writes(f)).toEqual(beforeLockedSubmit);
  });
});

describe("explicit bounded World playtests", () => {
  const review = (f: ReturnType<typeof fixture>, selection: NativePreviewSelection = boundedSelection) =>
    f.call("review_preview", { projectId: f.projectId, selection });
  const args = (f: ReturnType<typeof fixture>, r: any) => ({ projectId: f.projectId, selection: r.selection,
    headFingerprint: r.headFingerprint, fingerprint: r.fingerprint, approved: true, operationId: randomUUID() });
  const writes = (f: ReturnType<typeof fixture>) => f.db.prepare(`SELECT
    (SELECT COUNT(*) FROM artifact_versions) artifacts, (SELECT COUNT(*) FROM messages) messages,
    (SELECT COUNT(*) FROM passage_draft_versions) drafts, (SELECT COUNT(*) FROM passage_plan_snapshots) snapshots`).get();
  async function setup(f = fixture()) {
    await completePreviewOpening(f.call, f.projectId);
    const world = await boundedWorld(f.call, f.projectId);
    const applied = await applyPreviewWorld(f.call, f.projectId, world);
    return { f, world, versionId: applied.versionId };
  }

  it("reviews exact hidden/disabled exclusions, then blocks every excluded dispatch without losing entering effects", async () => {
    const { f, world, versionId } = await setup(), { call, projectId } = f;
    const fullBefore = await call("publication_readiness", { projectId });
    const faithful = await review(f, openingSelection);
    expect(faithful).toMatchObject({ mode: "faithful-slice", ready: false });
    expect(faithful.blockers).toContainEqual(expect.objectContaining({ sourceId: "future-encounter" }));
    const r = await review(f);
    expect(r).toMatchObject({ ready: true, mode: "bounded-playtest", acceptedDraftCount: 2, choiceCount: 0,
      reachability: expect.stringContaining("does not prove"), world: { versionId } });
    expect(r.boundary.boundedPlaytest.exclusions).toHaveLength(boundedSelection.exclusions!.length);
    expect(r.boundary.boundedPlaytest.exclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "event", id: "future-encounter", mandatory: true, presentation: "hidden",
        label: "Secret future encounter", sourceLocationId: "home", sourceChapterId: "day-one", sourcePassageId: previewStart,
        destinationPassageId: "passage-route-1-act", destinationLocationId: "station", destinationTitle: expect.any(String) }),
      expect.objectContaining({ kind: "travel", id: "home-station", presentation: "disabled", sourceLocationId: "home", destinationLocationId: "station" }),
    ]));
    expect(r.boundary.boundedPlaytest.omitted).toEqual(expect.arrayContaining([
      { kind: "location", id: "station" }, { kind: "travel", id: "station-home" },
      { kind: "schedule", id: "mara-future" }, { kind: "override-destination", id: "mara-off-map", ownerId: "station" },
    ]));
    const built = await call("compile_preview", args(f, r));
    const { bundle, playerConfig } = f.compilation.loadPreviewBuild(projectId, built.buildVersionId);
    const initial = createNativePlayerSession(bundle, playerConfig), before = structuredClone(initial);
    const step = (command: WorldCommand, session = initial) => actNativePlayerWorld(bundle, playerConfig, session, command);
    const projection = bundle.world!;
    expect(projection.locations.map(l => l.id)).toEqual(["town", "home", "cafe"]);
    expect(bundle.choices).toEqual([]);
    expect(projection.people!.events.map(e => e.eventId)).toEqual(["correction"]);
    expect(projection.economy!.eventEffects.map(e => e.eventId)).toEqual(["correction"]);
    expect(projection.progression!.transitions[0]!.expireEventIds).toEqual([]);
    expect(JSON.stringify(bundle)).not.toMatch(/Secret future encounter|Read the secret itinerary|Secret future gift|Secret future use/);
    expect(visiblePlaytestRestrictions(bundle.preview, initial.state, true).map(a => a.id)).toEqual([previewChoice]);
    expect(visiblePlaytestRestrictions(bundle.preview, initial.state, false).map(a => a.id)).toEqual(["home-station", "future-chapter", "future-offer"]);
    expect(() => chooseNativePlayerSession(bundle, playerConfig, initial, previewChoice)).toThrow("Outside this preview");
    const commands: WorldCommand[] = [
      { kind: "travel", id: "home-station" }, { kind: "action", id: "future-local" }, { kind: "wait", minutes: 60 },
      { kind: "event", id: "future-encounter" }, { kind: "chapter-transition", id: "future-chapter", previewFingerprint: "0".repeat(32) },
      { kind: "purchase", id: "future-offer" }, { kind: "gift", id: "future-gift" }, { kind: "use", id: "future-use" },
    ];
    for (const command of commands) {
      expect(() => step(command)).toThrow("Outside this preview");
      expect(() => transitionWorld(projection, initial.state, command)).toThrow();
      expect(initial).toEqual(before);
    }
    const waited = step({ kind: "wait", minutes: 15 }).session;
    expect(waited.state.world).toMatchObject({ minutes: 1445, progression: { knownEventIds: ["correction"], expiredEventIds: [], events: {} } });
    expect(presentCharacters(projection, waited.state)).toEqual([]);
    expect(mandatoryEventStatus(projection, waited.state)).toEqual({ eventId: null, conflict: false });
    const closing = previewChapterTransition(projection, initial.state, "close-day");
    expect(closing.lostOpportunities.map(item => item.id)).not.toContain("future-encounter");
    expect(step({ kind: "chapter-transition", id: "close-day", previewFingerprint: closing.fingerprint }).session.state.world!.progression)
      .toMatchObject({ chapterId: "closing", expiredEventIds: [], transitions: { "close-day": 1 } });
    expect(step({ kind: "travel", id: "home-cafe" }).session.state.world).toMatchObject({ locationId: "cafe", minutes: 1445 });
    const corrected = step({ kind: "event", id: "correction" });
    expect(corrected).toMatchObject({ message: "The corrected ledger balances.", session: { state: {
      currentPassageId: previewStop, world: { locationId: "cafe", minutes: 1435, economy: { currency: 7, items: { tea: 0 } },
        progression: { events: { correction: { count: 1 } }, expiredEventIds: [], milestones: ["corrected"] } },
    } } });
    const save = createNativePlayerSave(bundle, playerConfig, corrected.session);
    const restored = loadNativePlayerSave(bundle, playerConfig, save);
    expect(restored.state).toEqual(corrected.session.state);
    expect(nativePlayerView(bundle, playerConfig, restored)).toMatchObject({ previewStopped: true, passage: { proseMarkdown: boundaryProse }, terminal: { result: null } });
    expect(() => step({ kind: "travel", id: "cafe-home" }, restored)).toThrow("native_preview_stop_reached");
    const revised: NativePreviewSelection = { ...boundedSelection, exclusions: boundedSelection.exclusions!.map(e => e.id === "home-station" ? { ...e, presentation: "hidden" } : e) };
    const changed = await review(f, revised);
    const next = f.compilation.loadPreviewBuild(projectId, (await call("compile_preview", args(f, changed))).buildVersionId);
    expect(next.bundle.bundleFingerprint).not.toBe(bundle.bundleFingerprint);
    expect(() => loadNativePlayerSave(next.bundle, next.playerConfig, save)).toThrow();
    expect((await call("read_world", { projectId })).world).toEqual(world);
    expect(await call("publication_readiness", { projectId })).toEqual(fullBefore);
    expect(fullBefore.ready).toBe(false);
  });

  it("blocks unreviewed escapes, invalid exclusions, broken canonical references and a missing structural route", async () => {
    const { f, world } = await setup(), { projectId } = f;
    const cases: Array<[NativePreviewSelection, string]> = [
      [{ ...boundedSelection, exclusions: boundedSelection.exclusions!.filter(e => e.id !== "home-station") }, "explicitly exclude this command"],
      [{ ...boundedSelection, exclusions: [...boundedSelection.exclusions!, boundedSelection.exclusions![0]!] }, "Duplicate exclusion"],
      [{ ...boundedSelection, exclusions: [...boundedSelection.exclusions!, { kind: "event", id: "invented", presentation: "hidden" }] }, "not an exact command"],
      [{ ...boundedSelection, mode: "faithful-slice" }, "Exclusions require bounded playtest"],
      [{ ...boundedSelection, startPassageId: previewStop }, "Use the canonical World start"],
      [{ ...boundedSelection, exclusions: [...boundedSelection.exclusions!, { kind: "travel", id: "home-cafe", presentation: "hidden" },
        { kind: "event", id: "correction", presentation: "hidden" }, { kind: "chapter-transition", id: "close-day", presentation: "hidden" }] }, "no structural path"],
    ];
    const before = writes(f);
    for (const [selection, diagnostic] of cases) {
      const r = await review(f, selection);
      expect(r.ready).toBe(false);
      expect(r.blockers).toContainEqual(expect.objectContaining({ message: expect.stringContaining(diagnostic) }));
      await expect(f.call("compile_preview", args(f, r))).rejects.toThrow("connected_preview_not_ready");
    }
    expect(writes(f)).toEqual(before);
    const snapshot = f.plans.bundle(projectId);
    const native = resolveWorld(f.artifacts, projectId, f.passages.currentEntities(projectId, "passage").map(p => ({ entityId: p.entityId, versionId: p.id })))!.presentation!;
    native.progression!.events.find(e => e.id === "future-encounter")!.passageId = "missing-canonical-passage";
    expect(inspectNativePreviewBoundary(boundedSelection, snapshot.passages, snapshot.choices, native).blockers)
      .toContainEqual(expect.objectContaining({ id: "future-encounter", message: expect.stringContaining("missing canonical destination") }));
    world.progression!.events[0]!.prerequisites.push({ kind: "location", locationId: "station", present: false });
    await applyPreviewWorld(f.call, projectId, world);
    const depends = await review(f);
    expect(depends.blockers).toContainEqual(expect.objectContaining({ sourceId: "correction", message: expect.stringContaining("depends on excluded location station") }));
  });

  it("binds the exact reviewed version, rolls back a failed receipt, and replays a portable build after reopening", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cyoa-bounded-playtest-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "fixture.sqlite");
    const { f, world } = await setup(fixture(openDatabase(path))), { projectId, call } = f;
    const stale = await review(f);
    await applyPreviewWorld(call, projectId, { ...world, initialMinutes: 1429 });
    const current = await review(f), input = args(f, current), before = writes(f);
    await expect(call("compile_preview", args(f, stale))).rejects.toThrow("head_stale");
    await expect(call("compile_preview", { ...input, selection: { ...boundedSelection, exclusions: boundedSelection.exclusions!.map(e => ({ ...e, presentation: "hidden" })) } }))
      .rejects.toThrow("connected_preview_review_stale");
    f.db.exec("CREATE TEMP TRIGGER fail_bounded_receipt BEFORE INSERT ON messages WHEN json_extract(NEW.metadata_json,'$.connectedOperation.tool')='compile_preview' BEGIN SELECT RAISE(ABORT,'bounded receipt failed'); END");
    await expect(call("compile_preview", input)).rejects.toThrow("bounded receipt failed");
    expect(writes(f)).toEqual(before);
    f.db.exec("DROP TRIGGER fail_bounded_receipt");
    const built = await call("compile_preview", input), after = writes(f);
    f.close();
    const reopened = fixture(openDatabase(path), projectId);
    expect(await reopened.call("compile_preview", input)).toEqual(built);
    await expect(reopened.call("compile_preview", { ...input, fingerprint: "0".repeat(64) })).rejects.toThrow("connected_operation_id_conflict");
    expect(writes(reopened)).toEqual(after);
    const exports = new PublicationExportService(new PortableProjectRepository(reopened.db), reopened.compilation);
    for (const mode of ["full-fidelity", "privacy-redacted"] as const) {
      const target = openDatabase();
      try {
        new PublicationExportService(new PortableProjectRepository(target), undefined).importPortable(exports.exportStudioPortable(projectId, mode).bytes);
        validatePortableAuthoringProject(target, projectId);
      } finally { target.close(); }
    }
  });
});

describe("PF-008 reviewed partial preview", () => {
  const review = (f: ReturnType<typeof fixture>, selection = openingSelection) => f.call("review_preview", { projectId: f.projectId, selection });
  const args = (f: ReturnType<typeof fixture>, r: any) => ({ projectId: f.projectId, selection: r.selection,
    headFingerprint: r.headFingerprint, fingerprint: r.fingerprint, approved: true, operationId: randomUUID() });
  const writes = (f: ReturnType<typeof fixture>) => f.db.prepare(`SELECT
    (SELECT COUNT(*) FROM artifact_versions) artifacts, (SELECT COUNT(*) FROM messages) messages,
    (SELECT COUNT(*) FROM passage_draft_versions) drafts, (SELECT COUNT(*) FROM passage_plan_snapshots) snapshots`).get();

  it("requires exact accepted prose and reviewed stop; builds an isolated opening without changing the authoring or publication state", async () => {
    const f = fixture(), { call, projectId } = f;
    const candidates = await initializePreviewOpening(call, projectId);
    await acceptGameDrafts(call, projectId, candidates.slice(0, 1));
    const missing = await review(f), beforeMissing = writes(f);
    expect(missing.ready).toBe(false);
    expect(missing.blockers).toEqual([expect.objectContaining({ code: "publication.accepted-prose-missing", sourceId: previewStop })]);
    expect(f.drafts.getHead(projectId, previewStop)?.current?.id).toBe(candidates[1]!.candidateDraftVersionId);
    await expect(call("compile_preview", args(f, missing))).rejects.toThrow("connected_preview_not_ready");
    expect(writes(f)).toEqual(beforeMissing);
    await acceptGameDrafts(call, projectId, candidates.slice(1));
    const before = writes(f), authored = await call("game_state", { projectId }), foundations = await call("project_state", { projectId });
    const ready = await review(f), full = await call("publication_readiness", { projectId });
    expect(writes(f)).toEqual(before);
    expect(ready).toMatchObject({ ready: true, kind: "partial-preview", acceptedDraftCount: 2, passageCount: 2, choiceCount: 1,
      boundary: { stopPassageId: previewStop, suppressedChoices: expect.arrayContaining([
        { id: "choice-passage-shared-route-pivot-continue", destinationPassageId: "passage-route-1-act" },
      ]), suppressedWorldCommands: [] } });
    expect(ready.acceptedDrafts.map((draft: { versionId: string }) => draft.versionId)).toEqual(
      [f.drafts.getHead(projectId, previewStart)!.accepted!.id, f.drafts.getHead(projectId, previewStop)!.accepted!.id]);
    expect(full.ready).toBe(false);
    expect(full.blockers.some((b: { sourceId: string }) => b.sourceId === "passage-ending-1")).toBe(true);
    const { selection: _selection, ...fullInput } = args(f, full);
    await expect(call("compile_game", fullInput)).rejects.toThrow("Current project is not ready for native compilation");
    const input = args(f, ready);
    await expect(call("compile_preview", { ...input, approved: false })).rejects.toThrow();
    await expect(call("compile_preview", { ...input, selection: { ...openingSelection, stopPassageId: previewStart } })).rejects.toThrow("connected_preview_review_stale");
    expect(writes(f)).toEqual(before);
    const built = await call("compile_preview", input);
    const { bundle, playerConfig } = f.compilation.loadPreviewBuild(projectId, built.buildVersionId);
    expect(bundle.preview).toEqual(ready.boundary);
    expect(bundle.passages.map(passage => passage.id)).toEqual(openingSelection.passageIds);
    const initial = createNativePlayerSession(bundle, playerConfig);
    const stopped = chooseNativePlayerSession(bundle, playerConfig, initial, previewChoice).session;
    expect(stopped.state.stats.resolve).toBe(initial.state.stats.resolve! + 1);
    const view = nativePlayerView(bundle, playerConfig, stopped);
    expect(view).toMatchObject({ previewStopped: true, choices: [], passage: { proseMarkdown: boundaryProse }, terminal: { result: null } });
    expect(await call("game_state", { projectId })).toEqual(authored);
    expect((await call("project_state", { projectId })).workflow).toEqual(foundations.workflow);
    expect(await call("publication_readiness", { projectId })).toEqual(full);
    expect(f.compilation.listBuilds(projectId)).toEqual([]);
    expect(() => f.compilation.compile(projectId, built.inputVersionId)).toThrow();
    await expect(call("export_game", { projectId, buildVersionId: built.buildVersionId, format: "standalone", allowHistorical: true })).rejects.toThrow();
    const after = writes(f);
    expect(await call("compile_preview", input)).toEqual(built);
    await expect(call("compile_preview", { ...input, selection: { ...openingSelection, stopPassageId: previewStart } })).rejects.toThrow("connected_operation");
    expect(writes(f)).toEqual(after);
    const exports = new PublicationExportService(new PortableProjectRepository(f.db), f.compilation);
    const restored = fixtureFromBackup(f, exports.exportStudioPortable(projectId, "full-fidelity").bytes);
    expect(await restored.call("compile_preview", input)).toEqual(built);
    const copy = restored.projects.duplicate(projectId, "Copied partial playtest", validatePortableAuthoringProject, prepareStudioHistoryDuplicate);
    const copyBuild = restored.artifacts.getCurrent(copy.id, "native-preview-builds")!;
    expect(restored.compilation.loadPreviewBuild(copy.id, copyBuild.id).bundle.preview).toEqual(bundle.preview);
    expect(restored.compilation.readiness(copy.id).ready).toBe(false);
    expect(f.generate).not.toHaveBeenCalled();
  });

  function fixtureFromBackup(f: ReturnType<typeof fixture>, bytes: Uint8Array) {
    const db = openDatabase();
    try { new PublicationExportService(new PortableProjectRepository(db), undefined).importPortable(bytes); }
    catch (error) { db.close(); throw error; }
    return fixture(db, f.projectId);
  }

  it("blocks a choice escape outside the stop and stale review/prose with no preview writes", async () => {
    const f = fixture(), { call, projectId } = f;
    await completePreviewOpening(call, projectId);
    const original = await review(f);
    expect(original.ready).toBe(true);
    const escape = await review(f, { ...openingSelection, passageIds: [previewStart, "passage-route-1-act"], stopPassageId: "passage-route-1-act" });
    expect(escape.blockers).toContainEqual(expect.objectContaining({ sourceId: previewChoice, message: expect.stringContaining(previewStop) }));
    const beforeEscape = writes(f);
    await expect(call("compile_preview", args(f, escape))).rejects.toThrow("connected_preview_not_ready");
    expect(writes(f)).toEqual(beforeEscape);
    const { record } = await call("read_game_record", { projectId, kind: "passage", entityId: previewStop });
    const key = `passage:${previewStop}`;
    const proposal = await proposeGameEdit(call, projectId, "Move the harbor decision under the clock",
      [{ key, versionId: record.id }], [{ targetKey: key, kind: "set-fields", changes: { summary: "Mira reads the ledger beside the harbor clock." } }]);
    await applyGameEdit(call, projectId, proposal.proposalId);
    await approveGamePlan(call, projectId);
    const stale = await review(f), beforeStale = writes(f);
    expect(stale.blockers).toContainEqual(expect.objectContaining({ code: "publication.accepted-prose-stale" }));
    await expect(call("compile_preview", args(f, original))).rejects.toThrow("head_stale");
    await expect(call("compile_preview", args(f, stale))).rejects.toThrow("connected_preview_not_ready");
    expect(writes(f)).toEqual(beforeStale);
  });

  it("names all escaping World passage destinations and binds World changes and the receipt atomically", async () => {
    const f = fixture(), { call, projectId } = f;
    await completePreviewOpening(call, projectId);
    const world = await withAuthoredProgression(call, projectId, await authoredWorld(call, projectId));
    world.progression!.events[0]!.passage = world.locations.find(location => location.id === "station")!.passage;
    await applyPreviewWorld(call, projectId, world);
    const escaping = await review(f);
    expect(escaping.ready).toBe(false);
    for (const id of ["station", "cafe-station", "notice", "next"]) {
      expect(escaping.blockers).toContainEqual(expect.objectContaining({ sourceId: id, message: expect.stringContaining("passage-route-1-act") }));
    }
    const before = writes(f);
    await expect(call("compile_preview", args(f, escaping))).rejects.toThrow("connected_preview_not_ready");
    expect(writes(f)).toEqual(before);
    const closed = await previewWorld(call, projectId);
    await applyPreviewWorld(call, projectId, closed);
    const ready = await review(f);
    expect(ready).toMatchObject({ ready: true, boundary: { suppressedWorldCommands: expect.arrayContaining([
      { kind: "travel", id: "cafe-home", destinationPassageId: previewStart }, { kind: "wait", minutes: 15 },
    ]) } });
    await applyPreviewWorld(call, projectId, { ...closed, initialMinutes: 1429 });
    const changed = await review(f), beforeFailure = writes(f);
    await expect(call("compile_preview", args(f, ready))).rejects.toThrow("head_stale");
    f.db.exec("CREATE TEMP TRIGGER fail_preview_receipt BEFORE INSERT ON messages WHEN json_extract(NEW.metadata_json,'$.connectedOperation.tool')='compile_preview' BEGIN SELECT RAISE(ABORT,'preview receipt failed'); END");
    const input = args(f, changed);
    await expect(call("compile_preview", input)).rejects.toThrow("preview receipt failed");
    expect(writes(f)).toEqual(beforeFailure);
    f.db.exec("DROP TRIGGER fail_preview_receipt");
    const built = await call("compile_preview", input);
    expect(f.compilation.loadPreviewBuild(projectId, built.buildVersionId).bundle.world?.initialMinutes).toBe(1429);
  });

  it("replays an exact preview across real MCP SDK reconnects without appending artifacts or changing its pinned player configuration", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cyoa-pf008-sdk-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const projectId = randomUUID(), token = "pf008-disposable-auth-credential-00000000", databasePath = join(dir, "preview.sqlite");
    const start = async () => {
      const app = buildApp({ databasePath, connectedEditing: { token, projectIds: [projectId], allowProjectCreation: true } });
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      cleanups.push(() => app.close());
      const client = new Client({ name: "pf008-no-model-test", version: "1" });
      const headers = { Authorization: `Bearer ${token}` };
      await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`), { requestInit: { headers } }));
      cleanups.push(() => client.close());
      const call = async (tool: string, input: Record<string, unknown>) => {
        const response = await client.callTool({ name: tool, arguments: input });
        if (response.isError) throw new Error(JSON.stringify(response.content));
        return response.structuredContent as any;
      };
      return { app, client, call, address, headers };
    };
    const first = await start();
    const discovered = (await first.client.listTools()).tools;
    expect(discovered.filter(tool => tool.name.endsWith("_preview")).map(tool => [tool.name, tool.annotations?.readOnlyHint]))
      .toEqual(expect.arrayContaining([["review_preview", true], ["compile_preview", false], ["export_preview", true]]));
    await first.call("create_project", { projectId, name: originalTitle, operationId: randomUUID(), approved: true });
    // A project must be publication-ready to author a custom player configuration.
    const full = await completeConnectedTextGame(first.call, projectId);
    const config = { rewindPolicy: { kind: "previous-step" }, visibleMechanicKeys: ["resolve"], autosaveEnabled: false, manualSlotLimit: 5 };
    const configure = async (target: Awaited<ReturnType<typeof start>>, value: unknown) => {
      const response = await target.app.inject({ method: "PUT", url: `/api/long-form/projects/${projectId}/publication/player-config`, payload: value as object });
      expect(response.statusCode, response.body).toBe(201);
      return response.json();
    };
    const playerConfig = await configure(first, config);
    const selection = openingSelection, review = await first.call("review_preview", { projectId, selection });
    expect(review.playerConfigVersionId).toBe(playerConfig.version.id);
    const input = { projectId, selection: review.selection, operationId: randomUUID(), approved: true,
      fingerprint: review.fingerprint, headFingerprint: review.headFingerprint };
    const built = await first.call("compile_preview", input);
    const exported = await first.call("export_preview", { projectId, buildVersionId: built.buildVersionId });
    const get = async (target: Awaited<ReturnType<typeof start>>) => {
      const response = await fetch(`${target.address}${exported.downloadPath}`, { headers: target.headers });
      expect(response.ok).toBe(true);
      return response.text();
    };
    const original = await get(first);
    await first.client.close(); await first.app.close();
    const fresh = await start();
    await configure(fresh, { ...config, autosaveEnabled: true });
    await expect(fresh.call("compile_preview", { ...input, operationId: randomUUID() })).rejects.toThrow("head_stale");
    expect(await fresh.call("compile_preview", input)).toEqual(built);
    expect(await get(fresh)).toBe(original);
    await expect(fresh.call("compile_preview", { ...input, fingerprint: "0".repeat(64) })).rejects.toThrow("connected_operation_id_conflict");
    const otherProject = randomUUID();
    await expect(fresh.call("export_preview", { projectId: otherProject, buildVersionId: built.buildVersionId })).rejects.toThrow("connected_project_access_denied");
    expect((await fetch(`${fresh.address}${exported.downloadPath.replace(projectId, otherProject)}`, { headers: fresh.headers })).status).toBe(404);
    await fresh.client.close(); await fresh.app.close();
    const db = openDatabase(databasePath);
    try {
      const artifacts = new ArtifactRepository(db);
      expect(artifacts.listVersions(projectId, "native-preview-builds").map(version => version.id)).toEqual([built.buildVersionId]);
      expect(artifacts.listVersions(projectId, "native-preview-inputs").map(version => version.id)).toEqual([built.inputVersionId]);
      expect(artifacts.listVersions(projectId, "native-builds").map(version => version.id)).toEqual([full.compiled.buildVersionId]);
    } finally { db.close(); }
  });
});

async function largeEndingFixture(requiredOverflow = false) {
  const f = fixture(), { projectId, call } = f;
  await completeOriginalFoundations(call, projectId);
  const routes = f.artifacts.getCurrent<LongFormRoutePlan>(projectId, "routes")!.content;
  const endings = f.artifacts.getCurrent<LongFormEndingPlan>(projectId, "endings")!.content;
  const mechanics = f.artifacts.getCurrent<LongFormMechanicsPlan>(projectId, "mechanics")!.content;
  const focus = endings.endings[0]!;
  const route = routes.routes.find(item => item.id === focus.routeId)!;
  const hook = routes.endingHooks.find(item => item.id === focus.hookId)!;
  const decision = routes.decisionPoints[0]!;
  for (let index = 1; index <= 12; index++) {
    const label = `Harbor contingency ${index}`, hookId = `fixture-hook-${index}`;
    const consequences = `${label}: the beacon crew documents damage, testimony, supplies, and conflicting obligations before dawn. `;
    routes.endingHooks.push({ ...hook, id: hookId, label, summary: consequences.repeat(11).trim() });
    route.endingHookIds.push(hookId);
    routes.decisionPoints.push({ ...decision, id: `fixture-decision-${index}`, label,
      question: consequences.repeat(10).trim(), choices: decision.choices.map(item => ({ ...item, id: `fixture-${index}-${item.id}` })) });
    endings.endings.push({ ...focus, id: `fixture-ending-${index}`, hookId, title: label,
      summary: consequences.repeat(16).trim(), thematicPayoff: consequences.repeat(5).trim(),
      requirements: [`Before the watch changes: ${consequences.repeat(6).trim()}`],
      exclusions: [`The alarm must not be false: ${consequences.repeat(5).trim()}`],
      stateConsequences: [`After the watch changes: ${consequences.repeat(6).trim()}`] });
  }
  mechanics.gates.push({ id: "fixture-ending-gate", targetType: "ending", targetId: focus.id, logic: "all",
    conditions: [{ id: "fixture-ending-condition", mechanicKey: "resolve", operator: "at-least", value: -5 }], rationale: "Use the approved minimum.", fallback: "" });
  if (requiredOverflow) focus.requirements = Array.from({ length: 100 }, (_, i) =>
    `Obligation ${i + 1}: ${"Account for each witness and retain the account of the watch. ".repeat(13).trim()}`);
  for (const [artifactId, content] of [["routes", routes], ["endings", endings], ["mechanics", mechanics]] as const) {
    const saved = f.longForm.saveArtifact(projectId, artifactId, content).artifact;
    f.longForm.approveArtifact(projectId, artifactId, saved.id);
  }
  const initial = await call("game_state", { projectId });
  await call("initialize_game_plan", { projectId, operationId: randomUUID(), headFingerprint: initial.headFingerprint, approved: true });
  await approveGamePlan(call, projectId);
  return { ...f, focus, hook, decision, mechanics };
}

describe("PF-007 connected passage drafting context", () => {
  const request = "Draft this ending.";
  const proseMarkdown = "At dawn, Mira sets the signed ledger beside the cold lamp. Each witness can read what it cost to keep the channel open.";
  const size = (value: unknown) => Buffer.byteLength(sourceCanonicalJson(value));
  const writes = (f: Awaited<ReturnType<typeof largeEndingFixture>>) => f.db.prepare(`SELECT
    (SELECT COUNT(*) FROM messages) messages, (SELECT COUNT(*) FROM artifact_versions) artifacts,
    (SELECT COUNT(*) FROM passage_draft_versions) drafts, (SELECT COUNT(*) FROM change_sets) proposals`).get();
  const read = (f: Awaited<ReturnType<typeof largeEndingFixture>>, passageId: string, text = request) =>
    f.call("read_authoring_context", { projectId: f.projectId, passageId, request: text });
  const submit = (f: Awaited<ReturnType<typeof largeEndingFixture>>, context: Awaited<ReturnType<typeof read>>) => ({
    projectId: f.projectId, contextVersion: 2, operationId: randomUUID(), authoringContextFingerprint: context.fingerprint,
    headFingerprint: context.headFingerprint, passageId: context.passageId, passageVersionId: context.context.targets[0].versionId,
    request: context.task.request, proseMarkdown, approved: true,
  });

  it("fits an exact terminal passage and a route-local nonterminal without sibling foundation bodies", async () => {
    const f = await largeEndingFixture(), passageId = `passage-${f.focus.id}`, projectId = f.projectId;
    const raw = f.drafting.preview(projectId, { scope: { kind: "passages", passageIds: [passageId] } }).units[0]!.context!;
    expect(size(raw)).toBeGreaterThan(110_000);
    expect(raw.upstream.endings.endings).toHaveLength(14);
    new CommandRepository(f.db).create({ projectId, scope: "project", name: "Ledger attribution",
      instruction: "Keep each witness's testimony attributed. Do not resolve disputes the author left open." });
    const before = writes(f), result = await read(f, passageId);
    await expect(read(f, "unknown-passage")).rejects.toThrow("connected_authoring_passage_not_in_approved_snapshot");
    expect(writes(f)).toEqual(before);
    expect(size(result)).toBeLessThanOrEqual(64_000);
    expect(await read(f, passageId)).toEqual(result);
    const { fingerprint, providerCalls, ...binding } = result;
    expect(fingerprint).toBe(sourceDigest(binding));
    expect(providerCalls).toBe(0);
    const { context } = result;
    const target = f.passages.currentEntity(projectId, "passage", passageId)!;
    const snapshot = f.passages.getSnapshot(f.passages.state(projectId).approvedSnapshotId!)!;
    expect(context.identity).toEqual({ projectId, snapshotId: snapshot.id, structureVersionId: snapshot.structureVersionId, upstreamVersions: snapshot.upstreamVersions });
    expect(context.targets).toEqual([{ versionId: target.id, content: target.content }]);
    expect(context.authoringInstructions).toEqual(f.artifacts.authoringInstructions(projectId));
    expect(context.authoringInstructions.appliedGuide).toEqual(builtinFictionCraft());
    expect(context.authoringInstructions.customInstructions[0].name).toBe("Ledger attribution");
    const direction = f.artifacts.getVersion<CreativeDirection>(snapshot.upstreamVersions["creative-direction"]!)!.content;
    expect(context.upstream.creativeDirection).toEqual(selectCreativeDirectionContext(direction).context);
    expect(context.upstream.endings.endings).toEqual([f.focus]);
    expect(context.upstream.routes.endingHooks).toEqual([f.hook]);
    expect(context.upstream.routes.decisionPoints).toEqual([f.decision]);
    expect(context.upstream.mechanics.gates).toEqual(f.mechanics.gates);
    expect(context.upstream.mechanics.visibleStats).toEqual(f.mechanics.visibleStats);
    expect(context.structure.sequences[0].passageIds).toContain("passage-fixture-ending-1");
    expect(JSON.stringify(context.upstream)).not.toMatch(/fixture-ending-[0-9]|fixture-decision-|Harbor contingency/);
    const ordinary = await read(f, "passage-route-1-act", "Draft this passage.");
    expect(size(ordinary)).toBeLessThanOrEqual(64_000);
    expect(ordinary.context.targets[0].content.terminal).toBe(false);
    expect(ordinary.context.choices.length).toBeGreaterThan(12);
    expect(ordinary.context.upstream.endings.endings).toEqual([]);
    expect(ordinary.context.upstream.routes.routes.map((r: { id: string }) => r.id)).toEqual([f.focus.routeId]);
  });

  it("fits whole optional continuity where possible and submits a fresh terminal candidate without acceptance or publication", async () => {
    const f = await largeEndingFixture(), projectId = f.projectId, passageId = `passage-${f.focus.id}`;
    const predecessor = await submitGameDraft(f.call, projectId, "passage-route-1-act",
      "The beacon crew recorded every vessel that crossed the harbor and marked its arrival in the ledger.\n\n".repeat(720).trim());
    const short = await submitGameDraft(f.call, projectId, "passage-ending-3", proseMarkdown);
    await acceptGameDrafts(f.call, projectId, [predecessor, short].map(draft => ({ passageId: draft.passageId, candidateDraftVersionId: draft.draftVersionId })));
    const acceptedShort = f.drafts.getHead(projectId, short.passageId)!.accepted!;
    const initial = await read(f, passageId);
    expect(size(initial)).toBeLessThanOrEqual(64_000);
    expect(initial.omittedNeighborProseCount).toBe(1);
    expect(initial.context.acceptedNeighborProse).toEqual([expect.objectContaining({ draftVersionId: acceptedShort.id, proseMarkdown })]);
    const original = submit(f, initial), before = writes(f);
    await expect(f.call("submit_draft", { ...original, request: "Draft another ending." })).rejects.toThrow("connected_authoring_context_stale_refresh");
    await expect(f.call("submit_draft", { ...original, passageVersionId: randomUUID() })).rejects.toThrow("connected_passage_version_stale");
    expect(writes(f)).toEqual(before);
    const settings = await f.call("read_authoring_settings", { projectId });
    const input = { projectId, expectedVersionId: settings.versionId, enabled: false };
    const settingsReview = await f.call("review_authoring_settings", input);
    await f.call("apply_authoring_settings", { ...input, fingerprint: settingsReview.fingerprint, operationId: randomUUID(), approved: true });
    const fresh = await read(f, passageId), afterSettings = writes(f);
    expect(fresh.fingerprint).not.toBe(initial.fingerprint);
    expect(fresh.context.authoringInstructions).toMatchObject({ enabled: false, appliedGuide: null });
    await expect(f.call("submit_draft", { ...original, headFingerprint: fresh.headFingerprint })).rejects.toThrow("connected_authoring_context_stale_refresh");
    expect(writes(f)).toEqual(afterSettings);
    const submitted = submit(f, fresh);
    const candidate = await f.call("submit_draft", submitted), afterSubmission = writes(f);
    expect(await f.call("submit_draft", submitted)).toEqual(candidate);
    await expect(f.call("submit_draft", { ...submitted, operationId: randomUUID() })).rejects.toThrow("connected_game_head_stale");
    expect(writes(f)).toEqual(afterSubmission);
    expect(candidate).toMatchObject({ status: "candidate", passageId, providerCalls: 0 });
    const stored = (await f.call("read_game_record", { projectId, kind: "draft", entityId: passageId })).draft;
    expect(stored).toMatchObject({ id: candidate.draftVersionId, proseMarkdown, basedOnPassagePlanVersionId: submitted.passageVersionId });
    expect(f.drafts.getHead(projectId, passageId)?.accepted).toBeNull();
    expect(f.drafts.getHead(projectId, short.passageId)?.accepted).toEqual(acceptedShort);
    const { fingerprint, providerCalls: _providerCalls, ...binding } = fresh;
    expect(f.artifacts.getCurrent(projectId, `draft-authoring-context:${candidate.draftVersionId}`)?.content).toMatchObject({ binding, contextFingerprint: fingerprint });
    const readiness = await f.call("publication_readiness", { projectId });
    expect(readiness.ready).toBe(false);
    expect(f.generate).not.toHaveBeenCalled();
  });

  it("rejects truly oversized required terminal data on both read and submit without writes", async () => {
    const f = await largeEndingFixture(true), projectId = f.projectId, passageId = `passage-${f.focus.id}`;
    const { record, headFingerprint } = await f.call("read_game_record", { projectId, kind: "passage", entityId: passageId });
    const before = writes(f);
    await expect(read(f, passageId)).rejects.toThrow("connected_authoring_required_context_overflow");
    await expect(f.call("submit_draft", { projectId, passageId, passageVersionId: record.id, headFingerprint, request, proseMarkdown,
      approved: true, operationId: randomUUID(), contextVersion: 2, authoringContextFingerprint: "0".repeat(64) })).rejects.toThrow("connected_authoring_required_context_overflow");
    expect(writes(f)).toEqual(before);
    expect(f.drafts.getHead(projectId, passageId)).toBeUndefined();
  });
});

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
