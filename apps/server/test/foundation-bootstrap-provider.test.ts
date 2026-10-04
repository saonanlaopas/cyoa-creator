import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { EnvironmentCredentialStore, OpenRouterClient } from "@story-to-cyoa/openrouter";
import { assertFoundationBootstrapContext, contentFingerprint, defaultCreativeDirection, defaultProjectBrief, FOUNDATION_ARTIFACT_IDS,
  foundationFieldPaths, newAdaptationIntent, normalizeAdaptationIntent, parseFoundationBootstrapCandidate, sourceDossierFingerprints,
  sourceEvidence, type FoundationBootstrapCandidate, type FoundationBootstrapContext, type SourceDossier } from "@story-to-cyoa/domain";
import { DeterministicFoundationBootstrapProvider, deterministicFoundationBootstrapCandidate, OpenRouterFoundationBootstrapProvider } from "../src/services/foundation-bootstrap-provider.js";

function context(): FoundationBootstrapContext {
  const binding = { projectId: "project", sourceVersionId: "source", sourceFingerprint: "a".repeat(64), scopeVersionId: "scope", scopeFingerprint: "b".repeat(64), chapterIds: ["chapter"] };
  const record = { id: "record", category: "turning-point" as const, identityKey: "departure", field: "event", claim: "Mira leaves the harbor.",
    classification: "source-canon" as const, aliases: [], references: [], evidence: [sourceEvidence(binding, "chapter", "excerpt", "Mira leaves the harbor.")],
    uncertainty: "", status: "supported" as const, observationIds: ["observation"] };
  const raw = { schemaVersion: 1 as const, projectId: "project", planId: "analysis", jobId: "analysis-job", binding, records: [record], conflicts: [], provenance: [], corrections: [] };
  const dossier: SourceDossier = { ...raw, ...sourceDossierFingerprints(raw) };
  const initial = newAdaptationIntent("project", { dossierVersionId: "dossier", dossierMaterialFingerprint: dossier.materialFingerprint, source: binding });
  const intent = normalizeAdaptationIntent({ ...initial, obligations: [{ id: "obligation", scope: "project", rationale: "Retain the source departure.",
    provenance: { origin: "manual", projectId: "project" }, status: "requested", kind: "ending", targetIds: [record.id], evidence: record.evidence,
    requirement: "Request the source departure as one ending.", strength: "required", transformations: [] }] });
  return { schemaVersion: 1, policyVersion: "foundation-bootstrap-v1", projectId: "project", title: "Harbor", dossierVersionId: "dossier", intentVersionId: "intent", dossier, intent,
    baseVersionIds: { brief: null, "creative-direction": null, bible: null, routes: null, endings: null, mechanics: null },
    baseArtifacts: { brief: null, "creative-direction": null, bible: null, routes: null, endings: null, mechanics: null },
    request: "Bootstrap six draft foundations", providerId: "offline-foundation-bootstrap", modelId: "offline-foundation-v1" };
}

describe("Foundation bootstrap candidate and provider contracts", () => {
  it("retains legacy SHA fingerprints after moving browser-safe schema authority", () => {
    for (const value of [{ title: "Harbor", nested: [1, { words: "\u00e9\u4e2d\ud83d\ude00", multiline: "a\nb" }] }, defaultProjectBrief(), defaultCreativeDirection()])
      expect(contentFingerprint(value)).toBe(createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24));
  });
  it("produces all six deterministic drafts with every leaf attributed and exact pending structural mappings", async () => {
    const input = context(), provider = new DeterministicFoundationBootstrapProvider();
    const request = { context: input, modelId: input.modelId, mode: "generate" as const, signal: new AbortController().signal };
    const first = await provider.generate(request), second = await provider.generate(request);
    expect(first).toBe(second);
    const candidate = parseFoundationBootstrapCandidate(JSON.parse(first), input);
    expect(Object.keys(candidate.artifacts).sort()).toEqual([...FOUNDATION_ARTIFACT_IDS].sort());
    expect(candidate.provenance).toHaveLength(FOUNDATION_ARTIFACT_IDS.reduce((sum, id) => sum + foundationFieldPaths(candidate.artifacts[id]).length, 0));
    expect(candidate.canonAssessment[0]).toMatchObject({ obligationId: "obligation", status: "pending-passage-validation", routeIds: ["route-1"], actIds: ["route-1-act"] });
    expect(candidate.passageValidation).toBe("pending");
    expect(candidate.artifacts).not.toHaveProperty("passages");
  });
  it("preserves exact optional Creative Direction and legacy Brief presentation fields", () => {
    const input = context(); input.baseArtifacts["creative-direction"] = defaultCreativeDirection("third-person"); input.baseVersionIds["creative-direction"] = "direction";
    input.baseArtifacts.brief = { ...defaultProjectBrief(), tone: "Historical tone", pointOfView: "first-person", adaptationFidelity: "expansive" }; input.baseVersionIds.brief = "brief";
    const candidate = deterministicFoundationBootstrapCandidate(input);
    expect(candidate.artifacts["creative-direction"]).toEqual(input.baseArtifacts["creative-direction"]);
    expect(candidate.artifacts.brief).toMatchObject({ tone: "Historical tone", pointOfView: "first-person", adaptationFidelity: "expansive" });
  });
  it.each([
    ["unknown field", (c: FoundationBootstrapCandidate) => { Object.assign(c.artifacts.routes.routes[0]!, { achieved: true }); }],
    ["duplicate ID", (c: FoundationBootstrapCandidate) => { c.artifacts.mechanics.flags[0]!.id = c.artifacts.routes.routes[0]!.id; }],
    ["bad reference", (c: FoundationBootstrapCandidate) => { c.artifacts.endings.endings[0]!.routeId = "missing"; }],
    ["missing provenance", (c: FoundationBootstrapCandidate) => { c.provenance.pop(); }],
    ["broad provenance", (c: FoundationBootstrapCandidate) => { c.provenance[0]!.fieldPath = "/routes"; }],
    ["duplicate provenance", (c: FoundationBootstrapCandidate) => { c.provenance.push(c.provenance[0]!); }],
    ["foreign source", (c: FoundationBootstrapCandidate) => { c.provenance[0]!.sourceRecordIds = ["foreign"]; }],
    ["source invention", (c: FoundationBootstrapCandidate) => { c.provenance[0]!.origin = "source"; }],
    ["invented source excerpt", (c: FoundationBootstrapCandidate) => { c.artifacts.bible.canonFacts[0]!.sourceExcerptIds = ["not-supplied"]; }],
    ["missing obligation", (c: FoundationBootstrapCandidate) => { c.canonAssessment = []; }],
    ["foreign structural mapping", (c: FoundationBootstrapCandidate) => { c.canonAssessment[0]!.actIds = ["missing"]; }],
    ["mismatched route ownership", (c: FoundationBootstrapCandidate) => { c.canonAssessment[0]!.actIds = ["route-2-act"]; }],
    ["guessed existing unrelated ending", (c: FoundationBootstrapCandidate) => { c.canonAssessment[0]!.endingIds = ["ending-3"]; c.canonAssessment[0]!.structuralEvidence = [{ artifactId: "endings", fieldPath: "/endings/2/summary" }]; }],
    ["generic structural text with real source pointer", (c: FoundationBootstrapCandidate) => { c.artifacts.endings.endings[0]!.summary = "A different outcome unrelated to the source."; }],
    ["provenance from nonmapped structural field", (c: FoundationBootstrapCandidate) => { c.canonAssessment[0]!.structuralEvidence = [{ artifactId: "endings", fieldPath: "/overview" }]; }],
    ["unpermitted condensation", (c: FoundationBootstrapCandidate) => { c.canonAssessment[0]!.status = "condensed"; }],
    ["premature preservation", (c: FoundationBootstrapCandidate) => { c.canonAssessment[0]!.rationale = "Canon route preserved"; }],
    ["premature provenance claim", (c: FoundationBootstrapCandidate) => { c.provenance[0]!.rationale = "Source ending preserved"; }],
  ] as const)("rejects %s", (_name, mutate) => {
    const input = context(), candidate = deterministicFoundationBootstrapCandidate(input); mutate(candidate);
    expect(() => parseFoundationBootstrapCandidate(candidate, input)).toThrow();
  });
  it("rejects oversized output before parsing", () => {
    const input = context(), candidate = deterministicFoundationBootstrapCandidate(input); candidate.artifacts.brief.premise = "x".repeat(200_000);
    expect(() => parseFoundationBootstrapCandidate(candidate, input)).toThrow("bootstrap_output_overflow");
  });
  it("permits an honestly blocked obligation without invented structural IDs", () => {
    const input = context(), candidate = deterministicFoundationBootstrapCandidate(input);
    candidate.canonAssessment[0] = { obligationId: "obligation", status: "blocked", routeIds: [], actIds: [], endingIds: [], structuralEvidence: [],
      rationale: "The required departure cannot yet be assigned to a suitable proposed ending." };
    expect(parseFoundationBootstrapCandidate(candidate, input).canonAssessment[0]!.status).toBe("blocked");
  });
  it("keeps correction, inference, author override, and invention origins distinct", () => {
    const input = context(), record = input.dossier.records[0]!;
    input.dossier.records.push({ ...record, id: "inferred", category: "theme", claim: "The harbor may evoke loss.", classification: "inference", observationIds: ["inferred-observation"] });
    input.dossier.corrections.push({ id: "correction", kind: "field", intent: "source-analysis-correction", reason: "Clarify departure.", previousVersionId: "earlier-dossier",
      operation: { kind: "field", recordId: record.id }, beforeFingerprint: "a".repeat(64), afterFingerprint: "b".repeat(64) });
    Object.assign(input.dossier, sourceDossierFingerprints(input.dossier));
    const common = { scope: "project", rationale: "Author requested distinction.", provenance: { origin: "manual" as const, projectId: input.projectId } };
    input.intent = normalizeAdaptationIntent({ ...input.intent, binding: { ...input.intent.binding, dossierMaterialFingerprint: input.dossier.materialFingerprint },
      overrides: [{ ...common, id: "override", authority: "author-override", targetIds: [record.id], aspect: "timing", effect: "Depart after dawn.", active: true, reviewed: true }],
      inventions: [{ ...common, id: "invention", origin: "adaptation-only", kind: "scene", description: "A new harbor farewell.", dependencyIds: [] }] });
    const candidate = deterministicFoundationBootstrapCandidate(input);
    expect(new Set(candidate.provenance.map((item) => item.origin))).toEqual(new Set(["a3-correction", "inference", "a4-override", "adaptation-only"]));
    const correction = candidate.provenance.find((item) => item.origin === "a3-correction")!;
    expect(correction.correctionIds).toEqual(["correction"]);
    const override = candidate.provenance.find((item) => item.origin === "a4-override")!;
    expect(override.overrideIds).toEqual(["override"]);
    const invention = candidate.provenance.find((item) => item.inventionIds.length)!;
    expect(invention.sourceRecordIds).toEqual([]);
    correction.correctionIds = ["missing"];
    expect(() => parseFoundationBootstrapCandidate(candidate, input)).toThrow("bootstrap_provenance_ungrounded");
  });
  it("rejects oversized context locally and never silently omits required evidence", () => {
    const input = context(); input.request = "x".repeat(100_000);
    expect(() => assertFoundationBootstrapContext(input)).toThrow("bootstrap_context_overflow");
  });
  it.each([30_000, 1_000_001])("rejects incompatible author target %i without inflation", (words) => {
    const input = context(); input.intent = normalizeAdaptationIntent({ ...input.intent, budget: { ...input.intent.budget, target: { kind: "known", words } } });
    expect(() => deterministicFoundationBootstrapCandidate(input)).toThrow("bootstrap_budget_incompatible");
  });
  it("rejects budget inflation and absent/current base mismatch", () => {
    const input = context(); input.intent = normalizeAdaptationIntent({ ...input.intent, budget: { ...input.intent.budget, target: { kind: "known", words: 80_000 } } });
    const candidate = deterministicFoundationBootstrapCandidate(input);
    candidate.artifacts.brief.totalWordTarget = candidate.artifacts.routes.totalWordTarget = candidate.artifacts.endings.projectWordTarget = 100_000;
    expect(() => parseFoundationBootstrapCandidate(candidate, input)).toThrow("bootstrap_author_budget_changed");
    input.baseVersionIds.brief = "absent-content";
    expect(() => assertFoundationBootstrapContext(input)).toThrow("bootstrap_base_precondition_invalid");
  });
  it("uses a stubbed OpenRouter structured boundary without a live or paid call", async () => {
    const input = context(), output = deterministicFoundationBootstrapCandidate(input), requests: Record<string, unknown>[] = [];
    const client = new OpenRouterClient({ credentialStore: new EnvironmentCredentialStore({ environment: { OPENROUTER_API_KEY: "offline-key" } }), fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
    } });
    const raw = await new OpenRouterFoundationBootstrapProvider(client).generate({ context: input, modelId: "offline-stub", mode: "generate", signal: new AbortController().signal });
    expect(parseFoundationBootstrapCandidate(JSON.parse(raw), input)).toEqual(output);
    expect(requests).toHaveLength(1); expect(requests[0]!.max_tokens).toBe(32_000);
  });
});
