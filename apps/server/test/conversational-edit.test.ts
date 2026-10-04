import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactRepository, AuthorMemoryRepository, ChangeSetRepository, ConversationRepository, PassageDraftRepository, PassagePlanRepository, ProjectRepository, WorkflowRepository, openDatabase } from "@story-to-cyoa/persistence";
import { defaultPassagePlanBundle, type LongFormMechanicsPlan, type LongFormStoryBible, type PassagePlan } from "@story-to-cyoa/pipeline";
import { LongFormProjectService } from "../src/services/long-form-project-service.js";
import { ConversationalEditService } from "../src/services/conversational-edit-service.js";
import { OfflineEditProvider, OpenRouterEditProvider, editMessages } from "../src/services/conversational-edit-provider.js";
import type { EditPlan, EditProvider, EditResponse } from "../src/services/conversational-edit-contract.js";
import { buildApp } from "../src/app.js";
import { PassagePlanService } from "../src/services/passage-plan-service.js";
import type { OpenRouterClient } from "@story-to-cyoa/openrouter";
import { FOUNDATION_ARTIFACT_IDS, ProjectBriefSchema, defaultCreativeDirection, defaultProjectBrief, newAdaptationIntent, normalizeAdaptationIntent, type SourceDossier } from "@story-to-cyoa/domain";
import { analysisFixture, completeFixture } from "../../../packages/persistence/test/source-analysis-fixture.js";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const character = (id: string, name: string) => ({ id, name, role: "Ally", summary: "", motivations: [], knowledge: [], plannedArc: "" });
function fixture(path = ":memory:") {
  const db = openDatabase(path), artifacts = new ArtifactRepository(db), changes = new ChangeSetRepository(db), workflow = new WorkflowRepository(db), drafts = new PassageDraftRepository(db);
  const passages = new PassagePlanRepository(db, (mutation) => drafts.handlePassagePlanMutationInTransaction(mutation));
  const longForm = new LongFormProjectService(new ProjectRepository(db), artifacts, workflow, changes, passages, drafts);
  const created = longForm.createProject("Editing harbor"), id = created.project.id;
  longForm.approveArtifact(id, "brief", created.brief.id); longForm.approveArtifact(id, "creative-direction", created.creativeDirection.id);
  for (const owner of ["bible", "routes", "endings", "mechanics"] as const) {
    let version = longForm.createArtifact(id, owner).artifact;
    if (owner === "bible") version = longForm.saveArtifact(id, owner, { ...version.content, characters: [character("character-mira", "Mira"), character("character-jules", "Jules")] }).artifact;
    if (owner === "mechanics") {
      const content = version.content as LongFormMechanicsPlan;
      version = longForm.saveArtifact(id, owner, { ...content, choiceEffectPlans: [{ id: "effect-harbor", label: "Harbor state", sourceDecisionIds: ["decision-route-selection"], mechanicKeys: [...content.visibleStats, ...content.relationships].map((m) => m.key), effectGuidance: ["Exercise declared state."] }] }).artifact;
    }
    longForm.approveArtifact(id, owner, version.id);
  }
  const snapshot = longForm.snapshot(id), bundle = defaultPassagePlanBundle(snapshot.brief!, snapshot.routes!, snapshot.endings!);
  const entities = [...bundle.passages.map((content) => ({ kind: "passage" as const, id: content.id, content })), ...bundle.choices.map((content) => ({ kind: "choice" as const, id: content.id, content })), ...bundle.threads.map((content) => ({ kind: "thread" as const, id: content.id, content }))];
  passages.saveBundle(id, bundle.structure, entities, { passage: new Set(bundle.passages.map((p) => p.id)), choice: new Set(bundle.choices.map((p) => p.id)), thread: new Set(bundle.threads.map((p) => p.id)) });
  const calls: EditPlan[] = [], offline = new OfflineEditProvider();
  const handler = { run: (plan: EditPlan, signal: AbortSignal): Promise<unknown> => offline.generate(plan, signal) };
  const provider: EditProvider = { id: "offline-edit", async generate(plan, signal) { calls.push(plan); return handler.run(plan, signal); } };
  const service = new ConversationalEditService(db, longForm, [provider]);
  cleanups.push(() => { service.shutdown(); db.close(); });
  return { db, artifacts, changes, workflow, drafts, passages, longForm, id, service, handler, calls, bundle };
}
type Fixture = ReturnType<typeof fixture>;
function preview(f: Fixture, message = 'Change Mira to "Ren"', targetKeys: string[] = ["bible:character-mira"], extra = {}) {
  const p = f.service.preview(f.id, { message, targetKeys, ...extra }); if (p.status !== "ready") throw new Error(`Unexpected preview: ${p.status}`); return p;
}
async function propose(f: Fixture, message?: string, keys?: string[]) {
  const p = preview(f, message, keys), result = await f.service.generate(f.id, p.plan.id, p.plan.fingerprint);
  if (!result.proposal) throw new Error("Missing proposal"); return result.proposal;
}
const group = (targetKey: string, changes: Record<string, unknown>, id = "edit", dependsOnGroupIds: string[] = []): EditResponse["groups"][number] => ({ id, label: id, explanation: "Requested scoped change", dependsOnGroupIds, operations: [{ kind: "set-fields", targetKey, changes }] });
const response = (...groups: EditResponse["groups"]) => ({ message: "Review these changes", groups });
function canonical(f: Fixture) {
  return { snapshot: f.longForm.snapshot(f.id), versions: f.db.prepare("SELECT id,stale FROM artifact_versions WHERE project_id=? AND artifact_id IN ('brief','creative-direction','bible','routes','endings','mechanics') ORDER BY id").all(f.id),
    workflow: f.db.prepare("SELECT * FROM artifact_workflow_state WHERE project_id=? ORDER BY artifact_id").all(f.id), structure: f.passages.listStructureVersions(f.id), passages: f.passages.listAllEntityVersions(f.id), state: f.passages.state(f.id), drafts: f.db.prepare("SELECT * FROM passage_draft_heads WHERE project_id=?").all(f.id), events: f.db.prepare("SELECT * FROM passage_draft_staleness_events WHERE project_id=?").all(f.id) };
}
function readyReview(f: Fixture, p: { id: string; proposal: unknown }, selected?: string[]) {
  const ids = selected ?? (p.proposal as { response: EditResponse }).response.groups.map((g) => g.id); return f.service.review(f.id, p.id, ids);
}

describe("A6 scoped conversational editing", () => {
  it.each(["sequence", "act"] as const)("invalidates only drafts under a materially edited %s through Apply, approval and refresh", async (kind) => {
    const f = fixture(), sequence = f.bundle.structure.sequences.find((s) => s.passageIds.length >= 2)!, other = f.bundle.structure.sequences.find((s) => s.actId !== sequence.actId)!;
    const upstreamVersions = Object.fromEntries(["bible", "routes", "endings", "mechanics"].map((id) => [id, f.artifacts.getCurrent(f.id, id)!.id]));
    const accepted = [sequence.passageIds[0]!, sequence.passageIds[1]!, other.passageIds[0]!].map((id, index) => {
      const passage = f.passages.currentEntity<PassagePlan>(f.id, "passage", id)!;
      let draft = f.drafts.createVersion({ projectId: f.id, passageId: id, basedOnPassagePlanVersionId: passage.id, proseMarkdown: `Protected original ${index}`, sourceKind: "manual", upstreamVersions, neighboringDraftVersions: {} });
      draft = f.drafts.transition(f.id, id, draft.id, "accepted");
      if (index === 1) { draft = f.drafts.transition(f.id, id, draft.id, "reviewed"); draft = f.drafts.transition(f.id, id, draft.id, "locked"); }
      return { passage, draft };
    });
    const target = `passage-structure:${kind === "sequence" ? sequence.id : sequence.actId}`;
    f.handler.run = async () => response(group(target, { summary: "A different situation shapes these scenes" }));
    const proposal = await propose(f, "Change the structural summary", [target]), review = readyReview(f, proposal), before = canonical(f);
    expect(review.draftImpacts.map((i) => i.passageId)).toEqual(expect.arrayContaining(sequence.passageIds));
    expect(review.draftImpacts.some((i) => i.passageId === other.passageIds[0])).toBe(false);
    expect((proposal.proposal as { expectedDraftImpacts: unknown }).expectedDraftImpacts).toEqual(review.draftImpacts);
    expect(() => f.service.apply(f.id, proposal.id, review.selectedGroupIds, review.fingerprint, { simulateFailure: true })).toThrow(/Simulated/);
    expect(canonical(f)).toEqual(before);
    f.service.apply(f.id, proposal.id, review.selectedGroupIds, review.fingerprint);
    new PassagePlanService(new ProjectRepository(f.db), f.artifacts, f.workflow, f.passages).approve(f.id);
    for (const [index, { passage, draft }] of accepted.entries()) {
      const refreshed = f.drafts.refreshStaleness(f.id, draft.id, passage.id, passage.content, upstreamVersions);
      expect(refreshed.stale).toBe(index < 2); expect(refreshed.proseMarkdown).toBe(draft.proseMarkdown);
      expect(f.drafts.getHead(f.id, passage.entityId)!.accepted!.id).toBe(draft.id);
      if (index === 0) expect(() => f.drafts.transition(f.id, passage.entityId, draft.id, "reviewed")).toThrow(/stale/);
      if (index === 1) expect(f.drafts.getHead(f.id, passage.entityId)!.acceptedLocked).toBe(true);
      if (index === 2) expect(f.drafts.transition(f.id, passage.entityId, draft.id, "reviewed").stale).toBe(false);
    }
  });
  it.each([false, true])("keeps drafts fresh for cosmetic/no-op structure edits (no-op=%s)", async (noop) => {
    const f = fixture(), sequence = f.bundle.structure.sequences[0]!, passage = f.passages.currentEntity<PassagePlan>(f.id, "passage", sequence.passageIds[0]!)!;
    const upstreamVersions = Object.fromEntries(["bible", "routes", "endings", "mechanics"].map((id) => [id, f.artifacts.getCurrent(f.id, id)!.id]));
    let draft = f.drafts.createVersion({ projectId: f.id, passageId: passage.entityId, basedOnPassagePlanVersionId: passage.id, proseMarkdown: "Existing prose", sourceKind: "manual", upstreamVersions });
    draft = f.drafts.transition(f.id, passage.entityId, draft.id, "accepted");
    const key = `passage-structure:${sequence.id}`;
    f.handler.run = async () => response(group(key, { label: noop ? sequence.label : "Cosmetic navigation label" }));
    const proposal = await propose(f, "Change sequence label", [key]), review = readyReview(f, proposal);
    expect(review.draftImpacts).toEqual([]); expect(review.wouldStale).toEqual([]); f.service.apply(f.id, proposal.id, review.selectedGroupIds, review.fingerprint);
    new PassagePlanService(new ProjectRepository(f.db), f.artifacts, f.workflow, f.passages).approve(f.id);
    expect(f.drafts.refreshStaleness(f.id, draft.id, passage.id, passage.content, upstreamVersions).stale).toBe(false);
    expect(f.drafts.transition(f.id, passage.entityId, draft.id, "reviewed").stale).toBe(false);
  });
  it.each(["outline", "planned", "reviewed", "locked"] as const)("enforces initial lifecycle for new sequences: %s", async (planningStatus) => {
    for (const nested of [false, true]) {
      const f = fixture(), sequence = { ...f.bundle.structure.sequences[0]!, id: "$new:sequence", passageIds: [], wordTarget: 0, position: 100, planningStatus };
      const acts = f.bundle.structure.acts.map((a) => a.id === sequence.actId ? { ...a, sequenceIds: [...a.sequenceIds, sequence.id] } : a);
      const operations: EditResponse["groups"][number]["operations"] = nested
        ? [{ kind: "add-item", targetKey: "passage-structure:root", collection: "sequences", item: { ...sequence, planningStatus: "outline" } }, { kind: "set-fields", targetKey: "passage-structure:root", changes: { acts, sequences: [...f.bundle.structure.sequences, sequence] } }]
        : [{ kind: "add-item", targetKey: "passage-structure:root", collection: "sequences", item: sequence }, { kind: "set-fields", targetKey: "passage-structure:root", changes: { acts } }];
      f.handler.run = async () => response({ ...group("passage-structure:root", {}), operations }); const before = canonical(f);
      if (["reviewed", "locked"].includes(planningStatus)) {
        await expect(propose(f, "Add a sequence", ["passage-structure:root"])).rejects.toThrow(/initial_lifecycle/); expect(canonical(f)).toEqual(before);
      } else {
        const proposal = await propose(f, "Add a sequence", ["passage-structure:root"]), review = readyReview(f, proposal);
        expect(() => f.service.apply(f.id, proposal.id, review.selectedGroupIds, review.fingerprint, { simulateFailure: true })).toThrow(/Simulated/); expect(canonical(f)).toEqual(before);
        f.service.apply(f.id, proposal.id, review.selectedGroupIds, review.fingerprint);
        expect(f.passages.currentStructure<{ sequences: Array<{ planningStatus: string }> }>(f.id)!.content.sequences.at(-1)!.planningStatus).toBe(planningStatus);
      }
    }
  });
  it("reports passage warnings, existing errors and accurate truncation without blocking non-error changes", async () => {
    const f = fixture(), passageId = f.bundle.passages[0]!.id, passage = f.passages.currentEntity<PassagePlan>(f.id, "passage", passageId)!;
    f.passages.saveEntity(f.id, "passage", passageId, { ...passage.content, characterIds: ["historical-missing-character"] });
    for (let i = 0; i < 65; i++) f.passages.saveEntity(f.id, "thread", `thread-${i}`, { id: `thread-${i}`, label: "Trust", description: "", setupPassageIds: i === 0 ? [] : [passageId], payoffPassageIds: [], routeIds: [], required: false, status: "planned", waiverRationale: "" });
    f.handler.run = async () => response(group("thread:thread-0", { setupPassageIds: [passageId] }));
    const proposal = await propose(f, "Add thread setup", ["thread:thread-0"]), review = readyReview(f, proposal);
    expect(review.validation.totalFindings).toBeGreaterThan(65); expect(review.findings).toHaveLength(50); expect(review.validation.omittedFindings).toBe(review.validation.totalFindings - 50);
    expect(review.findings).toContainEqual(expect.objectContaining({ code: "continuity.thread.setup-without-payoff", entityId: "thread-0", entityType: "thread", evidence: [passageId], severity: "warning" }));
    expect(review.findings).toContainEqual(expect.objectContaining({ entityId: passageId, severity: "error" }));
    f.service.apply(f.id, proposal.id, review.selectedGroupIds, review.fingerprint);
    expect(f.passages.currentEntity<{ setupPassageIds: string[] }>(f.id, "thread", "thread-0")!.content.setupPassageIds).toEqual([passageId]);
  });
  it("returns complete nonblocking passage findings through the reviewed HTTP contract", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cyoa-a6-warning-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "project.sqlite"), f = fixture(path), passageId = f.bundle.passages[0]!.id;
    f.passages.saveEntity(f.id, "thread", "thread-http", { id: "thread-http", label: "Trust", description: "", setupPassageIds: [], payoffPassageIds: [], routeIds: [], required: false, status: "planned", waiverRationale: "" });
    const app = buildApp({ databasePath: path, conversationalEditProvider: { id: "offline-edit", async generate() { return response(group("thread:thread-http", { setupPassageIds: [passageId] })); } } }); cleanups.push(() => app.close());
    const root = `/api/long-form/projects/${f.id}/editing`, post = async (url: string, payload: unknown) => { const r = await app.inject({ method: "POST", url, payload }); expect(r.statusCode, r.body).toBe(200); return r.json(); };
    const { plan } = await post(`${root}/preview`, { message: "Add a setup", targetKeys: ["thread:thread-http"] }), generated = await post(`${root}/plans/${plan.id}/generate`, { fingerprint: plan.fingerprint });
    const review = await post(`${root}/proposals/${generated.proposal.id}/review`, { groupIds: ["edit"] });
    expect(review.findings).toContainEqual(expect.objectContaining({ code: "continuity.thread.setup-without-payoff", entityId: "thread-http", entityType: "thread", evidence: [passageId] }));
    expect(review.validation.totalFindings).toBe(review.findings.length + review.validation.omittedFindings);
    await post(`${root}/proposals/${generated.proposal.id}/apply`, { groupIds: ["edit"], fingerprint: review.fingerprint });
  });
  it.each([
    ["Rename Mira to \"Ren\"", "bible:character-mira", "name", "Ren"],
    ["Change tone to \"restrained tension\"", "creative-direction:section:tone", "customGuidance", "restrained tension"],
    ["Change mechanics visibility to \"visible\"", "creative-direction:section:relationshipPresentation", "projectDefault", { mechanicsVisibility: "visible", customGuidance: "" }],
  ])("reviews and applies representative natural-language request: %s", async (message, key, field, expected) => {
    const f = fixture(), before = canonical(f), p = await propose(f, String(message), [String(key)]);
    expect(canonical(f)).toEqual(before);
    const review = readyReview(f, p); expect((review.outputs[0]!.after as Record<string, unknown>)[String(field)]).toEqual(expected);
    const applied = f.service.apply(f.id, p.id, review.selectedGroupIds, review.fingerprint);
    expect(applied.providerCalls).toBe(0); expect(f.calls).toHaveLength(1); expect(f.changes.get(p.id)?.status).toBe("applied");
    expect(() => f.service.apply(f.id, p.id, review.selectedGroupIds, review.fingerprint)).toThrow(/terminal/);
    if (String(key).startsWith("creative-direction")) {
      const direction = f.longForm.snapshot(f.id)["creative-direction"]!;
      expect(direction.materialFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(direction.fieldProvenance.some((p) => p.reference.kind === "user-message")).toBe(true);
    }
  });
  it.each(["routes", "endings", "passage", "choice", "thread"])("edits one exact %s record and preserves sibling versions", async (owner) => {
    const f = fixture();
    if (owner === "thread") f.passages.saveEntity(f.id, "thread", "thread-intent", { id: "thread-intent", label: "Trust", description: "", setupPassageIds: [], payoffPassageIds: [], routeIds: [], required: false, status: "planned", waiverRationale: "" });
    const target = f.service.catalogue(f.id, `${owner}:`).items.find((t) => t.owner === owner && t.targetId !== "root" && !t.targetId.startsWith("section:") && (owner === "routes" || owner === "endings" ? t.path.startsWith(`/${owner}/`) : true))!;
    const old = canonical(f), p = await propose(f, 'Change this record to "Harbor promise"', [target.key]), review = readyReview(f, p);
    const after = review.outputs[0]!.after as Record<string, unknown>; expect(after.title ?? after.label ?? after.name).toBe("Harbor promise");
    f.service.apply(f.id, p.id, review.selectedGroupIds, review.fingerprint);
    if (["passage", "choice", "thread"].includes(owner)) for (const version of old.passages) {
      if (version.entityId !== target.targetId) expect(f.passages.currentEntity(f.id, version.entityKind, version.entityId)?.id).toBe(version.id);
    }
  });
  it("requires ambiguity clarification and rejects unknown, cross-project and duplicate scopes without provider calls", () => {
    const f = fixture(), before = canonical(f);
    expect(f.service.preview(f.id, { message: "Change the ending" })).toMatchObject({ status: "clarification", canonicalMutations: 0, providerCalls: 0 });
    expect(f.service.preview(f.id, { message: "Change a character" })).toMatchObject({ status: "clarification" });
    expect(() => preview(f, "Change", ["bible:foreign"])).toThrow(/target_not_found/);
    expect(() => preview(f, "Change", ["bible:character-mira", "bible:character-mira"])).toThrow(/duplicate_scope/);
    expect(canonical(f)).toEqual(before); expect(f.calls).toHaveLength(0);
  });
  it("preserves canonical state for discussion, reject, history and local validation", async () => {
    const f = fixture(), before = canonical(f), plan = preview(f, "Discuss Mira's motivation", undefined, { intent: "discuss" });
    expect(await f.service.generate(f.id, plan.plan.id, plan.plan.fingerprint)).toMatchObject({ proposal: null });
    const p = await propose(f); readyReview(f, p); f.service.reject(f.id, p.id);
    expect(f.service.history(f.id, p.conversationId).proposals).toHaveLength(1); expect(canonical(f)).toEqual(before); expect(f.calls).toHaveLength(2);
  });
  it("requires cross-artifact dependencies, revalidates effective state and rolls every write back atomically", async () => {
    const f = fixture(), route = f.service.catalogue(f.id, "routes:").items.find((t) => t.path.startsWith("/routes/"))!;
    f.handler.run = async () => response(group("bible:character-mira", { name: "Ren" }, "character"), group(route.key, { name: "Ren's route" }, "route", ["character"]));
    const before = canonical(f), p = await propose(f, "Rename Mira and the route", ["bible:character-mira", route.key]);
    expect(() => readyReview(f, p, ["route"])).toThrow(/selection_incomplete/);
    const review = readyReview(f, p); expect(review.requiredGroupIds).toEqual(["character"]);
    expect(() => f.service.apply(f.id, p.id, review.selectedGroupIds, review.fingerprint, { simulateFailure: true })).toThrow(/Simulated/);
    expect(canonical(f)).toEqual(before); expect(f.changes.get(p.id)?.status).toBe("proposed");
    const applied = f.service.apply(f.id, p.id, review.selectedGroupIds, review.fingerprint);
    expect(Object.keys(applied.resultingVersions).sort()).toEqual(["bible", "routes"]);
    expect(f.workflow.get(f.id, "bible").status).toBe("draft"); expect(f.workflow.get(f.id, "routes").status).toBe("draft"); expect(f.passages.state(f.id).status).toBe("stale");
  });
  it("selectively applies an independent group and leaves other records untouched", async () => {
    const f = fixture(); f.handler.run = async () => response(group("bible:character-mira", { name: "Ren" }, "mira"), group("bible:character-jules", { name: "Jules II" }, "jules"));
    const p = await propose(f, "Change these names", ["bible:character-mira", "bible:character-jules"]), review = readyReview(f, p, ["mira"]);
    expect(review.outputs.map((o) => o.targetId)).toEqual(["character-mira"]);
    f.service.apply(f.id, p.id, ["mira"], review.fingerprint);
    expect(f.longForm.snapshot(f.id).bible!.characters.find((c) => c.id === "character-jules")!.name).toBe("Jules");
  });
  it("does not force unrelated cross-artifact groups into a selective Apply", async () => {
    const f = fixture(), direction = f.artifacts.getCurrent(f.id, "creative-direction")!;
    f.handler.run = async () => response(group("bible:character-mira", { name: "Ren" }, "character"), group("creative-direction:section:tone", { customGuidance: "Quiet" }, "tone"));
    const p = await propose(f, "Review a name and tone separately", ["bible:character-mira", "creative-direction:section:tone"]), review = readyReview(f, p, ["character"]);
    expect(review.requiredGroupIds).toEqual([]); f.service.apply(f.id, p.id, ["character"], review.fingerprint); expect(f.artifacts.getCurrent(f.id, "creative-direction")!.id).toBe(direction.id);
  });
  it("derives generated IDs locally and requires their producer for dependent additions", async () => {
    const f = fixture();
    f.handler.run = async () => response(
      { ...group("bible:root", {}, "new-character"), operations: [{ kind: "add-item", targetKey: "bible:root", collection: "characters", item: character("$new:ren", "Ren") }] },
      { ...group("bible:root", {}, "relationship", ["new-character"]), operations: [{ kind: "add-item", targetKey: "bible:root", collection: "relationships", item: { id: "$new:bond", characterIds: ["$new:ren", "character-mira"], label: "Allies", currentState: "Uneasy", plannedArc: "Trust" } }] });
    const p = await propose(f, "Add Ren and their bond", ["bible:root"]), review = readyReview(f, p);
    expect(Object.values(review.generatedIds)).toEqual([expect.stringMatching(/^a6_[a-f0-9]{24}$/), expect.stringMatching(/^a6_[a-f0-9]{24}$/)]);
    expect(() => readyReview(f, p, ["relationship"])).toThrow(/selection_incomplete/);
    f.service.apply(f.id, p.id, review.selectedGroupIds, review.fingerprint);
    expect(f.longForm.snapshot(f.id).bible!.relationships[0]!.characterIds).toContain(review.generatedIds["$new:ren"]);
  });
  it("rejects missing Creative Direction references and validates generated cross-artifact scopes in effective state", async () => {
    const f = fixture(), variation = (scopeId: string) => ({ id: "$new:variation", scopeKind: "character", scopeId, toneDescriptors: [], pacingGuidance: "Quiet tension", proseGuidance: "" });
    const addVariation = (scopeId: string) => ({ ...group("creative-direction:root", {}, "direction"), operations: [{ kind: "add-item" as const, targetKey: "creative-direction:root", collection: "scopedVariations", item: variation(scopeId) }] });
    f.handler.run = async () => response(addVariation("foreign-character")); const before = canonical(f);
    await expect(propose(f, "Add scoped direction", ["creative-direction:root"])).rejects.toThrow(/missing character/); expect(canonical(f)).toEqual(before);
    f.handler.run = async () => response({ ...group("bible:root", {}, "character"), operations: [{ kind: "add-item", targetKey: "bible:root", collection: "characters", item: character("$new:ren", "Ren") }] }, addVariation("$new:ren"));
    const p = await propose(f, "Add Ren with scoped direction", ["bible:root", "creative-direction:root"]);
    expect(() => readyReview(f, p, ["direction"])).toThrow(/selection_incomplete/);
    const reviewed = readyReview(f, p); f.service.apply(f.id, p.id, reviewed.selectedGroupIds, reviewed.fingerprint);
    expect(f.longForm.snapshot(f.id)["creative-direction"]!.scopedVariations[0]!.scopeId).toBe(reviewed.generatedIds["$new:ren"]);
  });
  it.each(["before-generation", "in-flight", "before-apply", "transaction-boundary"])("rejects canonical drift at %s", async (moment) => {
    const f = fixture(), plan = preview(f);
    const drift = () => f.longForm.saveArtifact(f.id, "brief", { ...f.longForm.snapshot(f.id).brief!, workingTitle: "Changed concurrently" });
    if (moment === "before-generation") { drift(); await expect(f.service.generate(f.id, plan.plan.id, plan.plan.fingerprint)).rejects.toThrow(/base_stale/); expect(f.calls).toHaveLength(0); }
    else if (moment === "in-flight") { f.handler.run = async (p, signal) => { drift(); return new OfflineEditProvider().generate(p, signal); }; await expect(f.service.generate(f.id, plan.plan.id, plan.plan.fingerprint)).rejects.toThrow(/base_stale/); }
    else {
      const result = await f.service.generate(f.id, plan.plan.id, plan.plan.fingerprint), proposal = result.proposal!, review = readyReview(f, proposal);
      if (moment === "before-apply") drift();
      expect(() => f.service.apply(f.id, proposal.id, review.selectedGroupIds, review.fingerprint, moment === "transaction-boundary" ? { beforeTransaction: drift } : {})).toThrow(/base_stale/);
      expect(f.changes.get(proposal.id)?.status).toBe("proposed");
    }
    expect(f.longForm.snapshot(f.id).bible!.characters[0]!.name).toBe("Mira");
  });
  it("rejects pinned-decision drift and includes scoped decisions and bounded recent continuity", async () => {
    const f = fixture(), memory = new AuthorMemoryRepository(f.db);
    const decision = memory.createDecision({ projectId: f.id, scope: { kind: "entity", artifactId: "bible", entityKind: "character", entityId: "character-mira" }, content: "Mira must remain a reluctant ally." });
    const plan = preview(f); expect(JSON.stringify(plan.plan.context)).toContain(decision.content);
    memory.reviseDecision(f.id, decision.stableId, { content: "Mira must remain a willing ally." });
    await expect(f.service.generate(f.id, plan.plan.id, plan.plan.fingerprint)).rejects.toThrow(/author_memory_stale/); expect(f.calls).toHaveLength(0);
    for (let i = 0; i < 6; i++) { const p = preview(f, `Discuss Mira ${i}`, undefined, { intent: "discuss" }); await f.service.generate(f.id, p.plan.id, p.plan.fingerprint); }
    const next = preview(f), context = next.plan.context.memory as { recentMessages: unknown[]; summary: unknown };
    expect(context.recentMessages.length).toBeLessThanOrEqual(8); expect(context.summary).not.toBeNull();
  });
  it("revalidates pinned decisions before Apply while allowing ordinary conversation continuity", async () => {
    const f = fixture(), p = await propose(f), review = readyReview(f, p), before = canonical(f);
    new AuthorMemoryRepository(f.db).createDecision({ projectId: f.id, scope: { kind: "project" }, content: "Do not rename Mira." });
    expect(() => f.service.apply(f.id, p.id, review.selectedGroupIds, review.fingerprint)).toThrow(/author_decisions_stale/); expect(canonical(f)).toEqual(before); expect(f.changes.get(p.id)?.status).toBe("proposed");
  });
  it("cancels overlapping and late provider output, then allows a new preview retry", async () => {
    const f = fixture(), plan = preview(f), before = canonical(f);
    let finish!: (value: unknown) => void;
    f.handler.run = async () => new Promise((resolve) => { finish = resolve; });
    const running = f.service.generate(f.id, plan.plan.id, plan.plan.fingerprint);
    await expect(f.service.generate(f.id, plan.plan.id, plan.plan.fingerprint)).rejects.toThrow(/already_running/);
    f.service.cancel(f.id, plan.plan.id); await expect(running).rejects.toThrow(/cancelled/);
    finish(response(group("bible:character-mira", { name: "Ignored" }))); await Promise.resolve();
    expect(canonical(f)).toEqual(before); expect(f.changes.count(plan.plan.conversationId)).toBe(0);
    f.handler.run = (p, s) => new OfflineEditProvider().generate(p, s); const p = await propose(f); expect(p.status).toBe("proposed");
  });
  it("aborts an in-flight generation during shutdown without writing a proposal", async () => {
    const f = fixture(), plan = preview(f); f.handler.run = async () => new Promise(() => {});
    const running = f.service.generate(f.id, plan.plan.id, plan.plan.fingerprint); f.service.shutdown(); await expect(running).rejects.toThrow(/cancelled/);
    expect(f.changes.count(plan.plan.conversationId)).toBe(0);
  });
  it.each([
    response(group("bible:character-mira", { id: "forged" })),
    response(group("bible:character-jules", { name: "Out of scope" })),
    response(group("bible:character-mira", { unexpected: "stripped" })),
    response({ ...group("bible:character-mira", {}, "bad"), operations: [{ kind: "add-item", targetKey: "bible:character-mira" }] }),
    response({ ...group("bible:character-mira", {}, "bad"), dependsOnGroupIds: ["bad"] }),
  ])("rejects malformed or unauthorized response %# without canonical changes", async (output) => {
    const f = fixture(), before = canonical(f); f.handler.run = async () => output;
    await expect(propose(f)).rejects.toThrow(); expect(canonical(f)).toEqual(before); expect(f.changes.count(f.service.conversationsForProject(f.id)[0]!.id)).toBe(0);
  });
  it("rejects new passage reference errors against the original planning baseline", async () => {
    const f = fixture(), passage = f.passages.currentEntities<PassagePlan>(f.id, "passage")[0]!;
    f.passages.saveEntity(f.id, "passage", passage.entityId, { ...passage.content, characterIds: ["character-mira"] }); const before = canonical(f);
    f.handler.run = async () => response({ ...group("bible:character-mira", {}), operations: [{ kind: "remove-item", targetKey: "bible:character-mira" }] });
    await expect(propose(f, "Remove the referenced character")).rejects.toThrow(/validation_failed/); expect(canonical(f)).toEqual(before);
  });
  it("routes prose to ordinary candidates and preserves accepted/locked prose during planning Apply", async () => {
    const f = fixture(), passage = f.passages.currentEntities<PassagePlan>(f.id, "passage")[0]!;
    let draft = f.drafts.createVersion({ projectId: f.id, passageId: passage.entityId, basedOnPassagePlanVersionId: passage.id, proseMarkdown: "Locked prose stays exactly the same.", sourceKind: "manual", upstreamVersions: Object.fromEntries(["bible", "routes", "endings", "mechanics"].map((id) => [id, f.artifacts.getCurrent(f.id, id)!.id])), neighboringDraftVersions: {} });
    for (const status of ["accepted", "reviewed", "locked"] as const) draft = f.drafts.transition(f.id, passage.entityId, draft.id, status);
    const protectedBefore = f.drafts.getHead(f.id, passage.entityId)!;
    expect(f.service.preview(f.id, { message: "Rewrite passage prose", targetKeys: [`passage:${passage.entityId}`] })).toMatchObject({ status: "draft-workflow", passageId: passage.entityId, providerCalls: 0 });
    const p = await propose(f, 'Change this passage to "New planned beat"', [`passage:${passage.entityId}`]), review = readyReview(f, p);
    f.service.apply(f.id, p.id, review.selectedGroupIds, review.fingerprint);
    const head = f.drafts.getHead(f.id, passage.entityId)!; expect(head.acceptedLocked).toBe(true); expect(head.accepted!.id).toBe(protectedBefore.accepted!.id); expect(head.accepted!.proseMarkdown).toBe(protectedBefore.accepted!.proseMarkdown);
  });
  it("protects a nested planning lock against both direct and root replacement", async () => {
    const f = fixture(), sequence = f.bundle.structure.sequences[0]!;
    f.passages.insertStructureVersionInTransaction(f.id, { ...f.bundle.structure, sequences: f.bundle.structure.sequences.map((s) => s.id === sequence.id ? { ...s, planningStatus: "locked" } : s) });
    for (const key of [`passage-structure:${sequence.id}`, "passage-structure:root"]) {
      f.handler.run = async () => response(group(key, key.endsWith("root") ? { sequences: f.bundle.structure.sequences.map((s) => s.id === sequence.id ? { ...s, planningStatus: "locked", label: "Bypass lock" } : s) } : { label: "Bypass lock" }));
      await expect(propose(f, "Change sequence label", [key])).rejects.toThrow(/lock_protected/);
    }
  });
  it("rejects lifecycle-only and historical presentation bypasses without false staleness", async () => {
    const f = fixture(), passageId = f.bundle.passages[0]!.id, before = canonical(f);
    f.handler.run = async () => response(group(`passage:${passageId}`, { planningStatus: "approved" })); await expect(propose(f, "Approve passage", [`passage:${passageId}`])).rejects.toThrow(/protected_field/);
    f.handler.run = async () => response(group("brief:root", { tone: "Bypass Creative Direction" })); await expect(propose(f, "Change historical tone", ["brief:root"])).rejects.toThrow(/owns current tone/);
    expect(canonical(f)).toEqual(before);
  });
  it("treats no-op proposals as no-op canonical writes with no false staleness", async () => {
    const f = fixture(), before = canonical(f); f.handler.run = async () => response(group("bible:character-mira", { name: "Mira" }));
    const p = await propose(f), review = readyReview(f, p); expect(review.wouldStale).toEqual([]);
    const applied = f.service.apply(f.id, p.id, review.selectedGroupIds, review.fingerprint); expect(applied.resultingVersions).toEqual({}); expect(canonical(f)).toEqual(before);
  });
  it("records array provenance using native field paths without false material staleness", async () => {
    const f = fixture(), direction = f.longForm.snapshot(f.id)["creative-direction"]!;
    f.longForm.saveArtifact(f.id, "creative-direction", { ...direction, tone: { ...direction.tone, descriptors: ["hopeful", "tense"] } });
    const before = f.artifacts.getCurrent<typeof direction>(f.id, "creative-direction")!, workflows = f.workflow.get(f.id, "bible");
    f.handler.run = async () => response(group("creative-direction:section:tone", { descriptors: ["tense", "hopeful"] }));
    const p = await propose(f, "Reorder tone descriptors", ["creative-direction:section:tone"]), reviewed = readyReview(f, p); expect(reviewed.wouldStale).toEqual([]); expect(p.invalidations).toEqual([]);
    f.service.apply(f.id, p.id, reviewed.selectedGroupIds, reviewed.fingerprint);
    const after = f.artifacts.getCurrent<typeof direction>(f.id, "creative-direction")!; expect(after.content.materialFingerprint).toBe(before.content.materialFingerprint);
    expect(after.content.fieldProvenance).toContainEqual(expect.objectContaining({ fieldPath: "/tone/descriptors" })); expect(f.workflow.get(f.id, "bible")).toEqual(workflows);
  });
  it("fails oversized context before provider execution and keeps target catalogue metadata-only", () => {
    const f = fixture(), bible = f.longForm.snapshot(f.id).bible!;
    f.longForm.saveArtifact(f.id, "bible", { ...bible, characters: Array.from({ length: 20 }, (_, i) => ({ ...character(`large-${i}`, `Large ${i}`), summary: "x".repeat(9000) })) });
    expect(() => preview(f, "Edit the bible", ["bible:root"])).toThrow(/context_overflow/);
    const catalogue = f.service.catalogue(f.id); expect(JSON.stringify(catalogue)).not.toContain("x".repeat(100)); expect(f.calls).toHaveLength(0);
    const p = preview(f, "Discuss Large 0", ["bible:large-0"], { intent: "discuss" }); expect(Buffer.byteLength(JSON.stringify(editMessages(p.plan)))).toBeLessThan(64_000);
  });
  it("survives database handoff and blocks legacy Apply bypasses", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cyoa-a6-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const f = fixture(join(dir, "project.sqlite")), p = await propose(f);
    expect(() => f.longForm.applyProposal(f.id, p.id)).toThrow(/reviewed_apply/);
    expect(() => f.changes.apply(p.id, ProjectBriefSchema)).toThrow(/reviewed_apply/);
    expect(() => f.changes.applyPrepared(p.id, f.longForm.snapshot(f.id).brief!, ProjectBriefSchema)).toThrow(/reviewed_apply/);
    const db = openDatabase(join(dir, "project.sqlite")), artifacts = new ArtifactRepository(db), changes = new ChangeSetRepository(db), workflow = new WorkflowRepository(db), passages = new PassagePlanRepository(db);
    const service = new ConversationalEditService(db, new LongFormProjectService(new ProjectRepository(db), artifacts, workflow, changes, passages), [new OfflineEditProvider()]);
    cleanups.push(() => { service.shutdown(); db.close(); });
    const history = service.history(f.id, p.conversationId); expect(history.proposals[0]!.id).toBe(p.id); expect(service.proposal(f.id, p.id).proposal).toEqual(p.proposal);
    const review = service.review(f.id, p.id, ["edit-1"]); service.apply(f.id, p.id, review.selectedGroupIds, review.fingerprint);
    expect(artifacts.getCurrent<LongFormStoryBible>(f.id, "bible")!.content.characters[0]!.name).toBe("Ren");
  });
  it("exposes a closed bounded OpenRouter output contract without requiring model-generated hashes", async () => {
    const f = fixture(), plan = preview(f, 'Change tone to "quiet"', ["creative-direction:section:tone"]).plan;
    let request: unknown, schema: unknown;
    const client = { async generateStructuredRaw(input: unknown, outputSchema: unknown) { request = input; schema = outputSchema; return { content: JSON.stringify(response(group("creative-direction:section:tone", { customGuidance: "quiet" }))) }; } } as unknown as OpenRouterClient;
    const provider = new OpenRouterEditProvider(client), raw = await provider.generate({ ...plan, request: { ...plan.request, providerId: "openrouter-edit", modelId: "stub/model" } }, new AbortController().signal);
    expect(schema).toBeDefined(); expect(JSON.stringify(request)).toContain("Output contract"); expect(JSON.stringify(raw)).not.toContain("Fingerprint");
    f.handler.run = async () => raw; const p = await propose(f, 'Change tone to "quiet"', ["creative-direction:section:tone"]); expect(readyReview(f, p).outputs[0]!.after).toMatchObject({ customGuidance: "quiet" });
  });
  it("uses project-owned durable HTTP proposals with explicit generation and reviewed Apply", async () => {
    const app = buildApp(); cleanups.push(() => app.close());
    const created = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "A6 HTTP" } })).json(), id = created.project.id, root = `/api/long-form/projects/${id}/editing`;
    const preview = await app.inject({ method: "POST", url: `${root}/preview`, payload: { message: 'Change premise to "Harbor mystery"', targetKeys: ["brief:root"] } }); expect(preview.statusCode, preview.body).toBe(200);
    const plan = preview.json().plan;
    expect((await app.inject({ method: "POST", url: `${root}/plans/${plan.id}/generate`, payload: { fingerprint: "wrong" } })).statusCode).toBe(409);
    const generated = await app.inject({ method: "POST", url: `${root}/plans/${plan.id}/generate`, payload: { fingerprint: plan.fingerprint } }); expect(generated.statusCode, generated.body).toBe(200);
    const p = generated.json().proposal;
    const review = (await app.inject({ method: "POST", url: `${root}/proposals/${p.id}/review`, payload: { groupIds: ["edit-1"] } })).json();
    const applied = await app.inject({ method: "POST", url: `${root}/proposals/${p.id}/apply`, payload: { groupIds: ["edit-1"], fingerprint: review.fingerprint } }); expect(applied.statusCode, applied.body).toBe(200);
    const other = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Other" } })).json().project.id;
    expect((await app.inject({ method: "POST", url: `/api/long-form/projects/${other}/editing/proposals/${p.id}/reject` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `${root}/conversations` })).json()).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: `${root}/conversations/${plan.conversationId}` })).json().proposals[0].status).toBe("applied");
  });
  it("retrieves only grounded source ranges through accepted bootstrap stable-ID lineage, including after an edit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cyoa-a6-source-")); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); const path = join(dir, "project.sqlite");
    const source = analysisFixture(openDatabase(path)); completeFixture(source); const id = source.projectId, workflow = new WorkflowRepository(source.database), dossier = source.artifacts.getCurrent<SourceDossier>(id, "source-dossier")!;
    workflow.approve(id, "source-dossier", dossier.id);
    const intent = source.artifacts.saveArtifact({ projectId: id, artifactId: "adaptation-intent", content: normalizeAdaptationIntent(newAdaptationIntent(id, { dossierVersionId: dossier.id, dossierMaterialFingerprint: dossier.content.materialFingerprint, source: dossier.content.binding })) }); workflow.approve(id, "adaptation-intent", intent.id);
    source.artifacts.saveArtifact({ projectId: id, artifactId: "brief", content: defaultProjectBrief("Source editing") }); source.artifacts.saveArtifact({ projectId: id, artifactId: "creative-direction", content: defaultCreativeDirection() }); source.database.close();
    const app = buildApp({ databasePath: path }); cleanups.push(() => app.close()); const project = `/api/long-form/projects/${id}`, bootstrap = `${project}/foundation-bootstrap`, editing = `${project}/editing`;
    const post = async (url: string, payload: unknown) => { const r = await app.inject({ method: "POST", url, payload }); expect(r.statusCode, r.body).toBe(200); return r.json(); };
    const plan = await post(`${bootstrap}/preview`, { message: "Create source-grounded foundations", providerId: "offline-foundation-bootstrap", modelId: "offline-foundation-v1" });
    const job = await post(`${bootstrap}/start`, { planId: plan.id, fingerprint: plan.fingerprint });
    await vi.waitFor(async () => expect((await app.inject({ method: "GET", url: `${bootstrap}/jobs/${job.id}` })).json().status).toBe("completed"));
    const reviewed = await post(`${bootstrap}/jobs/${job.id}/preview-apply`, { artifactIds: [...FOUNDATION_ARTIFACT_IDS] }); await post(`${bootstrap}/jobs/${job.id}/apply`, { artifactIds: [...FOUNDATION_ARTIFACT_IDS], fingerprint: reviewed.previewFingerprint });
    const bible = (await app.inject({ method: "GET", url: project })).json().bible, key = `bible:${bible.content.canonFacts[0].id}`;
    const first = await post(`${editing}/preview`, { message: 'Rename Alex to "Ren"', targetKeys: [key] });
    expect(first.plan.context.evidence.length).toBeGreaterThan(0); expect(first.plan.context.evidence[0].excerpts[0].text).toBe(source.source.chapters[0]!.blocks[0]!.text);
    expect(JSON.stringify(first.plan.context)).not.toContain('"chapters":');
    const generated = await post(`${editing}/plans/${first.plan.id}/generate`, { fingerprint: first.plan.fingerprint }), groups = generated.proposal.proposal.response.groups.map((g: { id: string }) => g.id);
    const review = await post(`${editing}/proposals/${generated.proposal.id}/review`, { groupIds: groups }); expect(review.evidence.sourceRecords).toEqual(first.plan.context.evidence);
    await post(`${editing}/proposals/${generated.proposal.id}/apply`, { groupIds: groups, fingerprint: review.fingerprint });
    const next = await post(`${editing}/preview`, { message: "Discuss Ren", targetKeys: [key], intent: "discuss" }); expect(next.plan.context.evidence).toEqual(first.plan.context.evidence);
    const db = openDatabase(path); const artifacts = new ArtifactRepository(db); artifacts.saveArtifact({ projectId: id, artifactId: "source", content: { ...source.source, metadata: { ...source.source.metadata, title: "Reimported source" } } }); db.close();
    const failed = await app.inject({ method: "POST", url: `${editing}/preview`, payload: { message: "Discuss Ren", targetKeys: [key] } }); expect(failed.statusCode).toBe(409); expect(failed.json().error).toMatch(/evidence_unavailable/);
  });
});
