import { describe, expect, it } from "vitest";
import { planSourceAnalysis, sourceBinding, sourceUnitContext, resolveSourceEvidence, consolidateSourceDossier,
  correctSourceDossier, validateSourceOutput, SOURCE_ANALYSIS_POLICY, SourceDossierSchema, assertSourceDossierBudget, type SourceProvenance, type AnalysisSource } from "../src/index.js";

const source: AnalysisSource = { metadata: { sourceFormat: "txt" }, chapters: [{ id: "ch", title: "Chapter 1", order: 0,
  blocks: [{ type: "paragraph", excerptId: "ex", text: "Alex and Alexander met. Alex is twenty. He was twenty-one. Perhaps they are different people." }] }] };
function fixture() {
  const binding = sourceBinding("project", "source-v1", "scope-v1", source, ["ch"]);
  const plan = planSourceAnalysis(binding, source, "offline-source-analysis", "fixture");
  const evidence = plan.units[0]!.ranges;
  const original = (id: string, identityKey = id, field = "identity", claim = id, classification: "source-canon" | "inference" = "source-canon", references: string[] = []) => ({
    id, identityKey, field, claim, classification, references, evidence, category: "character" as const, aliases: [], uncertainty: "",
  });
  const observations = [original("alex", "Alex"), { ...original("alexander", "Alexander"), aliases: ["Alex"] },
    original("age-one", "Alex", "age", "Twenty", "source-canon", ["alex"]), original("age-two", "Alex", "age", "Twenty-one", "source-canon", ["alex"]),
    original("guess", "Alex", "motivation", "Afraid", "inference", ["alex"]), original("guess-two", "Alex", "motivation", "Afraid", "inference", ["alex"])];
  const provenance: SourceProvenance[] = observations.map((o) => ({ observationId: o.id, jobId: "job", unitId: plan.units[0]!.id, attemptId: "attempt", providerId: plan.providerId,
    modelId: plan.modelId, contextFingerprint: plan.units[0]!.contextFingerprint, original: o }));
  return { plan, evidence, observations, provenance, dossier: consolidateSourceDossier(plan, "job", provenance) };
}
describe("A3 deterministic analysis contracts", () => {
  it("preflights dense worst-case scope, accepts many full valid outputs and bounds final provenance/counts/bytes", () => {
    const large: AnalysisSource = { ...source, chapters: Array.from({ length: SOURCE_ANALYSIS_POLICY.maxUnits }, (_, i) => ({
      id: `ch_${i}`, order: i, title: `Chapter ${i}`, blocks: [{ type: "paragraph", excerptId: `ex_${i}`, text: "Exact source." }] })) };
    const binding = sourceBinding("project", "source-v1", "scope-v1", large, large.chapters.map((c) => c.id));
    const plan = planSourceAnalysis(binding, large, "offline-source-analysis", "fixture");
    const provenance = plan.units.flatMap((unit, index) => {
      const output = validateSourceOutput(large, plan, unit, { schemaVersion: 1, observations: Array.from({ length: 32 }, (_, i) => ({
        id: `obs_${index}_${i}`, category: "event", identityKey: `Event ${index}-${i}`, field: "result", claim: "Source fact. ".repeat(12),
        classification: "source-canon", aliases: [], references: [], evidence: unit.ranges, uncertainty: "" })) });
      return output.observations.map((original) => ({ observationId: original.id, jobId: "job", unitId: unit.id, attemptId: `attempt_${index}`,
        providerId: plan.providerId, modelId: plan.modelId, contextFingerprint: unit.contextFingerprint, original }));
    });
    const dossier = consolidateSourceDossier(plan, "job", provenance);
    expect(dossier.provenance).toHaveLength(SOURCE_ANALYSIS_POLICY.maxProvenance);
    expect(dossier.records).toHaveLength(SOURCE_ANALYSIS_POLICY.maxProvenance);
    expect(new TextEncoder().encode(JSON.stringify(dossier)).length).toBeLessThan(SOURCE_ANALYSIS_POLICY.maxDossierBytes);
    expect(() => consolidateSourceDossier(plan, "job", [...provenance, provenance[0]!])).toThrow(/provenance_budget/);
    const oversized = { ...large, chapters: [...large.chapters, { ...large.chapters[0]!, id: "overflow", order: large.chapters.length, blocks: [{ type: "paragraph" as const, excerptId: "overflow", text: "More source." }] }] };
    expect(() => planSourceAnalysis(sourceBinding("project", "v", "s", oversized, oversized.chapters.map((c) => c.id)), oversized, "offline-source-analysis", "fixture")).toThrow(/scope_budget.*fewer chapters/);
    expect(() => assertSourceDossierBudget({ ...dossier, records: Array(SOURCE_ANALYSIS_POLICY.maxRecords + 1).fill(dossier.records[0]) })).toThrow(/count_budget/);
    expect(() => assertSourceDossierBudget({ ...dossier, records: [{ text: "x".repeat(SOURCE_ANALYSIS_POLICY.maxDossierBytes) }] })).toThrow(/byte_budget/);
    expect(() => SourceDossierSchema.parse({ ...dossier, records: [{ ...dossier.records[0]!, aliases: Array(45_000).fill("z".repeat(1000)) }] })).toThrow(/byte_budget/);
    expect(() => SourceDossierSchema.parse({ ...dossier, corrections: Array(SOURCE_ANALYSIS_POLICY.maxCorrections + 1).fill({}) })).toThrow();
  }, 20_000);
  it("rejects oversized and exhausted corrections without changing original dossier history", () => {
    const f = fixture(), record = f.dossier.records[0]!;
    const operation = { kind: "field", intent: "source-analysis-correction", reason: "Source review", previousVersionId: "v1", recordId: record.id,
      changes: { claim: record.claim }, evidence: Array(200).fill(record.evidence[0]) };
    expect(() => correctSourceDossier(f.dossier, operation, source)).toThrow(/correction_byte_budget/);
    expect(() => correctSourceDossier({ ...f.dossier, corrections: Array(SOURCE_ANALYSIS_POLICY.maxCorrections).fill({}) }, operation, source)).toThrow(/correction_count_budget/);
    expect(f.dossier.corrections).toHaveLength(0);
  });
  it("plans deterministically, preserves every large block character and avoids surrogate splits", () => {
    const text = "A\u{1F600}e\u0301".repeat(9_000);
    const large = { ...source, chapters: [{ ...source.chapters[0]!, blocks: [{ type: "paragraph" as const, excerptId: "large", text }] }] };
    const binding = sourceBinding("project", "source-v1", "scope-v1", large, ["ch"]);
    const plan = planSourceAnalysis(binding, large, "offline-source-analysis", "fixture");
    expect(plan).toEqual(planSourceAnalysis(binding, large, "offline-source-analysis", "fixture"));
    expect(plan.units.length).toBeGreaterThan(10);
    expect(plan.units.map((u) => sourceUnitContext(large, binding, u).evidence.map((e) => e.text).join("")).join("")).toBe(text);
    expect(plan.units.every((u) => u.characters <= SOURCE_ANALYSIS_POLICY.maxSourceCharacters && u.contextBytes <= SOURCE_ANALYSIS_POLICY.maxContextBytes)).toBe(true);
  });
  it.each(["projectId", "sourceVersionId", "scopeVersionId", "chapterId", "excerptId", "digest"])("rejects invalid exact %s evidence", (key) => {
    const f = fixture();
    expect(() => resolveSourceEvidence(source, f.plan.binding, { ...f.evidence[0]!, [key]: "bad" })).toThrow();
  });
  it("rejects reversed/outside evidence, no evidence, unknown references, duplicate IDs and extra adaptation keys", () => {
    const f = fixture(), unit = f.plan.units[0]!;
    const parse = (observations: unknown[]) => validateSourceOutput(source, f.plan, unit, { schemaVersion: 1, observations });
    expect(() => parse([{ ...f.observations[0], evidence: [{ ...f.evidence[0], start: 8, end: 2 }] }])).toThrow();
    expect(() => parse([{ ...f.observations[0], evidence: [{ ...f.evidence[0], end: 999 }] }])).toThrow();
    expect(() => parse([{ ...f.observations[0], evidence: [] }])).toThrow();
    expect(() => parse([{ ...f.observations[0], references: ["none"] }])).toThrow(/orphan/);
    expect(() => parse([f.observations[0], f.observations[0]])).toThrow(/duplicate/);
    expect(() => parse([{ ...f.observations[0], authorOverride: "make them lovers" }])).toThrow();
  });
  it("is completion-order independent, retains inference, separates aliases and preserves conflicting facts", () => {
    const f = fixture();
    expect(consolidateSourceDossier(f.plan, "job", [...f.provenance].reverse())).toEqual(f.dossier);
    expect(f.dossier.records.filter((r) => r.field === "motivation")).toHaveLength(1);
    expect(f.dossier.records.find((r) => r.field === "motivation")?.classification).toBe("inference");
    expect(f.dossier.conflicts.map((c) => c.kind)).toContain("ambiguity");
    expect(f.dossier.conflicts.map((c) => c.kind)).toContain("contradiction");
  });
  it("merges identities with every dependent remapped, then requires complete evidence/dependent assignments for splitting", () => {
    const f = fixture(), originals = f.dossier.records.filter((r) => r.field === "identity");
    const merged = correctSourceDossier(f.dossier, { kind: "merge", intent: "source-analysis-correction", reason: "Same person", previousVersionId: "v1", recordIds: originals.map((r) => r.id), targetId: originals[0]!.id }, source);
    expect(merged.records.filter((r) => r.status === "supported" && r.field === "identity")).toHaveLength(1);
    expect(merged.records.flatMap((r) => r.references)).not.toContain(originals[1]!.id);
    const parent = merged.records.find((r) => r.id === originals[0]!.id)!;
    const children = [{ id: "new-alex", identityKey: "Alex", claim: "Alex", evidence: parent.evidence }, { id: "new-alexander", identityKey: "Alexander", claim: "Alexander", evidence: parent.evidence }];
    const operation = { kind: "split", intent: "source-analysis-correction", reason: "Separate people", previousVersionId: "v2", recordId: parent.id, children, assignments: [] };
    expect(() => correctSourceDossier(merged, operation, source)).toThrow(/assignment/);
    const assignments = merged.records.filter((r) => r.references.includes(parent.id)).map((r) => ({ recordId: r.id, replacementIds: ["new-alex"] }));
    const split = correctSourceDossier(merged, { ...operation, assignments }, source);
    expect(split.records.flatMap((r) => r.references)).not.toContain(parent.id);
    expect(split.provenance).toEqual(f.dossier.provenance);
    expect(split.corrections).toHaveLength(2);
  });
  it("requires evidence for field, classification and evidence repair; rejection keeps the audit", () => {
    const f = fixture(), record = f.dossier.records[0]!;
    const common = { intent: "source-analysis-correction", reason: "Correct analysis", previousVersionId: "v1", recordId: record.id };
    for (const kind of ["field", "classification", "evidence"]) expect(() => correctSourceDossier(f.dossier, { ...common, kind, changes: {}, classification: "source-canon", evidence: [] }, source)).toThrow();
    const corrected = correctSourceDossier(f.dossier, { ...common, kind: "field", changes: { claim: "Direct source identity" }, evidence: record.evidence }, source);
    expect(corrected.records.find((r) => r.id === record.id)?.claim).toBe("Direct source identity");
    const rejected = correctSourceDossier(f.dossier, { ...common, kind: "reject" }, source);
    expect(rejected.records.find((r) => r.id === record.id)?.status).toBe("rejected");
    expect(rejected.provenance).toEqual(f.dossier.provenance);
  });
});
