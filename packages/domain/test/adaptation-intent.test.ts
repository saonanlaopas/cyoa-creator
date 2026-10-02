import { describe, expect, it } from "vitest";
import { AdaptationIntentSchema, AdaptationSuggestionSchema, FIDELITY_PRESETS, adaptationBudget, adaptationIntentFingerprints, adaptationOverrideConflicts,
  applyAdaptationOperations, assertRequestedSemantics, expandFidelityPreset, newAdaptationIntent, normalizeAdaptationIntent, sourceDigest } from "../src/index.js";

const binding = { dossierVersionId: "dossier", dossierMaterialFingerprint: "a".repeat(64), source: { projectId: "project", sourceVersionId: "source", sourceFingerprint: "b".repeat(64), scopeVersionId: "scope", scopeFingerprint: "c".repeat(64), chapterIds: ["ch"] } };
const base = () => newAdaptationIntent("project", binding);
const common = { scope: "project", rationale: "Author requested", provenance: { origin: "manual" as const, projectId: "project" } };
const override = (id: string, effect: string) => ({ ...common, id, authority: "author-override" as const, targetIds: ["record"], aspect: "survival", effect, active: true, reviewed: true });
describe("Adaptation Intent policy contracts", () => {
  it.each(FIDELITY_PRESETS)("expands %s deterministically into self-describing dimensions", (preset) => {
    const a = newAdaptationIntent("project", binding, preset), b = newAdaptationIntent("project", binding, preset);
    expect(a.dimensions).toEqual(expandFidelityPreset(preset)); expect(a.materialFingerprint).toBe(b.materialFingerprint);
    const edited = normalizeAdaptationIntent({ ...a, preset: null, dimensions: { ...a.dimensions, character: "strict" } });
    expect(edited.materialFingerprint).not.toBe(a.materialFingerprint);
  });
  it("does not accept an opaque preset or contradictory preset dimensions", () => {
    const { dimensions: _, ...missing } = base(); expect(AdaptationIntentSchema.safeParse(missing).success).toBe(false);
    expect(() => normalizeAdaptationIntent({ ...base(), dimensions: { ...base().dimensions, character: "open" } })).toThrow();
  });
  it("fingerprints ignore order and separate material from provenance", () => {
    const first = normalizeAdaptationIntent({ ...base(), overrides: [override("one", "Survives"), { ...override("two", "Survives"), targetIds: ["other"] }] });
    const reordered = normalizeAdaptationIntent({ ...first, overrides: [...first.overrides].reverse() });
    expect(reordered.materialFingerprint).toBe(first.materialFingerprint); expect(reordered.provenanceFingerprint).toBe(first.provenanceFingerprint);
    const provenance = normalizeAdaptationIntent({ ...first, revision: { kind: "manual", previousVersionId: "prior" }, overrides: first.overrides.map((v) => ({ ...v, provenance: { ...v.provenance, requestDigest: sourceDigest("new audit") } })) });
    expect(provenance.materialFingerprint).toBe(first.materialFingerprint); expect(provenance.provenanceFingerprint).not.toBe(first.provenanceFingerprint);
    expect(adaptationIntentFingerprints(first).materialFingerprint).toBe(first.materialFingerprint);
  });
  it("rejects simultaneous conflicting effects; deactivation by stable ID resolves explicitly", () => {
    const overrides = [override("alive", "Survives"), override("dead", "Dies")];
    expect(adaptationOverrideConflicts(overrides)[0]?.overrideIds).toEqual(["alive", "dead"]);
    expect(() => normalizeAdaptationIntent({ ...base(), overrides })).toThrow("adaptation_override_conflict");
    expect(normalizeAdaptationIntent({ ...base(), overrides: [overrides[0]!, { ...overrides[1]!, active: false }] }).overrides).toHaveLength(2);
  });
  it("does not treat dimensions, unrelated aspects or disjoint scopes as contradictory", () => {
    expect(normalizeAdaptationIntent({ ...base(), overrides: [override("alive", "Survives"), { ...override("other", "Dies"), scope: "alternate-ending" }] }).overrides).toHaveLength(2);
  });
  it.each(["Canon route preserved", "route exists", "ending is reachable", "canon graph preserved", "obligation achieved", "fidelity verified", "generated structure satisfies obligation", "scenes have been faithfully reproduced"])("rejects achieved claim: %s", (claim) => {
    expect(() => assertRequestedSemantics({ effect: claim })).toThrow("adaptation_achieved_claim_forbidden");
    expect(() => normalizeAdaptationIntent({ ...base(), overrides: [override("one", claim)] })).toThrow();
  });
  it("accepts requested ending/reveal obligations but closed schemas reject achieved flags and A3 corrections", () => {
    expect(() => assertRequestedSemantics("Request that the source ending remain reachable")).not.toThrow();
    expect(AdaptationSuggestionSchema.safeParse({ schemaVersion: 1, intent: "source-analysis-correction", operations: [{ kind: "dimension", dimension: "tone", level: "strict" }] }).success).toBe(false);
    expect(AdaptationIntentSchema.safeParse({ ...base(), routePreserved: true }).success).toBe(false);
  });
  it("separates adaptation-only invention and rejects source-mislabeled inventions and orphan dependencies", () => {
    const invention = { ...common, id: "new", origin: "adaptation-only" as const, kind: "scene" as const, description: "A new scene", dependencyIds: [] };
    expect(normalizeAdaptationIntent({ ...base(), inventions: [invention] }).inventions[0]?.origin).toBe("adaptation-only");
    expect(() => normalizeAdaptationIntent({ ...base(), inventions: [{ ...invention, dependencyIds: ["missing"] }] })).toThrow();
    expect(AdaptationIntentSchema.safeParse({ ...base(), inventions: [{ ...invention, origin: "source-canon" }] }).success).toBe(false);
  });
  it("rejects duplicate IDs, foreign provenance, orphan exceptions, and cyclic expansion dependencies", () => {
    expect(() => normalizeAdaptationIntent({ ...base(), overrides: [override("one", "Survives"), override("one", "Survives")] })).toThrow();
    expect(() => normalizeAdaptationIntent({ ...base(), overrides: [{ ...override("one", "Survives"), provenance: { origin: "manual", projectId: "foreign" } }] })).toThrow();
    const item = { ...common, id: "one", origin: "branching" as const, description: "Branches", sourceRecordIds: [], overrideIds: [], inventionIds: [], dependencyIds: ["one"], allocation: { kind: "unknown" as const } };
    expect(() => normalizeAdaptationIntent({ ...base(), expansion: [item] })).toThrow();
  });
  it("reconciles 30k + 50k = 80k without changing the author target; overspend remains a review discrepancy", () => {
    const item = { ...common, id: "one", origin: "branching" as const, description: "Branches", sourceRecordIds: [], overrideIds: [], inventionIds: [], dependencyIds: [], allocation: { kind: "estimated" as const, words: 50_000 } };
    const intent = normalizeAdaptationIntent({ ...base(), budget: { sourceEquivalent: { kind: "estimated", words: 30_000 }, target: { kind: "estimated", words: 80_000 }, discrepancyReviewed: false }, expansion: [item] });
    expect(adaptationBudget(intent)).toEqual({ planned: 80_000, target: 80_000, difference: 0, status: "reconciled" });
    const excess = normalizeAdaptationIntent({ ...intent, expansion: [{ ...item, allocation: { kind: "estimated", words: 90_000 } }] });
    expect(adaptationBudget(excess).difference).toBe(-40_000); expect(excess.budget.target).toEqual(intent.budget.target);
    expect(adaptationBudget(base()).status).toBe("unknown");
    expect(AdaptationIntentSchema.safeParse({ ...base(), budget: { ...base().budget, target: { kind: "unknown", words: 80_000 } } }).success).toBe(false);
  });
  it("applies atomic structured operations without permitting target inflation", () => {
    const next = applyAdaptationOperations(base(), { schemaVersion: 1, intent: "adaptation-preference", operations: [{ kind: "dimension", dimension: "tone", level: "strict" }] }, sourceDigest("request"));
    expect(next.dimensions.tone).toBe("strict"); expect(next.budget).toEqual(base().budget);
    expect(AdaptationSuggestionSchema.safeParse({ schemaVersion: 1, intent: "adaptation-preference", operations: [{ kind: "budget", target: 140_000 }] }).success).toBe(false);
  });
});
