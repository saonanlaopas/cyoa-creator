import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactRepository, ChangeSetRepository, PassagePlanRepository, PortableProjectRepository, ProjectRepository, WorkflowRepository, openDatabase, transaction } from "@story-to-cyoa/persistence";
import { emptyWorld, emptyWorldEconomy, emptyWorldJournal, emptyWorldProgression, sourceDigest, type LongFormMechanicsPlan, type LongFormStoryBible, type WorldDefinition } from "@story-to-cyoa/domain";
import type { ChoicePlan } from "@story-to-cyoa/pipeline";
import { createNativePlayerConfig, NativePlayerConfigSchema } from "@story-to-cyoa/runtime";
import { LongFormProjectService } from "../src/services/long-form-project-service.js";
import { ConversationalEditService } from "../src/services/conversational-edit-service.js";
import { ConnectedEditService, type ConnectedEditTool } from "../src/services/connected-edit-service.js";
import type { EditResponse } from "../src/services/conversational-edit-contract.js";
import { PublicationExportService } from "../src/services/publication-export-service.js";
import { validatePortableAuthoringProject } from "../src/services/portable-project-validator.js";
import { PassagePlanService } from "../src/services/passage-plan-service.js";
import { WorldService } from "../src/services/world-service.js";

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(close => close()));
function fixture(db = openDatabase(), existingProjectId?: string) {
  const artifacts = new ArtifactRepository(db), projects = new ProjectRepository(db), workflow = new WorkflowRepository(db), changes = new ChangeSetRepository(db);
  const passages = new PassagePlanRepository(db), plans = new PassagePlanService(projects, artifacts, workflow, passages);
  const longForm = new LongFormProjectService(projects, artifacts, workflow, changes);
  const projectId = existingProjectId ?? seed();
  function seed() {
    const created = longForm.createProject("Neutral mechanic laboratory"), projectId = created.project.id;
    longForm.approveArtifact(projectId, "brief", created.brief.id); longForm.approveArtifact(projectId, "creative-direction", created.creativeDirection.id);
    for (const owner of ["bible", "routes", "endings", "mechanics"] as const) {
      let version = longForm.createArtifact(projectId, owner).artifact;
      if (owner === "bible") {
        const bible = version.content as LongFormStoryBible;
        version = longForm.saveArtifact(projectId, owner, { ...bible, characters: [{ id: "character-reviewer", name: "Reviewer", role: "Reviewer", summary: "", motivations: [], knowledge: [], plannedArc: "" }, { id: "character-observer", name: "Observer", role: "Observer", summary: "", motivations: [], knowledge: [], plannedArc: "" }], relationships: [{ id: "relationship-lab", characterIds: ["character-reviewer", "character-observer"], label: "Colleagues", currentState: "", plannedArc: "" }] }).artifact;
      }
      if (owner === "mechanics") {
        const value = version.content as LongFormMechanicsPlan;
        version = longForm.saveArtifact(projectId, owner, { ...value, gates: [{ id: "gate-existing", targetType: "ending", targetId: "ending-1", logic: "all", conditions: [{ id: "condition-existing", mechanicKey: "resolve", operator: "at-least", value: 0 }], rationale: "Existing gate", fallback: "Another ending" }], choiceEffectPlans: [{ id: "effect-existing", label: "Existing effects", sourceDecisionIds: ["decision-route-selection"], mechanicKeys: [...value.visibleStats, ...value.relationships].map(m => m.key), effectGuidance: ["Existing mechanics remain meaningful."] }] }).artifact;
      }
      longForm.approveArtifact(projectId, owner, version.id);
    }
    return projectId;
  }
  const generate = vi.fn(async () => { throw new Error("Provider calls forbidden"); });
  const edits = new ConversationalEditService(db, longForm, [{ id: "offline-edit", generate }]);
  const service = new ConnectedEditService(db, edits, [projectId], longForm);
  let closed = false;
  const close = () => { if (!closed) { closed = true; edits.shutdown(); db.close(); } };
  cleanup.push(close);
  const call = (tool: ConnectedEditTool, args: Record<string, unknown> = {}): any => service.call(tool, { projectId, ...args });
  const mechanics = () => artifacts.getCurrent<LongFormMechanicsPlan>(projectId, "mechanics")!;
  const prepare = (keys = ["mechanics:root"]) => { const prepareArgs = { operationId: randomUUID(), message: "Add the explicitly requested mechanic, preserving existing work.", headFingerprint: edits.connectedState(projectId).headFingerprint,
    targets: keys.map(key => ({ key, versionId: key.startsWith("choice:") ? passages.currentEntity(projectId, "choice", key.slice(7))!.id : artifacts.getCurrent(projectId, key.split(":")[0] as "mechanics")!.id })) }; return { ...call("prepare_edit", prepareArgs), prepareArgs }; };
  const submit = (operations: EditResponse["groups"][number]["operations"], plan = prepare(), extra = {}) => {
    const args = { operationId: randomUUID(), planId: plan.plan.id, fingerprint: plan.plan.fingerprint,
      response: { message: "Review the requested mechanic", groups: [{ id: "mechanic", label: "Mechanic", explanation: "Only the requested mechanic changes", dependsOnGroupIds: [], operations }] }, ...extra };
    return { args, result: call("submit_edit", args) };
  };
  const state = () => ({ artifacts: db.prepare("SELECT * FROM artifact_versions WHERE project_id=? ORDER BY id").all(projectId), workflow: db.prepare("SELECT * FROM artifact_workflow_state WHERE project_id=? ORDER BY artifact_id").all(projectId), proposals: db.prepare("SELECT * FROM change_sets WHERE project_id=? ORDER BY id").all(projectId) });
  return { db, projectId, artifacts, workflow, longForm, edits, service, generate, call, mechanics, prepare, submit, state, plans, passages, close };
}

const resource = { id: "$new:resource-clock", key: "clock_minutes", label: "Clock", kind: "counter", initial: 490, meaning: "Minutes after midnight during the current playable day." };
const addition = (collection: string, item: Record<string, unknown>) => ({ targetKey: "mechanics:root", kind: "add-item" as const, collection, item });
const scale = { description: "A fixture-only value", minimum: 0, maximum: 10, initial: 0, increaseSignals: [], decreaseSignals: [] };
const items = [
  ["visibleStats", { ...scale, id: "$new:focus", key: "focus", label: "Focus" }],
  ["relationships", { ...scale, id: "$new:cooperation", key: "cooperation", label: "Cooperation", relationshipId: "relationship-lab", bands: [] }],
  ["flags", { id: "$new:inspected", key: "inspected_panel", label: "Inspected panel", meaning: "The panel has been inspected." }],
  ["resources", { id: "$new:charge", key: "test_charge", label: "Test charge", kind: "counter", initial: 2, meaning: "Test charge; not world time, money or inventory." }],
] as const;
const usage = (keys: string[], id = "$new:usage") => addition("choiceEffectPlans", { id, label: "Requested consequences", sourceDecisionIds: ["decision-route-selection"], mechanicKeys: keys, effectGuidance: ["Read and change these values in the planned activity."] });
const withUsage = (collection: string, item: Record<string, unknown>) => [addition(collection, item), usage([item.key as string])];
function apply(f: ReturnType<typeof fixture>, proposalId: string, groupIds = ["mechanic"]) {
  const review = f.call("review_edit", { proposalId, groupIds });
  const args = { operationId: randomUUID(), proposalId, groupIds, fingerprint: review.fingerprint, approved: true };
  return { args, result: f.call("apply_edit", args) };
}
function evidence(name: string, value: unknown) {
  if (!process.env.CYOA_PF003_EVIDENCE) return;
  mkdirSync(process.env.CYOA_PF003_EVIDENCE, { recursive: true }); writeFileSync(join(process.env.CYOA_PF003_EVIDENCE, name + ".json"), JSON.stringify(value, null, 2) + "\n");
}

describe("PF-003 keyed mechanic authoring", () => {
  it("passes identity authorization for the minimal resource, retaining the canonical unused-mechanic diagnostic", () => {
    const f = fixture(), plan = f.prepare(), before = f.state();
    expect(() => f.submit([addition("resources", resource)], plan)).toThrow(/edit_validation_failed: Mechanic clock_minutes does not influence/);
    expect(f.state()).toEqual(before); expect(f.generate).not.toHaveBeenCalled();
    evidence("minimal-after", { item: resource, status: "identity authorization passed; unused mechanic rejected", unchanged: true, providerCalls: 0 });
  });
  it("accepts the label-only control while retaining the existing key", () => {
    const f = fixture(), before = f.mechanics(), plan = f.prepare(["mechanics:stat-resolve"]);
    const submitted = f.submit([{ kind: "set-fields", targetKey: "mechanics:stat-resolve", changes: { label: "Authority" } }], plan);
    const review = f.call("review_edit", { proposalId: submitted.result.proposalId, groupIds: ["mechanic"] });
    f.call("apply_edit", { operationId: randomUUID(), proposalId: submitted.result.proposalId, groupIds: ["mechanic"], fingerprint: review.fingerprint, approved: true });
    expect(f.mechanics().content.visibleStats[0]).toEqual({ ...before.content.visibleStats[0], label: "Authority" });
    expect(f.mechanics().content.visibleStats.slice(1)).toEqual(before.content.visibleStats.slice(1));
    evidence("label-control", { label: f.mechanics().content.visibleStats[0]!.label, key: f.mechanics().content.visibleStats[0]!.key, providerCalls: 0 });
  });
  it.each(items)("creates a schema-valid %s identity/key pair and preserves unrelated approved records", (collection, item) => {
    const f = fixture(), before = f.longForm.snapshot(f.projectId), version = f.mechanics();
    const submitted = f.submit(withUsage(collection, structuredClone(item)));
    expect(f.mechanics()).toEqual(version);
    apply(f, submitted.result.proposalId);
    const after = f.longForm.snapshot(f.projectId), records = f.mechanics().content[collection];
    expect(records.slice(0, -1)).toEqual(version.content[collection]);
    expect(records.at(-1)).toEqual({ ...item, id: expect.stringMatching(/^a6_[0-9a-f]{24}$/) });
    for (const owner of ["brief", "creative-direction", "bible", "routes", "endings"] as const) expect(after[owner]).toEqual(before[owner]);
    expect(f.workflow.get(f.projectId, "mechanics")).toMatchObject({ status: "draft", approvedVersionId: version.id });
    f.edits.validateArchiveHistory(f.projectId); expect(f.generate).not.toHaveBeenCalled();
  });
  it.each(["Bad Key", "Uppercase", "_bad", "9bad", "a".repeat(101), " trimmed "])("rejects an invalid or noncanonical key %s atomically", key => {
    const f = fixture(), plan = f.prepare(), before = f.state();
    expect(() => f.submit(withUsage("resources", { ...resource, key }), plan)).toThrow();
    expect(f.state()).toEqual(before);
  });
  it.each(["resolve", "stat-resolve", "character-observer", "route-1"])("keeps existing key/ID collision protections: %s", key => {
    const f = fixture(), plan = f.prepare(), before = f.state();
    expect(() => f.submit(withUsage("resources", { ...resource, key }), plan)).toThrow(/collision/);
    expect(f.state()).toEqual(before);
  });
  it("rejects duplicate keys across new collections and collisions with a generated entity ID", () => {
    const f = fixture(), plan = f.prepare(), before = f.state();
    expect(() => f.submit([addition("resources", { ...resource, key: "shared_key" }), addition("flags", { ...items[2][1], key: "shared_key" }), usage(["shared_key"])], plan)).toThrow(/unique/);
    const generated = `a6_${sourceDigest({ plan: plan.plan.fingerprint, logical: resource.id }).slice(0, 24)}`;
    expect(() => f.submit(withUsage("resources", { ...resource, key: generated }), plan)).toThrow(/collision/);
    expect(f.state()).toEqual(before);
  });
  it.each(["nested", "root", "swap"])("rejects existing-key renaming through %s editing", kind => {
    const f = fixture(), old = f.mechanics().content, plan = f.prepare(kind === "nested" ? ["mechanics:stat-resolve"] : ["mechanics:root"]), before = f.state();
    const op = kind === "nested" ? { targetKey: "mechanics:stat-resolve", kind: "set-fields" as const, changes: { key: "authority" } }
      : { targetKey: "mechanics:root", kind: "set-fields" as const, changes: { visibleStats: old.visibleStats.map((m, i) => ({ ...m, key: kind === "swap" ? old.visibleStats[i === 0 ? 1 : i === 1 ? 0 : i]!.key : i === 0 ? "authority" : m.key })) } };
    expect(() => f.submit([op], plan)).toThrow("edit_mechanic_key_rename_unsupported"); expect(f.state()).toEqual(before);
  });
  it("does not authorize keys injected through replacement arrays, other owners or nested records", () => {
    const f = fixture();
    expect(() => f.submit([{ targetKey: "mechanics:root", kind: "set-fields", changes: { resources: [resource] } }])).toThrow(/generated/);
    const plan = f.prepare(["bible:root"]);
    expect(() => f.submit([{ targetKey: "bible:root", kind: "add-item", collection: "canonFacts", item: { id: "$new:fact", key: "smuggled_key", statement: "A neutral fact.", sourceExcerptIds: [], confidence: "confirmed" } }], plan)).toThrow("edit_generated_id_invalid");
    const relationship = f.mechanics().content.relationships[0]!;
    expect(() => f.submit([{ targetKey: `mechanics:${relationship.id}`, kind: "add-item", collection: "bands", item: { id: "$new:band", key: "smuggled_key", minimum: 6, label: "Trusted", meaning: "" } }], f.prepare([`mechanics:${relationship.id}`]))).toThrow("edit_generated_id_invalid");
  });
  it("binds new keys to their exact creation IDs/collections rather than a batch-wide key whitelist", () => {
    const f = fixture(), before = f.state(), old = f.mechanics().content;
    expect(() => f.submit([
      addition("visibleStats", items[0][1]), addition("resources", items[3][1]), usage(["focus", "test_charge"]),
      { targetKey: "mechanics:root", kind: "set-fields", changes: { visibleStats: [...old.visibleStats, { ...items[0][1], key: "test_charge" }], resources: [{ ...items[3][1], key: "focus" }] } },
    ])).toThrow("edit_generated_id_invalid");
    expect(() => f.submit([
      addition("balancingRules", { id: resource.id, label: "Unrelated producer", description: "" }),
      { targetKey: "mechanics:root", kind: "set-fields", changes: { balancingRules: old.balancingRules, resources: [resource] } }, usage([resource.key]),
    ])).toThrow("edit_generated_id_invalid");
    expect(f.state()).toEqual(before);
  });
  it("requires the creation group for semantic-key references, then accepts subsequent valid conditions and rejects unknown references", () => {
    const f = fixture(), plan = f.prepare();
    const submitted = f.submit([], plan, { response: { message: "Create and use the key", groups: [
      { id: "create", label: "Create", explanation: "Requested resource", dependsOnGroupIds: [], operations: [addition("resources", resource)] },
      { id: "use", label: "Use", explanation: "Consequences", dependsOnGroupIds: [], operations: [usage([resource.key])] },
    ] } });
    expect(() => f.call("review_edit", { proposalId: submitted.result.proposalId, groupIds: ["use"] })).toThrow("dependency_selection_incomplete");
    apply(f, submitted.result.proposalId, ["create", "use"]);
    const old = f.mechanics().content;
    const gateEdit = (key: string) => ({ targetKey: "mechanics:root", kind: "set-fields" as const, changes: { gates: old.gates.map(gate => ({ ...gate, conditions: gate.conditions.map(condition => ({ ...condition, mechanicKey: key })) })) } });
    expect(() => f.submit([gateEdit("unknown_key")])).toThrow(/Unknown mechanic key/);
    const condition = f.submit([gateEdit(resource.key)]); apply(f, condition.result.proposalId);
    expect(f.mechanics().content.gates[0]!.conditions[0]!.mechanicKey).toBe(resource.key);
    const effect = f.submit([usage([resource.key], "$new:later-use")]); apply(f, effect.result.proposalId);
    expect(f.mechanics().content.choiceEffectPlans.at(-1)!.mechanicKeys).toEqual([resource.key]);
  });
  it("replays exact prepare/submit/Apply receipts and rejects changed retries without duplicate creation", () => {
    const f = fixture(), plan = f.prepare(), submitted = f.submit(withUsage("resources", resource), plan);
    const { prepareArgs, ...prepared } = plan; expect(f.call("prepare_edit", prepareArgs)).toEqual(prepared);
    expect(f.call("submit_edit", submitted.args)).toEqual(submitted.result);
    expect(() => f.call("submit_edit", { ...submitted.args, response: { ...submitted.args.response, message: "Changed" } })).toThrow("operation_id_conflict");
    const applied = apply(f, submitted.result.proposalId);
    expect(f.call("apply_edit", applied.args)).toEqual(applied.result);
    const resumed = new ConnectedEditService(f.db, new ConversationalEditService(f.db, f.longForm, []), [f.projectId], f.longForm);
    expect(resumed.call("apply_edit", { projectId: f.projectId, ...applied.args })).toEqual(applied.result);
    expect(f.mechanics().content.resources).toHaveLength(1); expect(f.artifacts.listVersions(f.projectId, "mechanics")).toHaveLength(3);
  });
  it("does not treat a label matching a proposed key as a semantic reference", () => {
    const f = fixture(), plan = f.prepare(["mechanics:root", "mechanics:stat-resolve"]);
    const submitted = f.submit([], plan, { response: { message: "Two independently reviewable changes", groups: [
      { id: "create", label: "New focus stat", explanation: "Requested stat", dependsOnGroupIds: [], operations: withUsage("visibleStats", items[0][1]) },
      { id: "caption", label: "Caption only", explanation: "Keep the original semantic key", dependsOnGroupIds: [], operations: [{ targetKey: "mechanics:stat-resolve", kind: "set-fields", changes: { label: "focus" } }] },
    ] } });
    apply(f, submitted.result.proposalId, ["caption"]);
    expect(f.mechanics().content.visibleStats[0]).toMatchObject({ id: "stat-resolve", key: "resolve", label: "focus" });
    expect(f.mechanics().content.visibleStats.some(m => m.key === "focus")).toBe(false);
  });
  it.each(["submit", "apply"])("rejects stale %s after a browser edit without overwriting it", boundary => {
    const f = fixture(), plan = f.prepare(), proposal = boundary === "apply" ? f.submit(withUsage("resources", resource), plan) : null;
    const reviewed = proposal ? f.call("review_edit", { proposalId: proposal.result.proposalId, groupIds: ["mechanic"] }) : null;
    f.longForm.saveArtifact(f.projectId, "mechanics", { ...f.mechanics().content, overview: "An intervening browser revision" }); const before = f.state();
    expect(() => boundary === "submit" ? f.submit(withUsage("resources", resource), plan) : f.call("apply_edit", { operationId: randomUUID(), proposalId: proposal!.result.proposalId, groupIds: ["mechanic"], fingerprint: reviewed.fingerprint, approved: true })).toThrow(/stale/);
    expect(f.state()).toEqual(before); expect(f.mechanics().content.resources).toEqual([]);
  });
  it.each(["submit", "apply"])("rolls back %s and its receipt, then supports the identical retry", boundary => {
    const f = fixture(), plan = f.prepare(), operations = withUsage("resources", resource);
    const args = { operationId: randomUUID(), planId: plan.plan.id, fingerprint: plan.plan.fingerprint, response: { message: "Requested charge", groups: [{ id: "mechanic", label: "Charge", explanation: "Requested charge", dependsOnGroupIds: [], operations }] } };
    const submitted = boundary === "apply" ? f.call("submit_edit", args) : null;
    const review = submitted ? f.call("review_edit", { proposalId: submitted.proposalId, groupIds: ["mechanic"] }) : null;
    const input = submitted ? { operationId: randomUUID(), proposalId: submitted.proposalId, groupIds: ["mechanic"], fingerprint: review.fingerprint, approved: true } : args;
    const before = f.state();
    f.db.exec("CREATE TEMP TRIGGER pf003_receipt_failure BEFORE INSERT ON messages WHEN json_type(NEW.metadata_json,'$.connectedOperation') IS NOT NULL BEGIN SELECT RAISE(ABORT,'PF003 receipt failure'); END");
    expect(() => f.call(boundary === "submit" ? "submit_edit" : "apply_edit", input)).toThrow("PF003 receipt failure"); expect(f.state()).toEqual(before);
    f.db.exec("DROP TRIGGER pf003_receipt_failure");
    expect(f.call(boundary === "submit" ? "submit_edit" : "apply_edit", input).status).toBe(boundary === "submit" ? "proposed" : "applied");
  });
  it.each(["full-fidelity", "privacy-redacted"] as const)("preserves paired keys and auditable history through %s export/import and duplication", mode => {
    const f = fixture(), proposal = f.submit(withUsage("resources", resource)); apply(f, proposal.result.proposalId);
    const archive = new PublicationExportService(new PortableProjectRepository(f.db), undefined).exportStudioPortable(f.projectId, mode), target = openDatabase();
    try {
      new PublicationExportService(new PortableProjectRepository(target), undefined).importPortable(archive.bytes);
      validatePortableAuthoringProject(target, f.projectId);
      const copied = new ProjectRepository(target).duplicate(f.projectId, "Neutral key copy", validatePortableAuthoringProject);
      expect(new ArtifactRepository(target).getCurrent<LongFormMechanicsPlan>(copied.id, "mechanics")!.content.resources).toEqual(f.mechanics().content.resources);
    } finally { target.close(); }
  });
  it("rejects unknown relationship references and incompatible mechanic values atomically", () => {
    const f = fixture(), before = f.state();
    expect(() => f.submit(withUsage("relationships", { ...items[1][1], relationshipId: "unknown-relationship" }))).toThrow(/validation_failed/);
    expect(() => f.submit(withUsage("visibleStats", { ...items[0][1], initial: 11 }))).toThrow(/Initial values/);
    expect(f.state()).toEqual(before);
  });
});

describe("PF-006 keyed mechanic removal", () => {
  const remove = (id: string) => ({ targetKey: `mechanics:${id}`, kind: "remove-item" as const });
  const writes = (f: ReturnType<typeof fixture>) => ({ ...f.state(), messages: f.db.prepare("SELECT COUNT(*) n FROM messages").get(),
    entities: f.db.prepare("SELECT COUNT(*) n FROM passage_entity_versions").get(), approvals: f.db.prepare("SELECT * FROM artifact_version_approvals ORDER BY version_id").all() });
  const group = (id: string, operations: EditResponse["groups"][number]["operations"]) =>
    ({ id, label: id, explanation: "Exact reviewed cleanup", dependsOnGroupIds: [], operations });
  const resolveTarget = "mechanics:stat-resolve";
  const choiceId = "choice-passage-shared-opening-continue";
  function worldFixture(f: ReturnType<typeof fixture>): WorldDefinition {
    const start = f.plans.bundle(f.projectId).structure.startPassageId!;
    return { ...emptyWorld(), enabled: true, startLocationId: "home",
      locations: [{ id: "home", name: "Home", passage: { passageId: start, versionId: f.passages.currentEntity(f.projectId, "passage", start)!.id },
        parentId: null, mapImage: null, marker: null, hours: null }] };
  }
  function applyWorld(f: ReturnType<typeof fixture>, world: WorldDefinition) {
    const service = new WorldService(f.db), review = service.review(f.projectId, world);
    return transaction(f.db, () => service.apply(f.projectId, world, review.fingerprint));
  }

  it.each(items)("removes an exact unreferenced %s record and preserves the other IDs, keys and approved versions", (collection, item) => {
    const f = fixture();
    const approved = f.mechanics(), foundations = f.longForm.snapshot(f.projectId);
    const unused = { ...item, id: "fixture-unused", ...(collection === "relationships"
      ? { bands: [{ id: "fixture-owned-band", minimum: 0, label: "Neutral", meaning: "" }] } : {}) };
    const draft = f.longForm.saveArtifact(f.projectId, "mechanics", { ...approved.content, [collection]: [...approved.content[collection], unused] }).artifact;
    const operation = remove(unused.id), prepared = f.prepare([operation.targetKey]);
    const submitted = f.submit([operation], prepared);
    expect(f.mechanics()).toEqual(draft);
    const review = f.call("review_edit", { proposalId: submitted.result.proposalId, groupIds: ["mechanic"] });
    expect(review.outputs).toEqual([{ owner: "mechanics", targetId: unused.id, before: unused, after: null }]);
    apply(f, submitted.result.proposalId);
    expect(f.longForm.snapshot(f.projectId)).toEqual(foundations);
    expect(f.workflow.get(f.projectId, "mechanics")).toMatchObject({ status: "draft", approvedVersionId: approved.id });
    expect(f.artifacts.getVersion(approved.id)).toEqual(approved);
    f.edits.validateArchiveHistory(f.projectId);
    expect(f.generate).not.toHaveBeenCalled();
  });

  it("names unresolved gate, effect-plan, nested choice condition and choice-effect references and accepts only valid selections", () => {
    const f = fixture(), { projectId, call } = f;
    f.plans.create(projectId);
    const oldChoice = f.passages.currentEntity<ChoicePlan>(projectId, "choice", choiceId)!.content;
    const effect = { id: "fixture-entry-effect", mechanicKey: "resolve", operation: "add" as const, value: 1, feedback: "", visibility: "visible" as const };
    const condition = { kind: "not" as const, item: { kind: "compare" as const, mechanicKey: "resolve", operator: "lt" as const, value: 0 } };
    f.plans.saveEntity(projectId, "choice", choiceId, { ...oldChoice, effects: [effect], condition });
    const initial = f.mechanics(), prepared = f.prepare([resolveTarget, "mechanics:condition-existing", "mechanics:effect-existing", `choice:${choiceId}`]);
    const deletion = group("delete", [remove("stat-resolve")]);
    const foundationCleanup = group("foundation", [
      { targetKey: "mechanics:condition-existing", kind: "set-fields", changes: { mechanicKey: "insight" } },
      { targetKey: "mechanics:effect-existing", kind: "set-fields", changes: { mechanicKeys: initial.content.choiceEffectPlans[0]!.mechanicKeys.filter(key => key !== "resolve") } },
    ]);
    const choiceCleanup = group("choice", [{ targetKey: `choice:${choiceId}`, kind: "set-fields", changes: { condition: null, effects: [{ ...effect, mechanicKey: "insight" }] } }]);
    const before = writes(f);
    expect(() => f.submit(deletion.operations, prepared)).toThrow(/resolve in gate gate-existing condition condition-existing; resolve in effect plan effect-existing/);
    expect(writes(f)).toEqual(before);
    const submitted = f.submit([], prepared, { response: { message: "Remove Resolve and explicitly rebind its references", groups: [deletion, foundationCleanup, choiceCleanup] } });
    const proposalId = submitted.result.proposalId, beforeReview = writes(f);
    const incomplete = ["delete", "foundation"];
    expect(() => call("review_edit", { proposalId, groupIds: incomplete })).toThrow(/resolve in choice .* condition; resolve in choice .* effect fixture-entry-effect/);
    expect(() => call("apply_edit", { proposalId, groupIds: incomplete, operationId: randomUUID(), fingerprint: "0".repeat(64), approved: true })).toThrow("edit_mechanic_removal_referenced");
    expect(writes(f)).toEqual(beforeReview);
    const applied = apply(f, proposalId, ["delete", "foundation", "choice"]);
    expect(applied.result.status).toBe("applied");
    expect(f.mechanics().content.visibleStats).toEqual(initial.content.visibleStats.filter(item => item.key !== "resolve"));
    expect(f.mechanics().content.gates[0]!.conditions[0]).toMatchObject({ id: "condition-existing", mechanicKey: "insight" });
    expect(f.passages.currentEntity(projectId, "choice", choiceId)?.content).toEqual({ ...oldChoice, condition: null, effects: [{ ...effect, mechanicKey: "insight" }] });
    expect(f.workflow.get(projectId, "mechanics")).toMatchObject({ status: "draft", approvedVersionId: initial.id });
    expect(f.passages.state(projectId).status).toBe("stale");
    f.edits.validateArchiveHistory(projectId);
  });

  it("rejects unprepared removals, array replacement, and reuse of an owned semantic key as an unrelated ID", () => {
    const f = fixture(), unused = { ...resource, id: "fixture-unused", key: "fixture_charge" };
    const content = { ...f.mechanics().content, resources: [unused] };
    f.longForm.saveArtifact(f.projectId, "mechanics", content);
    const deletion = remove(unused.id), rootOnly = f.prepare(), rootBefore = writes(f);
    expect(() => f.submit([deletion], rootOnly)).toThrow("edit_scope_exceeded");
    expect(() => f.submit([{ targetKey: "mechanics:root", kind: "set-fields", changes: { resources: [] } }], rootOnly)).toThrow("edit_identity_changed");
    expect(writes(f)).toEqual(rootBefore);
    const both = f.prepare([deletion.targetKey, "mechanics:root"]), before = writes(f);
    expect(() => f.submit([deletion, { targetKey: "mechanics:root", kind: "set-fields", changes: { resources: [unused] } }], both))
      .toThrow("edit_mechanic_removal_requires_exact_scope");
    expect(() => f.submit([deletion, { targetKey: "mechanics:root", kind: "set-fields", changes: { balancingRules: [
      ...content.balancingRules, { id: unused.key, label: "Not a new ID", description: "" },
    ] } }], both)).toThrow("edit_mechanic_removal_identity_reused");
    expect(writes(f)).toEqual(before);
  });

  it("blocks current World journal, relationship prerequisites and economy effects without changing World", () => {
    const f = fixture(), { projectId } = f;
    f.plans.create(projectId);
    const key = f.mechanics().content.relationships[0]!.key;
    const relationship = { kind: "relationship" as const, key, minimum: 0, maximum: null };
    const event = { id: "fixture-greeting", label: "Greeting", prerequisites: [relationship], repeat: { kind: "once" as const },
      visibility: "always" as const, passage: null, minutes: 3, milestoneIds: [], result: "The watch records the greeting." };
    const world: WorldDefinition = { ...worldFixture(f),
      progression: { ...emptyWorldProgression(), events: [event] },
      economy: { ...emptyWorldEconomy(), eventEffects: [{ eventId: event.id, costs: { currency: 0, items: [] },
        effects: { currency: 0, items: [], relationships: [{ key, delta: 1 }], milestoneIds: [] } }] },
      journal: { ...emptyWorldJournal(), character: [{ category: "stat", key: "resolve", when: [] }],
        objectives: [{ id: "fixture-objective", title: "Ask the watch", description: "Read the watch report.", when: [], completeWhen: [{ kind: "stat", key: "resolve", minimum: 0, maximum: null }] }] },
    };
    const saved = applyWorld(f, world);
    const original = f.mechanics().content;
    const without = (key: string) => original.choiceEffectPlans[0]!.mechanicKeys.filter(item => item !== key);
    const cleanPlan = (key: string) => ({ targetKey: "mechanics:effect-existing", kind: "set-fields" as const, changes: { mechanicKeys: without(key) } });
    const stat = f.prepare([resolveTarget, "mechanics:condition-existing", "mechanics:effect-existing"]), beforeStat = writes(f);
    expect(() => f.submit([remove("stat-resolve"), cleanPlan("resolve"),
      { targetKey: "mechanics:condition-existing", kind: "set-fields", changes: { mechanicKey: "insight" } }], stat))
      .toThrow(/resolve in World journal character visibility; resolve in World journal objective fixture-objective completion/);
    expect(writes(f)).toEqual(beforeStat);
    const rel = remove(original.relationships[0]!.id), relPlan = f.prepare([rel.targetKey, "mechanics:effect-existing"]), beforeRel = writes(f);
    expect(() => f.submit([rel, cleanPlan(key)], relPlan)).toThrow(/World event fixture-greeting prerequisites.*World event fixture-greeting economy effects/);
    expect(writes(f)).toEqual(beforeRel);
    expect(f.artifacts.getCurrent(projectId, "world-definition")).toMatchObject({ id: saved.versionId, content: world });
  });

  it("rejects a changed World version after prepare or review even if it adds no references", () => {
    const f = fixture(), { projectId } = f;
    f.plans.create(projectId);
    const world = worldFixture(f);
    applyWorld(f, world);
    f.longForm.saveArtifact(projectId, "mechanics", { ...f.mechanics().content, resources: [{ ...resource, id: "fixture-unused" }] });
    const op = remove("fixture-unused"), plan = f.prepare([op.targetKey]);
    const proposal = f.submit([op], plan).result, selection = { proposalId: proposal.proposalId, groupIds: ["mechanic"] };
    const review = f.call("review_edit", selection), unsent = f.prepare([op.targetKey]);
    applyWorld(f, { ...world, locations: [{ ...world.locations[0]!, name: "Revised home name" }] });
    const before = writes(f);
    expect(() => f.submit([op], unsent)).toThrow("edit_mechanic_removal_bindings_stale_repreview");
    expect(() => f.call("apply_edit", { ...selection, fingerprint: review.fingerprint, operationId: randomUUID(), approved: true }))
      .toThrow("edit_mechanic_removal_bindings_stale_repreview");
    expect(writes(f)).toEqual(before);
  });

  it("blocks an authored player configuration reference until separately updated", () => {
    const f = fixture(), { projectId } = f;
    const configure = (visible: boolean) => f.artifacts.saveArtifact({ projectId, artifactId: "native-player-config",
      artifactType: "native-player-config", schema: NativePlayerConfigSchema,
      content: createNativePlayerConfig({ gameId: projectId, visibleMechanics: visible ? [{ category: "stat", key: "resolve", label: "Resolve" }] : [] }) });
    configure(true);
    const operations = [remove("stat-resolve"),
      { targetKey: "mechanics:condition-existing", kind: "set-fields" as const, changes: { mechanicKey: "insight" } },
      { targetKey: "mechanics:effect-existing", kind: "set-fields" as const, changes: { mechanicKeys: f.mechanics().content.choiceEffectPlans[0]!.mechanicKeys.filter(key => key !== "resolve") } }];
    const targets = operations.map(op => op.targetKey), plan = f.prepare(targets), before = writes(f);
    expect(() => f.submit(operations, plan)).toThrow("resolve in player configuration");
    expect(writes(f)).toEqual(before);
    const updated = configure(false);
    const fresh = f.submit(operations, f.prepare(targets));
    apply(f, fresh.result.proposalId);
    expect(f.artifacts.getCurrent(projectId, "native-player-config")).toEqual(updated);
  });

  it("rolls back failed Apply, replays after reopening, and retains auditable portable history", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-pf006-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "fixture.sqlite"), f = fixture(openDatabase(path)), { projectId, call } = f;
    f.plans.create(projectId);
    const world = worldFixture(f), binding = applyWorld(f, world);
    f.longForm.saveArtifact(projectId, "mechanics", { ...f.mechanics().content, resources: [{ ...resource, id: "fixture-unused" }] });
    const op = remove("fixture-unused"), plan = f.prepare([op.targetKey]), submitted = f.submit([op], plan);
    const selected = { proposalId: submitted.result.proposalId, groupIds: ["mechanic"] };
    const review = call("review_edit", selected), before = writes(f);
    const args = { ...selected, operationId: randomUUID(), fingerprint: review.fingerprint, approved: true };
    f.db.exec("CREATE TEMP TRIGGER pf006_apply_failure BEFORE INSERT ON messages WHEN json_extract(NEW.metadata_json,'$.connectedOperation.tool')='apply_edit' BEGIN SELECT RAISE(ABORT,'PF-006 receipt failure'); END");
    expect(() => call("apply_edit", args)).toThrow("PF-006 receipt failure");
    expect(writes(f)).toEqual(before);
    f.db.exec("DROP TRIGGER pf006_apply_failure");
    const applied = call("apply_edit", args);
    expect(f.artifacts.getCurrent(projectId, "world-definition")).toMatchObject({ id: binding.versionId, content: world });
    applyWorld(f, { ...world, locations: [{ ...world.locations[0]!, name: "Renamed home" }] });
    const after = writes(f);
    f.close();
    const reopened = fixture(openDatabase(path), projectId);
    expect(reopened.call("submit_edit", submitted.args)).toEqual(submitted.result);
    expect(reopened.call("apply_edit", args)).toEqual(applied);
    expect(() => reopened.call("apply_edit", { ...args, fingerprint: "0".repeat(64) })).toThrow("connected_operation_id_conflict");
    expect(writes(reopened)).toEqual(after);
    const service = new PublicationExportService(new PortableProjectRepository(reopened.db), undefined);
    for (const mode of ["full-fidelity", "privacy-redacted"] as const) {
      const target = openDatabase();
      try {
        new PublicationExportService(new PortableProjectRepository(target), undefined).importPortable(service.exportStudioPortable(projectId, mode).bytes);
        validatePortableAuthoringProject(target, projectId);
        const artifacts = new ArtifactRepository(target);
        expect(artifacts.getCurrent<LongFormMechanicsPlan>(projectId, "mechanics")!.content.resources).toEqual([]);
        expect(artifacts.getVersion(binding.versionId)?.content).toEqual(world);
        expect(artifacts.listVersions<LongFormMechanicsPlan>(projectId, "mechanics").some(v => v.content.resources[0]?.id === "fixture-unused")).toBe(true);
        const copied = new ProjectRepository(target).duplicate(projectId, "Neutral removal copy", validatePortableAuthoringProject);
        expect(artifacts.getCurrent<LongFormMechanicsPlan>(copied.id, "mechanics")!.content.resources).toEqual([]);
      } finally { target.close(); }
    }
  });
});
