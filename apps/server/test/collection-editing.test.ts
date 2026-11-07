import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactRepository, AuthorMemoryRepository, ChangeSetRepository, CommandRepository, PortableProjectRepository, ProjectRepository, WorkflowRepository, openDatabase } from "@story-to-cyoa/persistence";
import { sourceCanonicalJson, type LongFormStoryBible, type LongFormRoutePlan, type LongFormMechanicsPlan } from "@story-to-cyoa/domain";
import { LongFormProjectService } from "../src/services/long-form-project-service.js";
import { ConversationalEditService } from "../src/services/conversational-edit-service.js";
import { ConnectedEditService, type ConnectedEditTool } from "../src/services/connected-edit-service.js";
import { editMessages } from "../src/services/conversational-edit-provider.js";
import { collectionTargets, assertCollectionTarget } from "../src/services/conversational-collection-targets.js";
import type { EditResponse } from "../src/services/conversational-edit-contract.js";
import { largeBible, largeRoutes } from "../../../e2e/helpers/large-foundations.js";
import { PublicationExportService } from "../src/services/publication-export-service.js";
import { RecoveryService } from "../src/services/recovery-service.js";
import { validatePortableAuthoringProject } from "../src/services/portable-project-validator.js";

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(close => close()));
function fixture(stress = false, path = ":memory:", legacy = false) {
  const db = openDatabase(path), artifacts = new ArtifactRepository(db), workflow = new WorkflowRepository(db);
  const projects = new ProjectRepository(db), create = projects.create.bind(projects);
  if (legacy) vi.spyOn(projects, "create").mockImplementationOnce((name, id, mode) => create(name, id, mode, false));
  const longForm = new LongFormProjectService(projects, artifacts, workflow, new ChangeSetRepository(db));
  const made = longForm.createProject("Regional research station"), id = made.project.id;
  const brief = longForm.saveArtifact(id, "brief", { ...made.brief.content, routeTarget: 3, endingTarget: 7, totalWordTarget: 100000, typicalPlaythroughWordTarget: 40000 }).artifact;
  longForm.approveArtifact(id, "brief", brief.id); longForm.approveArtifact(id, "creative-direction", made.creativeDirection.id);
  for (const owner of ["bible", "routes", "endings", "mechanics"] as const) {
    let v = longForm.createArtifact(id, owner).artifact;
    if (owner === "bible") v = longForm.saveArtifact(id, owner, largeBible(v.content as LongFormStoryBible, stress ? 3 : 1)).artifact;
    if (owner === "routes") v = longForm.saveArtifact(id, owner, largeRoutes(v.content as LongFormRoutePlan, stress ? 5 : 1)).artifact;
    if (owner === "mechanics") { const m = v.content as LongFormMechanicsPlan; v = longForm.saveArtifact(id, owner, { ...m, choiceEffectPlans: [{ id: "effect-use", label: "Declared use", sourceDecisionIds: ["decision-route-selection"], mechanicKeys: [...m.visibleStats, ...m.relationships].map(x => x.key), effectGuidance: ["Carry investigation consequences into the authored choices."] }] }).artifact; }
    longForm.approveArtifact(id, owner, v.id);
  }
  const generate = vi.fn(async () => { throw new Error("Unexpected provider call"); });
  const edits = new ConversationalEditService(db, longForm, [{ id: "offline-edit", generate }]);
  const connected = new ConnectedEditService(db, edits, [id], longForm);
  cleanup.push(() => { edits.shutdown(); db.close(); });
  const call = (tool: ConnectedEditTool, args: Record<string, unknown> = {}): any => connected.call(tool, { projectId: id, ...args });
  const prepare = (keys = ["collection:bible:characters"]) => {
    const targets = keys.map(key => ({ key, versionId: artifacts.getCurrent(id, (key.startsWith("collection:") ? key.split(":")[1] : key.split(":")[0]) as "bible")!.id }));
    const args = { operationId: randomUUID(), message: "Add only the requested investigation records.", headFingerprint: call("project_state").headFingerprint, targets };
    return { ...call("prepare_edit", args), args };
  };
  const submit = (operations: EditResponse["groups"][number]["operations"], plan = prepare(), groups?: EditResponse["groups"]) => {
    const args = { operationId: randomUUID(), planId: plan.plan.id, fingerprint: plan.plan.fingerprint, response: { message: "Review the exact additions", groups: groups ?? [{ id: "new", label: "Investigation records", explanation: "Only the selected records change", dependsOnGroupIds: [], operations }] } };
    return { result: call("submit_edit", args), args };
  };
  const apply = (proposalId: string, groupIds = ["new"]) => { const review = call("review_edit", { proposalId, groupIds }); const args = { operationId: randomUUID(), proposalId, groupIds, fingerprint: review.fingerprint, approved: true }; return { review, args, result: call("apply_edit", args) }; };
  const state = () => Object.fromEntries((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
  return { db, id, artifacts, workflow, longForm, edits, generate, call, prepare, submit, apply, state };
}
const person = { id: "$new:witness", name: "Independent witness", role: "Inspection witness", summary: "Checks the attributed inspection record.", motivations: [], knowledge: [], plannedArc: "Reports what can be verified." };
const add = (targetKey: string, collection: string, item: Record<string, unknown>): EditResponse["groups"][number]["operations"][number] => ({ targetKey, kind: "add-item", collection, item });
const decision = () => ({ id: "$new:inspection", label: "Inspection testimony", actId: "shared-route-pivot", question: "Record testimony now or verify it first?", choices: [1, 2].map(i => ({ id: `$new:inspection-choice-${i}`, label: i === 1 ? "Record the attributed account" : "Ask for corroboration", destinationActId: "shared-route-pivot", routeId: null, conditions: [], consequences: ["The later review preserves the selected approach."] })) });

describe("PF-001 bounded collection editing", () => {
  it("lists 27 allowlisted schema-bearing append scopes, including empty arrays, without primitive/provenance authority", () => {
    const f = fixture(), all = []; for (let offset = 0;; offset += 50) { const p = f.call("list_edit_targets", { offset }); all.push(...p.items); if (offset + 50 >= p.total) break; }
    expect(all.filter(t => t.scope)).toHaveLength(27);
    expect(all.find(t => t.key === "collection:bible:contradictions").label).toContain("0/200");
    for (const key of ["collection:brief:contentBoundaries", "collection:creative-direction:fieldProvenance", "collection:bible:proseGuidance"]) expect(() => f.prepare([key])).toThrow("edit_target_not_found");
    const p = f.prepare(); expect(p.plan.targets[0].value.itemSchemaDefinition.properties.name).toBeDefined();
    expect(p.plan.targets[0].value.itemCount).toBe(20); expect(p.plan.contextBytes).toBeLessThan(64000); expect(Buffer.byteLength(sourceCanonicalJson(editMessages(p.plan)))).toBeLessThan(64000);
    expect(JSON.stringify(p.plan.context)).not.toContain("Specialist 20 follow-up");
  });
  it.each(["bible", "routes"])("keeps oversized %s root rejection atomic and provider-free", owner => {
    const f = fixture(), before = f.state(); expect(() => f.prepare([`${owner}:root`])).toThrow("edit_context_overflow_narrow_scope"); expect(f.state()).toEqual(before); expect(f.generate).not.toHaveBeenCalled();
  });
  it("keeps legacy IDs distinct from collection keys and rejects forged versioned descriptors", () => {
    const f = fixture(), v = f.artifacts.getCurrent<LongFormStoryBible>(f.id, "bible")!;
    f.longForm.saveArtifact(f.id, "bible", { ...v.content, characters: [...v.content.characters, { ...person, id: "collection:characters" }] });
    const memory = new AuthorMemoryRepository(f.db), entityPin = memory.createDecision({ projectId: f.id, scope: { kind: "entity", artifactId: "bible", entityKind: "character", entityId: "collection:characters" }, content: "This legacy character alone must keep its occupation." });
    const artifactPin = memory.createDecision({ projectId: f.id, scope: { kind: "artifact", artifactId: "bible" }, content: "Every Bible addition preserves attributed evidence." });
    const legacy = f.prepare(["bible:collection:characters"]); expect(legacy.plan.targets[0].scope).toBeUndefined(); expect(JSON.stringify(legacy.plan.context.memory)).toContain(entityPin.content);
    const p = f.prepare(), target = p.plan.targets[0], bible = f.longForm.snapshot(f.id).bible;
    expect(JSON.stringify(p.plan.context.memory)).not.toContain(entityPin.content); expect(JSON.stringify(p.plan.context.memory)).toContain(artifactPin.content);
    assertCollectionTarget(target, bible);
    for (const bad of [{ ...target, scope: { ...target.scope, version: 2 } }, { ...target, path: "/relationships" }, { ...target, value: { ...target.value, itemCount: 0 } }]) expect(() => assertCollectionTarget(bad as any, bible)).toThrow("edit_collection_scope_invalid");
  });
  it("retains the canonical collection maximum even though the prompt contains only a descriptor", () => {
    const f = fixture(), bible = f.longForm.snapshot(f.id).bible!;
    f.longForm.saveArtifact(f.id, "bible", { ...bible, characters: [...bible.characters, ...Array.from({ length: 180 }, (_, i) => ({ ...person, id: `additional-${i}`, name: `Additional witness ${i}` }))] });
    const p = f.prepare(), before = f.state(); expect(p.plan.targets[0].value.itemCount).toBe(200);
    expect(() => f.submit([add("collection:bible:characters", "characters", person)], p)).toThrow(); expect(f.state()).toEqual(before);
  });
  it("creates and separately edits a witness and relationship on >256KB Bible, preserving all other records and approvals", () => {
    const f = fixture(true), before = f.longForm.snapshot(f.id), bible = before.bible!;
    expect(Buffer.byteLength(JSON.stringify(bible))).toBeGreaterThan(256000);
    const p = f.prepare(["collection:bible:characters", "collection:bible:relationships", "bible:person-0"]);
    const submitted = f.submit([add("collection:bible:characters", "characters", person), add("collection:bible:relationships", "relationships", { id: "$new:witness-bond", characterIds: ["$new:witness", "person-0"], label: "Corroboration", currentState: "Trust depends on attribution.", plannedArc: "Resolve the disputed account." })], p);
    expect(f.longForm.snapshot(f.id)).toEqual(before);
    const { review } = f.apply(submitted.result.proposalId); expect(Buffer.byteLength(JSON.stringify(review))).toBeLessThan(256000);
    expect(review.outputs[0].after.addedRecords[0].name).toBe(person.name); expect(review.outputs[0].after.existingRecordsUnchanged).toBe(true);
    const now = f.longForm.snapshot(f.id); expect(now.bible!.characters.slice(0, -1)).toEqual(bible.characters); expect(now.bible!.relationships.slice(0, -1)).toEqual(bible.relationships);
    for (const key of Object.keys(bible).filter(k => !["characters", "relationships"].includes(k))) expect((now.bible as any)[key]).toEqual((bible as any)[key]);
    for (const owner of ["brief", "creative-direction", "routes", "endings", "mechanics"] as const) expect(now[owner]).toEqual(before[owner]);
    expect(f.workflow.get(f.id, "bible")).toMatchObject({ status: "draft" });
    const id = now.bible!.characters.at(-1)!.id, bondId = now.bible!.relationships.at(-1)!.id;
    f.apply(f.submit([{ targetKey: `bible:${id}`, kind: "set-fields", changes: { name: "Reviewed witness" } }, { targetKey: `bible:${bondId}`, kind: "set-fields", changes: { label: "Reviewed corroboration" } }], f.prepare([`bible:${id}`, `bible:${bondId}`])).result.proposalId);
    expect(f.longForm.snapshot(f.id).bible!.characters.slice(0, -1)).toEqual(bible.characters); f.edits.validateArchiveHistory(f.id); expect(f.generate).not.toHaveBeenCalled();
  });
  it("creates real decisions with fresh child IDs and edits both parent and child on >256KB routes", () => {
    const f = fixture(true), old = f.longForm.snapshot(f.id).routes!; expect(Buffer.byteLength(JSON.stringify(old))).toBeGreaterThan(256000);
    const s = f.submit([add("collection:routes:decisionPoints", "decisionPoints", decision())], f.prepare(["collection:routes:decisionPoints", "routes:shared-route-pivot"]));
    const p = f.call("get_edit", { proposalId: s.result.proposalId }); expect(Object.keys(p.proposal.generatedIds)).toHaveLength(3);
    const { review } = f.apply(s.result.proposalId); expect(review.outputs[0].after.addedRecords[0].choices).toHaveLength(2);
    const added = f.longForm.snapshot(f.id).routes!.decisionPoints.at(-1)!;
    f.apply(f.submit([{ targetKey: `routes:${added.id}`, kind: "set-fields", changes: { question: "Which attributed account is ready?" } }, { targetKey: `routes:${added.choices[0]!.id}`, kind: "set-fields", changes: { label: "Record verified testimony" } }], f.prepare([`routes:${added.id}`, `routes:${added.choices[0]!.id}`])).result.proposalId);
    expect(f.longForm.snapshot(f.id).routes!.decisionPoints.slice(0, -1)).toEqual(old.decisionPoints); f.edits.validateArchiveHistory(f.id);
  });
  it.each(["set-fields", "remove-item", "reorder-items", "wrong-collection"])("rejects collection authority misuse: %s", kind => {
    const f = fixture(), p = f.prepare(), before = f.state();
    const op = kind === "set-fields" ? { kind, targetKey: "collection:bible:characters", changes: { name: "Rewrite" } } : kind === "remove-item" ? { kind, targetKey: "collection:bible:characters" } : kind === "reorder-items" ? { kind, targetKey: "collection:bible:characters", collection: "characters", orderedIds: [] } : add("collection:bible:characters", "settings", person);
    expect(() => f.submit([op as any], p)).toThrow("edit_collection_operation_not_allowed"); expect(f.state()).toEqual(before);
  });
  it("supports the captured decision-and-seven-hooks selection as an explicit bounded creative batch", () => {
    const f = fixture(), old = f.longForm.snapshot(f.id).routes!, hooks = old.endingHooks;
    const p = f.prepare(["collection:routes:decisionPoints", "routes:decision-route-selection", ...hooks.map(h => `routes:${h.id}`)]);
    expect(Buffer.byteLength(sourceCanonicalJson(editMessages(p.plan)))).toBeLessThan(64000);
    const s = f.submit([add("collection:routes:decisionPoints", "decisionPoints", decision()), { targetKey: "routes:decision-route-selection", kind: "set-fields", changes: { question: "Which investigation commitment will be recorded?" } },
      ...hooks.map(h => ({ targetKey: `routes:${h.id}`, kind: "set-fields" as const, changes: { summary: `Reviewed attribution for ${h.label}.` } }))], p);
    const { review } = f.apply(s.result.proposalId); expect(review.outputs).toHaveLength(9); expect(review.outputs[0].after.existingRecordsUnchanged).toBe(false);
    const current = f.longForm.snapshot(f.id).routes!; expect(current.decisionPoints.slice(1, -1)).toEqual(old.decisionPoints.slice(1)); expect(current.acts).toEqual(old.acts); expect(current.routes).toEqual(old.routes); f.edits.validateArchiveHistory(f.id);
  });
  it.each(["unknown-person", "unknown-act", "literal-child", "duplicate-child", "unknown-logical", "extra-field"])("rejects invalid creation atomically: %s", attack => {
    const f = fixture(), p = f.prepare(["collection:bible:relationships", "collection:routes:decisionPoints"]), before = f.state();
    const item: any = decision(); if (attack === "unknown-act") item.actId = "absent-act"; if (attack === "literal-child") item.choices[0].id = "literal-new-id";
    if (attack === "duplicate-child") item.choices[1].id = item.choices[0].id; if (attack === "unknown-logical") item.choices[0].destinationActId = "$new:not-declared"; if (attack === "extra-field") item.extra = { id: "$new:untrusted" };
    const op = attack === "unknown-person" ? add("collection:bible:relationships", "relationships", { id: "$new:bond", characterIds: ["person-0", "absent-person"], label: "Invalid", currentState: "", plannedArc: "" }) : add("collection:routes:decisionPoints", "decisionPoints", item);
    expect(() => f.submit([op], p)).toThrow(); expect(f.state()).toEqual(before); expect(f.generate).not.toHaveBeenCalled();
  });
  it("requires the parent producer group when another group references a generated child", () => {
    const f = fixture(), p = f.prepare(["collection:routes:decisionPoints", "endings:ending-1"]);
    const groups: EditResponse["groups"] = [{ id: "parent", label: "Decision", explanation: "New decision", dependsOnGroupIds: [], operations: [add("collection:routes:decisionPoints", "decisionPoints", decision())] },
      { id: "dependent", label: "Link", explanation: "Preserve the concrete choice reference in planning notes", dependsOnGroupIds: [], operations: [{ kind: "set-fields", targetKey: "endings:ending-1", changes: { foreshadowing: ["$new:inspection-choice-1"] } }] }];
    const s = f.submit([], p, groups); expect(() => f.call("review_edit", { proposalId: s.result.proposalId, groupIds: ["dependent"] })).toThrow("edit_dependency_selection_incomplete");
  });
  it.each(["parent", "unrelated", "instructions"])("rejects stale submit after %s changes", kind => {
    const f = fixture(), p = f.prepare();
    if (kind === "instructions") { const settings = f.call("read_authoring_settings"), args = { expectedVersionId: settings.versionId, enabled: false }; const review = f.call("review_authoring_settings", args); f.call("apply_authoring_settings", { ...args, operationId: randomUUID(), fingerprint: review.fingerprint, approved: true }); }
    else { const owner = kind === "parent" ? "bible" : "routes", v = f.artifacts.getCurrent(f.id, owner)!; f.longForm.saveArtifact(f.id, owner, { ...v.content as object, title: "Changed through the canonical service" }); }
    const before = f.state(); expect(() => f.submit([add("collection:bible:characters", "characters", person)], p)).toThrow(/stale/); expect(f.state()).toEqual(before);
  });
  it("rejects stale review/Apply, stale target versions and stale heads without overwriting", () => {
    const f = fixture(), p = f.prepare(), submitted = f.submit([add("collection:bible:characters", "characters", person)], p);
    const review = f.call("review_edit", { proposalId: submitted.result.proposalId, groupIds: ["new"] });
    const v = f.artifacts.getCurrent(f.id, "bible")!; f.longForm.saveArtifact(f.id, "bible", { ...v.content as object, title: "New head" });
    const before = f.state(); expect(() => f.call("review_edit", { proposalId: submitted.result.proposalId, groupIds: ["new"] })).toThrow(/stale/);
    expect(() => f.call("apply_edit", { operationId: randomUUID(), proposalId: submitted.result.proposalId, groupIds: ["new"], fingerprint: review.fingerprint, approved: true })).toThrow(/stale/);
    expect(() => f.call("prepare_edit", { ...p.args, operationId: randomUUID(), headFingerprint: f.call("project_state").headFingerprint })).toThrow("edit_target_version_stale_repreview");
    expect(() => f.call("prepare_edit", { ...p.args, operationId: randomUUID() })).toThrow("edit_base_stale_repreview"); expect(f.state()).toEqual(before);
  });
  it.each(["enabled", "disabled", "legacy"])("retains exact custom instructions and approved Direction with guide %s", mode => {
    const f = fixture(false, ":memory:", mode === "legacy");
    const command = new CommandRepository(f.db).create({ scope: "project", projectId: f.id, name: "Project instruction", instruction: "Preserve attributed accounts exactly; do not invent a confession." });
    if (mode === "disabled") { const s = f.call("read_authoring_settings"), args = { expectedVersionId: s.versionId, enabled: false }; const r = f.call("review_authoring_settings", args); f.call("apply_authoring_settings", { ...args, fingerprint: r.fingerprint, operationId: randomUUID(), approved: true }); }
    const p = f.prepare(), settings = f.call("read_authoring_settings"); expect(p.plan.context.authoringInstructions).toEqual(settings.context);
    expect(p.plan.context.authoringInstructions.customInstructions.find((c: any) => c.id === command.id).instruction).toBe(command.instruction);
    expect(p.plan.context.authoringInstructions.enabled).toBe(mode === "enabled"); expect(p.plan.context.approvedDirection).not.toBeNull();
    expect(JSON.stringify(editMessages(p.plan))).toContain(command.instruction); if (mode !== "enabled") expect(p.plan.context.authoringInstructions.appliedGuide).toBeNull();
  });
  it("does not drop oversized required instructions to make a collection scope fit", () => {
    const f = fixture(); new CommandRepository(f.db).create({ scope: "project", projectId: f.id, name: "Long required notes", instruction: "Preserve all project-specific obligations. ".repeat(1800) });
    const before = f.state(); expect(() => f.prepare()).toThrow(/context_overflow/); expect(f.state()).toEqual(before); expect(f.generate).not.toHaveBeenCalled();
  });
  it.each(["visibleStats", "relationships", "flags", "resources"] as const)("preserves PF-003 ID/key authorization through %s collection scope", collection => {
    const f = fixture(), scale = { description: "Review state", minimum: 0, maximum: 10, initial: 0, increaseSignals: [], decreaseSignals: [] };
    const item = collection === "visibleStats" ? { ...scale, id: "$new:metric", key: "review_focus", label: "Review focus" } : collection === "relationships" ? { ...scale, id: "$new:metric", key: "review_trust", label: "Review trust", relationshipId: "bond-0", bands: [{ id: "$new:trust-band", minimum: 0, label: "Professional", meaning: "Trust depends on attribution." }] } : collection === "flags" ? { id: "$new:metric", key: "review_checked", label: "Checked", meaning: "The report was checked." } : { id: "$new:metric", key: "review_count", label: "Review count", kind: "counter", initial: 0, meaning: "Counts explicit reviews; not time, money or inventory." };
    const p = f.prepare([`collection:mechanics:${collection}`, "collection:mechanics:choiceEffectPlans"]);
    const s = f.submit([add(`collection:mechanics:${collection}`, collection, item), add("collection:mechanics:choiceEffectPlans", "choiceEffectPlans", { id: "$new:usage", label: "Review consequences", sourceDecisionIds: ["decision-route-selection"], mechanicKeys: [item.key], effectGuidance: ["Update this declared mechanic in the authored choice."] })], p);
    f.apply(s.result.proposalId); const current = f.longForm.snapshot(f.id).mechanics![collection].at(-1)!; expect(current.key).toBe(item.key);
    expect(() => f.submit([{ targetKey: `mechanics:${current.id}`, kind: "set-fields", changes: { key: "renamed_key" } }], f.prepare([`mechanics:${current.id}`]))).toThrow("edit_mechanic_key_rename_unsupported"); f.edits.validateArchiveHistory(f.id);
  });
  it.each(["resolve", "Bad Key", "_invalid"])("rejects duplicate or invalid semantic keys through collection scope: %s", key => {
    const f = fixture(), p = f.prepare(["collection:mechanics:flags"]), before = f.state();
    expect(() => f.submit([add("collection:mechanics:flags", "flags", { id: "$new:flag", key, label: "A flag", meaning: "Authored flag" })], p)).toThrow(); expect(f.state()).toEqual(before);
  });
  it("authorizes schema-defined condition IDs without declaring mechanic references", () => {
    const f = fixture(), p = f.prepare(["collection:mechanics:gates"]);
    const s = f.submit([add("collection:mechanics:gates", "gates", { id: "$new:gate", targetType: "route", targetId: "route-1", logic: "all", conditions: [{ id: "$new:condition", mechanicKey: "resolve", operator: "at-least", value: 0 }], rationale: "Declared test threshold", fallback: "Other authored approaches remain available." })], p);
    f.apply(s.result.proposalId); expect(f.longForm.snapshot(f.id).mechanics!.gates.at(-1)!.conditions[0]!.id).toMatch(/^a6_/); f.edits.validateArchiveHistory(f.id);
  });
  it("creates an ending with a fresh variant and required hook/budget changes in one validated batch", () => {
    const f = fixture(), before = f.longForm.snapshot(f.id), old = before.endings!.endings[0]!, route = before.routes!.routes[0]!, words = Math.floor(old.wordTarget / 2);
    const p = f.prepare(["collection:routes:endingHooks", `routes:${route.id}`, "collection:endings:endings", `endings:${old.id}`]);
    const s = f.submit([add("collection:routes:endingHooks", "endingHooks", { id: "$new:hook", label: "Independent review", routeId: route.id, type: old.type, summary: "An independently corroborated outcome." }),
      { targetKey: `routes:${route.id}`, kind: "set-fields", changes: { endingHookIds: [...route.endingHookIds, "$new:hook"] } },
      { targetKey: `endings:${old.id}`, kind: "set-fields", changes: { wordTarget: old.wordTarget - words } },
      add("collection:endings:endings", "endings", { ...old, id: "$new:ending", hookId: "$new:hook", wordTarget: words, title: "Independent review", variants: [{ id: "$new:variant", label: "Public attribution", requirements: [], differences: ["The public record identifies each source."] }] })], p);
    f.apply(s.result.proposalId); expect(f.longForm.snapshot(f.id).endings!.endings.at(-1)!.variants[0]!.id).toMatch(/^a6_/); f.edits.validateArchiveHistory(f.id);
  });
  it("creates scoped Direction through a collection and retains its separately approved override in later contexts", () => {
    const f = fixture(), s = f.submit([add("collection:creative-direction:scopedVariations", "scopedVariations", { id: "$new:direction", scopeKind: "character", scopeId: "person-0", toneDescriptors: ["restrained"], pacingGuidance: "Allow time for verification.", proseGuidance: "Preserve this person's uncertainty rather than inventing certainty." })], f.prepare(["collection:creative-direction:scopedVariations", "bible:person-0"]));
    f.apply(s.result.proposalId); const v = f.artifacts.getCurrent(f.id, "creative-direction")!;
    expect(f.workflow.get(f.id, "creative-direction")).toMatchObject({ status: "draft" }); f.longForm.approveArtifact(f.id, "creative-direction", v.id);
    const p = f.prepare(["collection:bible:characters", "bible:person-0"]); expect(JSON.stringify(p.plan.context.approvedDirection)).toContain("Preserve this person's uncertainty rather than inventing certainty."); f.edits.validateArchiveHistory(f.id);
  });
  it.each(["full-fidelity", "privacy-redacted"] as const)("round-trips collection history through %s archives and duplication", mode => {
    const f = fixture(), s = f.submit([add("collection:bible:characters", "characters", person)]); f.apply(s.result.proposalId);
    const publication = new PublicationExportService(new PortableProjectRepository(f.db), undefined), archive = publication.exportStudioPortable(f.id, mode), target = openDatabase();
    try { new PublicationExportService(new PortableProjectRepository(target), undefined).importPortable(archive.bytes); validatePortableAuthoringProject(target, f.id);
      const copy = new ProjectRepository(target).duplicate(f.id, "Investigation copy", validatePortableAuthoringProject); expect(new ArtifactRepository(target).getCurrent(copy.id, "bible")!.content).toEqual(f.longForm.snapshot(f.id).bible);
    } finally { target.close(); }
  });
  it("verifies a full backup and restores exact applied collection history", async () => {
    const f = fixture(), s = f.submit([add("collection:routes:decisionPoints", "decisionPoints", decision())], f.prepare(["collection:routes:decisionPoints"])); f.apply(s.result.proposalId);
    const portable = new PortableProjectRepository(f.db), publication = new PublicationExportService(portable, undefined), recovery = new RecoveryService(f.db, portable, publication, { applicationVersion: "PF001-test" });
    const backup = await recovery.createVerifiedBackup(f.id), target = openDatabase(), tp = new PortableProjectRepository(target), pub = new PublicationExportService(tp, undefined);
    try { await new RecoveryService(target, tp, pub, { applicationVersion: "PF001-test" }).restoreBackup(backup.bytes); validatePortableAuthoringProject(target, f.id); expect(new ArtifactRepository(target).getCurrent(f.id, "routes")!.content).toEqual(f.longForm.snapshot(f.id).routes); } finally { target.close(); }
  });
  it("safely retries exact envelopes, conflicts changed envelopes, rolls back failed receipts and can reject a proposal", () => {
    const f = fixture(), p = f.prepare(); expect(f.call("prepare_edit", p.args).plan).toEqual(p.plan);
    expect(() => f.call("prepare_edit", { ...p.args, message: "Changed request" })).toThrow("connected_operation_id_conflict");
    const s = f.submit([add("collection:bible:characters", "characters", person)], p); expect(f.call("submit_edit", s.args)).toEqual(s.result);
    const review = f.call("review_edit", { proposalId: s.result.proposalId, groupIds: ["new"] }), args = { operationId: randomUUID(), proposalId: s.result.proposalId, groupIds: ["new"], fingerprint: review.fingerprint, approved: true };
    const originalWrite = ArtifactRepository.prototype.saveArtifactInTransaction;
    const before = f.state(), write = vi.spyOn(ArtifactRepository.prototype, "saveArtifactInTransaction");
    write.mockImplementation(function (...input) { if (input[0].artifactType === "conversational-edit-application") throw new Error("forced audit write failure"); return originalWrite.apply(this, input); });
    expect(() => f.call("apply_edit", args)).toThrow("forced audit write failure"); write.mockRestore(); expect(f.state()).toEqual(before);
    const result = f.call("apply_edit", args); expect(f.call("apply_edit", args)).toEqual(result); expect(f.longForm.snapshot(f.id).bible!.characters.filter(x => x.name === person.name)).toHaveLength(1);
    const second = f.submit([add("collection:bible:characters", "characters", { ...person, id: "$new:second" })]); const head = f.longForm.snapshot(f.id);
    f.call("reject_edit", { operationId: randomUUID(), proposalId: second.result.proposalId }); expect(f.longForm.snapshot(f.id)).toEqual(head);
  });
});
