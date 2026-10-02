import { describe, expect, it } from "vitest";
import { newAdaptationIntent, normalizeAdaptationIntent, sourceCanonicalJson, type AdaptationIntent, type SourceDossier } from "@story-to-cyoa/domain";
import { ArtifactRepository, PortableProjectRepository, WorkflowRepository, openDatabase, validateAdaptationDatabase } from "../src/index.js";
import { analysisFixture } from "./source-analysis-fixture.js";

export function intentFixture(approved = true) {
  const fixture = analysisFixture(openDatabase(), { metadata: { title: "Harbor", sourceFormat: "txt" }, chapters: [{ id: "chapter", title: "Finale", order: 0, blocks: [{ type: "paragraph", excerptId: "collapse", text: "Ren dies during the harbor collapse. Mira leaves the harbor at the ending." }] }] });
  const job = fixture.repository.createJob(fixture.projectId, fixture.plan.id, fixture.plan.fingerprint);
  for (const unit of fixture.plan.units) {
    const attempt = fixture.repository.beginAttempt(fixture.projectId, job.id, unit.id);
    fixture.repository.finishAttempt(fixture.projectId, job.id, unit.id, attempt.id, { status: "completed", output: { schemaVersion: 1, observations: [{ id: "death", category: "event", identityKey: "Harbor collapse", field: "outcome", claim: "Ren dies during the harbor collapse.", classification: "source-canon", aliases: [], references: [], evidence: [unit.ranges[0]!], uncertainty: "" }] } });
  }
  fixture.repository.settle(fixture.projectId, job.id);
  const workflow = new WorkflowRepository(fixture.database);
  const dossier = fixture.artifacts.getCurrent<SourceDossier>(fixture.projectId, "source-dossier")!;
  if (approved) workflow.approve(fixture.projectId, "source-dossier", dossier.id);
  const intent = newAdaptationIntent(fixture.projectId, { dossierVersionId: dossier.id, dossierMaterialFingerprint: dossier.content.materialFingerprint, source: dossier.content.binding });
  return { ...fixture, workflow, dossier, intent, save: (content: AdaptationIntent) => fixture.artifacts.saveArtifact({ projectId: fixture.projectId, artifactId: "adaptation-intent", content }) };
}
describe("Adaptation Intent persistence authority", () => {
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
    if (["foreign-target", "rejected-target"].includes(kind)) intent.overrides = [{ id: "x", authority: "author-override", targetIds: ["missing"], aspect: "state", effect: "Survives", scope: "project", rationale: "Author intent", active: true, reviewed: true, provenance: { origin: "manual", projectId: f.projectId } }];
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
