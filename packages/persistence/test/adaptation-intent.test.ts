import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdaptationIntentSchema, adaptationIntentFingerprints, applyAdaptationOperations, newAdaptationIntent, normalizeAdaptationIntent, sourceCanonicalJson, sourceDigest, type AdaptationIntent, type AdaptationProposal, type SourceDossier } from "@story-to-cyoa/domain";
import { ArtifactRepository, ChangeSetRepository, ConversationRepository, PortableProjectRepository, WorkflowRepository, adaptationSuggestionContext, assertAdaptationMutationScope, openDatabase, validateAdaptationDatabase, type StoryDatabase } from "../src/index.js";
import { analysisFixture } from "./source-analysis-fixture.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

export function intentFixture(approved = true, category: SourceDossier["records"][number]["category"] = "event", database: StoryDatabase = openDatabase()) {
  const fixture = analysisFixture(database, { metadata: { title: "Harbor", sourceFormat: "txt" }, chapters: [{ id: "chapter", title: "Finale", order: 0, blocks: [{ type: "paragraph", excerptId: "collapse", text: "Ren dies during the harbor collapse. Mira leaves the harbor at the ending." }] }] });
  const job = fixture.repository.createJob(fixture.projectId, fixture.plan.id, fixture.plan.fingerprint);
  for (const unit of fixture.plan.units) {
    const attempt = fixture.repository.beginAttempt(fixture.projectId, job.id, unit.id);
    fixture.repository.finishAttempt(fixture.projectId, job.id, unit.id, attempt.id, { status: "completed", output: { schemaVersion: 1, observations: [{ id: "death", category, identityKey: "Harbor collapse", field: "outcome", claim: "Ren dies during the harbor collapse.", classification: "source-canon", aliases: [], references: [], evidence: [unit.ranges[0]!], uncertainty: "" }] } });
  }
  fixture.repository.settle(fixture.projectId, job.id);
  const workflow = new WorkflowRepository(fixture.database);
  const dossier = fixture.artifacts.getCurrent<SourceDossier>(fixture.projectId, "source-dossier")!;
  if (approved) workflow.approve(fixture.projectId, "source-dossier", dossier.id);
  const intent = newAdaptationIntent(fixture.projectId, { dossierVersionId: dossier.id, dossierMaterialFingerprint: dossier.content.materialFingerprint, source: dossier.content.binding });
  return { ...fixture, workflow, dossier, intent, save: (content: AdaptationIntent) => fixture.artifacts.saveArtifact({ projectId: fixture.projectId, artifactId: "adaptation-intent", content }) };
}
describe("Adaptation Intent persistence authority", () => {
  it.each([["ending", "turning-point"], ["reveal", "unresolved-thread"], ["world", "world-fact"]] as const)("accepts requested %s targeting an actual A3 %s record", (kind, category) => {
    const f = intentFixture(true, category), record = f.dossier.content.records[0]!;
    const version = f.save(normalizeAdaptationIntent({ ...f.intent, obligations: [{ id: "requested", status: "requested", kind,
      targetIds: [record.id], evidence: record.evidence, requirement: "Retain this source commitment", strength: "required", transformations: [],
      scope: "project", rationale: "Author request", provenance: { origin: "manual", projectId: f.projectId } }] }));
    f.workflow.approve(f.projectId, "adaptation-intent", version.id); expect(version.content.obligations[0]?.kind).toBe(kind); f.database.close();
  });
  it.each(["effect", "requirement", "permission", "description", "rationale"])("rejects achieved claims in durable %s at write and portable-import boundaries", (field) => {
    const f = intentFixture(), record = f.dossier.content.records[0]!, common = { scope: "project", rationale: "Author request", provenance: { origin: "manual" as const, projectId: f.projectId } };
    const valid = normalizeAdaptationIntent({ ...f.intent,
      overrides: [{ ...common, id: "override", authority: "author-override", targetIds: [record.id], aspect: "state", effect: "Survives", active: true, reviewed: true }],
      obligations: [{ ...common, id: "obligation", status: "requested", kind: "ending", targetIds: [record.id], evidence: record.evidence, requirement: "Retain the ending", strength: "required", transformations: [] }],
      exceptions: [{ ...common, id: "exception", obligationId: "obligation", targetIds: [record.id], evidence: record.evidence, permission: "Compress delivery", reviewed: true }],
      inventions: [{ ...common, id: "invention", origin: "adaptation-only", kind: "scene", description: "New scene", dependencyIds: [] }],
    });
    f.save(valid); const bundle = new PortableProjectRepository(f.database).exportRows(f.projectId), invalid = structuredClone(valid);
    if (field === "effect") invalid.overrides[0]!.effect = "Canon route achieved";
    if (field === "requirement") invalid.obligations[0]!.requirement = "Source ending preserved";
    if (field === "permission") invalid.exceptions[0]!.permission = "Route is reachable";
    if (field === "description") invalid.inventions[0]!.description = "Canon preservation verified";
    if (field === "rationale") invalid.expansion = [{ ...common, id: "expansion", origin: "branching", description: "New branches", rationale: "The ending has been preserved", sourceRecordIds: [], overrideIds: [], inventionIds: [], dependencyIds: [], allocation: { kind: "unknown" } }];
    Object.assign(invalid, adaptationIntentFingerprints(invalid));
    expect(() => f.save(invalid)).toThrow("adaptation_achieved_claim_forbidden");
    bundle.tables.artifact_versions.find((row) => row.artifact_id === "adaptation-intent")!.content_json = JSON.stringify(invalid);
    const target = openDatabase(); expect(() => new PortableProjectRepository(target).importRows(bundle, validateAdaptationDatabase)).toThrow("adaptation_achieved_claim_forbidden");
    expect(target.prepare("SELECT id FROM projects").all()).toEqual([]); expect(f.artifacts.listVersions(f.projectId, "adaptation-intent")).toHaveLength(1);
    target.close(); f.database.close();
  });
  it.each(["overwrite", "remove"])("rejects unseen invention %s in direct writes, stored-history validation and atomic import", (kind) => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-a4-scope-")); directories.push(directory); const path = join(directory, "project.sqlite");
    const f = intentFixture(true, "event", openDatabase(path)), invention = { id: "unseen", scope: "project", rationale: "Author request", origin: "adaptation-only" as const, kind: "scene" as const, description: "Original scene", dependencyIds: [] };
    const base = f.save(normalizeAdaptationIntent({ ...f.intent, inventions: [{ ...invention, provenance: { origin: "manual", projectId: f.projectId } }] }));
    const input = { request: "Adjust tone", recordIds: [f.dossier.content.records[0]!.id], providerId: "offline-adaptation-intent", modelId: "offline-a4-v1" };
    const context = adaptationSuggestionContext(f.database, f.projectId, f.intent.binding, base.id, input);
    const validSuggestion = { schemaVersion: 1 as const, intent: "adaptation-preference" as const, operations: [{ kind: "dimension" as const, dimension: "tone" as const, level: "strict" as const }] };
    const suggestion: AdaptationProposal["suggestion"] = { ...validSuggestion, operations: kind === "remove" ? [{ kind: "remove", collection: "inventions", id: invention.id }] : [{ kind: "invention", value: { ...invention, description: "Replacement scene" } }] };
    const proposal = (suggestion: AdaptationProposal["suggestion"]): AdaptationProposal => ({ schemaId: "adaptation-intent-proposal", schemaVersion: 1,
      projectId: f.projectId, baseVersionId: base.id, input, binding: f.intent.binding, contextFingerprint: context.fingerprint, promptVersion: "adaptation-intent-v1",
      suggestion, candidate: normalizeAdaptationIntent({ ...applyAdaptationOperations(base.content, suggestion, sourceDigest(input.request)), revision: { kind: "proposal", previousVersionId: base.id, requestDigest: sourceDigest(input.request) } }), status: "pending", appliedVersionId: null });
    const hostile = proposal(suggestion), artifactId = "adaptation-intent-proposal-scope";
    expect(() => f.artifacts.saveArtifact({ projectId: f.projectId, artifactId, artifactType: "adaptation-intent-proposal", content: hostile })).toThrow("adaptation_mutation_scope_invalid");
    const saved = f.artifacts.saveArtifact({ projectId: f.projectId, artifactId, artifactType: "adaptation-intent-proposal", content: proposal(validSuggestion) });
    const bundle = new PortableProjectRepository(f.database).exportRows(f.projectId);
    bundle.tables.artifact_versions.find((row) => row.id === saved.id)!.content_json = JSON.stringify(hostile);
    const target = openDatabase(); expect(() => new PortableProjectRepository(target).importRows(bundle, validateAdaptationDatabase)).toThrow("adaptation_mutation_scope_invalid");
    expect(target.prepare("SELECT id FROM projects").all()).toEqual([]); target.close();
    f.database.prepare("UPDATE artifact_versions SET content_json = ? WHERE id = ?").run(JSON.stringify(hostile), saved.id);
    expect(() => validateAdaptationDatabase(f.database)).toThrow("adaptation_mutation_scope_invalid"); f.database.close();
    expect(() => openDatabase(path)).toThrow(expect.objectContaining({ cause: expect.objectContaining({ message: "adaptation_mutation_scope_invalid" }) }));
  });
  it("permits previewed-item edits and new IDs, but not cross-collection collisions or unseen references", () => {
    const f = intentFixture(), record = f.dossier.content.records[0]!, value = { id: "visible", authority: "author-override" as const, targetIds: [record.id], aspect: "state", effect: "Survives", scope: "project", rationale: "Author request", active: true, reviewed: true };
    const base = f.save(normalizeAdaptationIntent({ ...f.intent, overrides: [{ ...value, provenance: { origin: "manual", projectId: f.projectId } }] }));
    const context = adaptationSuggestionContext(f.database, f.projectId, f.intent.binding, base.id, { request: "Adjust", recordIds: [record.id], providerId: "offline", modelId: "fixture" });
    const suggestion = (operations: AdaptationProposal["suggestion"]["operations"]): AdaptationProposal["suggestion"] => ({ schemaVersion: 1, intent: "adaptation-preference", operations });
    for (const operations of [[{ kind: "override" as const, value: { ...value, effect: "Leaves" } }], [{ kind: "remove" as const, collection: "overrides" as const, id: value.id }], [{ kind: "invention" as const, value: { id: "new", origin: "adaptation-only" as const, kind: "scene" as const, scope: "project", rationale: "Requested", description: "New scene", dependencyIds: [value.id] } }]]) {
      expect(() => assertAdaptationMutationScope(base.content, suggestion(operations), context.mutationScope)).not.toThrow();
    }
    expect(() => assertAdaptationMutationScope(base.content, suggestion([{ kind: "invention", value: { id: value.id, origin: "adaptation-only", kind: "scene", scope: "project", rationale: "Requested", description: "New scene", dependencyIds: [] } }]), context.mutationScope)).toThrow("adaptation_mutation_scope_invalid");
    expect(() => assertAdaptationMutationScope(base.content, suggestion([{ kind: "invention", value: { id: "new", origin: "adaptation-only", kind: "scene", scope: "project", rationale: "Requested", description: "New scene", dependencyIds: ["unseen"] } }]), context.mutationScope)).toThrow("adaptation_mutation_scope_invalid");
    f.database.close();
  });
  it("prevents generic change-set application from bypassing the reviewed A4 boundary", () => {
    const f = intentFixture(), first = f.save(f.intent), changes = new ChangeSetRepository(f.database);
    const conversation = new ConversationRepository(f.database).create(f.projectId, { kind: "project", projectId: f.projectId });
    const candidate = normalizeAdaptationIntent({ ...f.intent, revision: { kind: "manual", previousVersionId: first.id } });
    const proposal = changes.create({ projectId: f.projectId, conversationId: conversation.id, artifactId: "adaptation-intent", baseVersionId: first.id, candidate, summary: "Intent", rationale: "Test boundary" });
    expect(() => changes.apply(proposal.id, AdaptationIntentSchema)).toThrow("adaptation_use_reviewed_proposal_apply");
    expect(() => changes.applyPrepared(proposal.id, candidate, AdaptationIntentSchema)).toThrow("adaptation_use_reviewed_proposal_apply");
    expect(() => f.artifacts.saveArtifact({ projectId: f.projectId, artifactId: "adaptation-intent-proposal-fake", artifactType: "bible", content: candidate })).toThrow("adaptation_proposal_identity_invalid");
    expect(f.artifacts.listVersions(f.projectId, "adaptation-intent")).toHaveLength(1); f.database.close();
  });
  it("creates, reviews and approves with NO Creative Direction or generated foundations", () => {
    const f = intentFixture(); const before = f.database.prepare("SELECT COUNT(*) n FROM artifact_versions").get() as { n: number };
    const version = f.save(f.intent); f.workflow.markReviewed(f.projectId, "adaptation-intent", version.id); f.workflow.approve(f.projectId, "adaptation-intent", version.id);
    expect(f.workflow.get(f.projectId, "adaptation-intent").status).toBe("approved");
    for (const id of ["creative-direction", "brief", "bible", "routes", "endings", "mechanics"]) expect(f.artifacts.getCurrent(f.projectId, id)).toBeUndefined();
    expect((f.database.prepare("SELECT COUNT(*) n FROM artifact_versions").get() as { n: number }).n).toBe(before.n + 1); f.database.close();
  });
  it("adds and removes deliberate divergence without changing any dossier bytes or creating a correction", () => {
    const f = intentFixture(), record = f.dossier.content.records[0]!;
    const sourceBefore = sourceCanonicalJson(f.dossier.content);
    const override = { id: "alive", authority: "author-override" as const, targetIds: [record.id], aspect: "survival", effect: "Ren survives", scope: "project", rationale: "Keep Ren available", active: true, reviewed: true, provenance: { origin: "manual" as const, projectId: f.projectId } };
    const first = f.save(normalizeAdaptationIntent({ ...f.intent, overrides: [override] }));
    const removed = f.save(normalizeAdaptationIntent({ ...first.content, overrides: [], revision: { kind: "manual", previousVersionId: first.id } }));
    expect(removed.content.overrides).toEqual([]); expect(sourceCanonicalJson(f.artifacts.getVersion(f.dossier.id)!.content)).toBe(sourceBefore);
    expect(f.artifacts.listVersions(f.projectId, "source-dossier")).toHaveLength(1); f.database.close();
  });
  it.each(["foreign-dossier", "unapproved", "stale", "foreign-target", "rejected-target", "foreign-provenance", "bad-base", "bad-fingerprint"])("rejects %s atomically at the direct persistence boundary", (kind) => {
    const f = intentFixture(kind !== "unapproved"); let intent = structuredClone(f.intent);
    if (kind === "foreign-dossier") intent.binding.dossierVersionId = "foreign";
    if (kind === "stale") f.artifacts.markCurrentStale(f.projectId, "source-dossier");
    if (kind === "rejected-target") {
      const rejected = f.repository.correct(f.projectId, f.dossier.id, { kind: "reject", intent: "source-analysis-correction", reason: "Unsupported source claim", previousVersionId: f.dossier.id, recordId: f.dossier.content.records[0]!.id });
      f.workflow.approve(f.projectId, "source-dossier", rejected.id);
      intent.binding = { dossierVersionId: rejected.id, dossierMaterialFingerprint: rejected.content.materialFingerprint, source: rejected.content.binding };
    }
    if (["foreign-target", "rejected-target"].includes(kind)) intent.overrides = [{ id: "x", authority: "author-override", targetIds: [kind === "rejected-target" ? f.dossier.content.records[0]!.id : "missing"], aspect: "state", effect: "Survives", scope: "project", rationale: "Author intent", active: true, reviewed: true, provenance: { origin: "manual", projectId: f.projectId } }];
    if (kind === "foreign-provenance") intent.overrides = [{ id: "x", authority: "author-override", targetIds: [f.dossier.content.records[0]!.id], aspect: "state", effect: "Survives", scope: "project", rationale: "Author intent", active: true, reviewed: true, provenance: { origin: "manual", projectId: "foreign" } }];
    if (kind === "bad-base") intent.revision.previousVersionId = "missing";
    if (kind !== "foreign-provenance") intent = normalizeAdaptationIntent(intent);
    if (kind === "bad-fingerprint") intent.materialFingerprint = "a".repeat(64);
    expect(() => f.save(intent)).toThrow(); expect(f.artifacts.getCurrent(f.projectId, "adaptation-intent")).toBeUndefined(); f.database.close();
  });
  it("rejects fabricated obligations and orphan exceptions; preserves ending evidence and reviewed exceptions", () => {
    const f = intentFixture(), record = f.dossier.content.records[0]!, evidence = [record.evidence[0]!];
    const obligation = { id: "ending", status: "requested" as const, kind: "ending" as const, targetIds: [record.id], evidence, requirement: "Retain the final character state", scope: "project", strength: "required" as const, transformations: ["change-delivery" as const], rationale: "Requested ending", provenance: { origin: "manual" as const, projectId: f.projectId } };
    const exception = { id: "exception", obligationId: obligation.id, targetIds: obligation.targetIds, evidence, permission: "Reveal indirectly", reviewed: true, scope: "project", rationale: "Alternative delivery", provenance: obligation.provenance };
    expect(() => f.save(normalizeAdaptationIntent({ ...f.intent, obligations: [{ ...obligation, targetIds: ["fabricated"] }] }))).toThrow();
    expect(() => normalizeAdaptationIntent({ ...f.intent, exceptions: [exception] })).toThrow();
    const version = f.save(normalizeAdaptationIntent({ ...f.intent, endingIntent: "preserve-result-alter-mechanism", preserveCanonRoute: true, obligations: [obligation], exceptions: [exception] }));
    f.workflow.approve(f.projectId, "adaptation-intent", version.id); expect(version.content.obligations[0]?.evidence).toEqual(evidence); f.database.close();
  });
  it("marks dependency stale but keeps historical intent readable; stale approvals and restores reject", () => {
    const f = intentFixture(), first = f.save(f.intent); f.workflow.approve(f.projectId, "adaptation-intent", first.id);
    f.artifacts.restore(f.projectId, "source-dossier", f.dossier.id);
    expect(f.artifacts.getCurrent(f.projectId, "adaptation-intent")!.stale).toBe(true);
    expect(f.workflow.get(f.projectId, "adaptation-intent").status).toBe("stale");
    expect(f.artifacts.getVersion(first.id)).toBeDefined(); expect(() => f.workflow.approve(f.projectId, "adaptation-intent", first.id)).toThrow();
    expect(() => f.artifacts.restore(f.projectId, "adaptation-intent", first.id)).toThrow(); f.database.close();
  });
  it("restore creates a new current draft with exact immutable revision lineage", () => {
    const f = intentFixture(), first = f.save(f.intent);
    const second = f.save(normalizeAdaptationIntent({ ...f.intent, preset: null, dimensions: { ...f.intent.dimensions, tone: "strict" }, revision: { kind: "manual", previousVersionId: first.id } }));
    f.workflow.approve(f.projectId, "adaptation-intent", second.id);
    const restored = f.artifacts.restore<AdaptationIntent>(f.projectId, "adaptation-intent", first.id);
    expect(restored.content.dimensions).toEqual(first.content.dimensions); expect(restored.content.revision).toEqual({ kind: "restore", previousVersionId: second.id, restoredFromVersionId: first.id });
    expect(f.workflow.get(f.projectId, "adaptation-intent").status).toBe("draft"); validateAdaptationDatabase(f.database); f.database.close();
  });
  it("requires explicit budget discrepancy review without inflating target", () => {
    const f = intentFixture(); const first = f.save(normalizeAdaptationIntent({ ...f.intent, budget: { sourceEquivalent: { kind: "known", words: 30_000 }, target: { kind: "estimated", words: 80_000 }, discrepancyReviewed: false } }));
    expect(() => f.workflow.approve(f.projectId, "adaptation-intent", first.id)).toThrow("adaptation_budget_review_required");
    const second = f.save(normalizeAdaptationIntent({ ...first.content, budget: { ...first.content.budget, discrepancyReviewed: true }, revision: { kind: "manual", previousVersionId: first.id } }));
    expect(() => f.workflow.approve(f.projectId, "adaptation-intent", second.id)).not.toThrow(); expect(second.content.budget.target).toEqual({ kind: "estimated", words: 80_000 }); f.database.close();
  });
  it("duplicates/remaps all categories, dependencies and approvals; original deletion does not break the copy", () => {
    const f = intentFixture(), record = f.dossier.content.records[0]!, provenance = { origin: "manual" as const, projectId: f.projectId }, common = { scope: "project", rationale: "Explicit intent", provenance };
    const first = f.save(normalizeAdaptationIntent({ ...f.intent,
      overrides: [{ ...common, id: "override", authority: "author-override", targetIds: [record.id], aspect: "state", effect: "Survives", active: true, reviewed: true }],
      inventions: [{ ...common, id: "invention", origin: "adaptation-only", kind: "scene", description: "New event", dependencyIds: ["override"] }],
      obligations: [{ ...common, id: "obligation", status: "requested", kind: "event", targetIds: [record.id], evidence: [record.evidence[0]!], requirement: "Keep the source event", strength: "required", transformations: ["compress"] }],
      exceptions: [{ ...common, id: "exception", obligationId: "obligation", targetIds: [record.id], evidence: [record.evidence[0]!], permission: "Compress delivery", reviewed: true }],
      expansion: [{ ...common, id: "expansion", origin: "adaptation-only", description: "New scenes", sourceRecordIds: [], overrideIds: [], inventionIds: ["invention"], dependencyIds: ["invention"], allocation: { kind: "unknown" } }] }));
    f.workflow.approve(f.projectId, "adaptation-intent", first.id); f.artifacts.restore(f.projectId, "adaptation-intent", first.id);
    const copy = f.projects.duplicate(f.projectId); f.projects.remove(f.projectId);
    validateAdaptationDatabase(f.database, copy.id); const copied = f.artifacts.getCurrent<AdaptationIntent>(copy.id, "adaptation-intent")!;
    expect(copied.content.projectId).toBe(copy.id); expect(copied.content.overrides[0]!.id).not.toBe("override");
    expect(copied.content.inventions[0]!.dependencyIds).toEqual([copied.content.overrides[0]!.id]);
    expect(copied.content.expansion[0]!.inventionIds).toEqual([copied.content.inventions[0]!.id]);
    expect(copied.content.exceptions[0]!.obligationId).toBe(copied.content.obligations[0]!.id); f.database.close();
  });
  it("portable round-trip validates complete history and rejects malformed archives atomically", () => {
    const f = intentFixture(); f.save(f.intent); const portable = new PortableProjectRepository(f.database), bundle = portable.exportRows(f.projectId);
    const target = openDatabase(), importer = new PortableProjectRepository(target); importer.importRows(bundle, validateAdaptationDatabase);
    expect(new ArtifactRepository(target).getCurrent(f.projectId, "adaptation-intent")!.content).toEqual(f.intent);
    target.close(); const malformed = structuredClone(bundle);
    const row = malformed.tables.artifact_versions.find((r) => r.artifact_id === "adaptation-intent")!;
    const intent = JSON.parse(row.content_json as string) as AdaptationIntent; intent.binding.dossierVersionId = "foreign";
    row.content_json = JSON.stringify(normalizeAdaptationIntent(intent));
    const rejected = openDatabase(); expect(() => new PortableProjectRepository(rejected).importRows(malformed, validateAdaptationDatabase)).toThrow();
    expect(rejected.prepare("SELECT id FROM projects").all()).toEqual([]); rejected.close(); f.database.close();
  });
});
