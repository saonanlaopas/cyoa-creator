import { z } from "zod";
import { SourceBindingSchema, SourceEvidenceSchema, sourceCanonicalJson, sourceDigest, sourceSorted, type SourceDossier } from "./source-analysis.js";

export const ADAPTATION_INTENT_LIMITS = Object.freeze({ items: 1000, bytes: 2_000_000, history: 256, historyBytes: 32_000_000,
  contextBytes: 48_000, outputBytes: 24_000, records: 12, evidenceCharacters: 1200, operations: 32, repairs: 1 });
export const FIDELITY_DIMENSIONS = ["character", "world", "tone", "structure"] as const;
export const FIDELITY_LEVELS = ["strict", "strong", "flexible", "open"] as const;
export const FIDELITY_PRESETS = ["faithful", "meaningful-divergence", "loose", "inspired"] as const;
const id = z.string().min(1).max(240);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(1200);
const scope = z.string().trim().min(1).max(200);
const ids = z.array(id).max(32).refine((v) => new Set(v).size === v.length, "Duplicate reference IDs");
const level = z.enum(FIDELITY_LEVELS);
export const FidelityPolicySchema = z.object({ character: level, world: level, tone: level, structure: level }).strict();
export type FidelityPolicy = z.infer<typeof FidelityPolicySchema>;
export type FidelityPreset = typeof FIDELITY_PRESETS[number];
export function expandFidelityPreset(preset: FidelityPreset): FidelityPolicy {
  const policies: Record<FidelityPreset, FidelityPolicy> = {
    faithful: { character: "strong", world: "strong", tone: "strong", structure: "strong" },
    "meaningful-divergence": { character: "strong", world: "strong", tone: "strong", structure: "flexible" },
    loose: { character: "flexible", world: "strong", tone: "flexible", structure: "flexible" },
    inspired: { character: "open", world: "open", tone: "open", structure: "open" },
  };
  return structuredClone(policies[preset]);
}
export function legacyFidelityPreset(value: "canon-centered" | "balanced" | "expansive"): FidelityPreset {
  return { "canon-centered": "faithful", balanced: "meaningful-divergence", expansive: "loose" }[value] as FidelityPreset;
}
export const PlannedWordsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unknown") }).strict(),
  z.object({ kind: z.enum(["known", "estimated"]), words: z.number().int().nonnegative().max(10_000_000) }).strict(),
]);
export type PlannedWords = z.infer<typeof PlannedWordsSchema>;
const provenance = z.object({ origin: z.enum(["manual", "proposal"]), projectId: id, requestDigest: digest.optional() }).strict();
const common = { id, scope, rationale: text, provenance };
export const AdaptationOverrideSchema = z.object({ ...common, authority: z.literal("author-override"), targetIds: ids.refine((v) => v.length > 0),
  aspect: text, effect: text, active: z.boolean(), reviewed: z.boolean() }).strict();
export const AdaptationInventionSchema = z.object({ ...common, origin: z.literal("adaptation-only"),
  kind: z.enum(["scene", "character", "relationship", "location", "event", "framing"]), description: text, dependencyIds: ids }).strict();
export const TRANSFORMATIONS = ["combine", "compress", "substitute", "merge", "relocate", "change-delivery"] as const;
export const RequestedObligationSchema = z.object({ ...common, status: z.literal("requested"),
  kind: z.enum(["event", "relationship", "reveal", "character-state", "chronology", "ending", "world", "tone"]),
  targetIds: ids.refine((v) => v.length > 0), evidence: z.array(SourceEvidenceSchema).min(1).max(12),
  requirement: text, strength: z.enum(["required", "preferred"]), transformations: z.array(z.enum(TRANSFORMATIONS)).max(6),
}).strict();
export const AdaptationExceptionSchema = z.object({ ...common, obligationId: id, targetIds: ids.refine((v) => v.length > 0),
  evidence: z.array(SourceEvidenceSchema).min(1).max(12), permission: text, reviewed: z.boolean() }).strict();
export const ExpansionItemSchema = z.object({ ...common, origin: z.enum(["source-elaboration", "override-consequence", "adaptation-only", "branching", "connective"]),
  description: text, sourceRecordIds: ids, overrideIds: ids, inventionIds: ids, dependencyIds: ids, allocation: PlannedWordsSchema }).strict();
export const AdaptationBindingSchema = z.object({ dossierVersionId: id, dossierMaterialFingerprint: digest, source: SourceBindingSchema }).strict();
const intentShape = z.object({ schemaId: z.literal("adaptation-intent"), schemaVersion: z.literal(1), projectId: id,
  binding: AdaptationBindingSchema, dimensions: FidelityPolicySchema, preset: z.enum(FIDELITY_PRESETS).nullable(),
  preserveCanonRoute: z.boolean(), endingIntent: z.enum(["preserve-ending", "preserve-result-alter-mechanism", "allow-alternates", "not-required", "specific-state"]),
  overrides: z.array(AdaptationOverrideSchema).max(ADAPTATION_INTENT_LIMITS.items),
  inventions: z.array(AdaptationInventionSchema).max(ADAPTATION_INTENT_LIMITS.items),
  obligations: z.array(RequestedObligationSchema).max(ADAPTATION_INTENT_LIMITS.items),
  exceptions: z.array(AdaptationExceptionSchema).max(ADAPTATION_INTENT_LIMITS.items),
  expansion: z.array(ExpansionItemSchema).max(ADAPTATION_INTENT_LIMITS.items),
  budget: z.object({ sourceEquivalent: PlannedWordsSchema, target: PlannedWordsSchema, discrepancyReviewed: z.boolean() }).strict(),
  revision: z.object({ kind: z.enum(["manual", "proposal", "restore", "legacy-adoption"]), previousVersionId: id.nullable(),
    restoredFromVersionId: id.optional(), requestDigest: digest.optional(), legacyBriefVersionId: id.optional(), legacyFidelity: z.enum(["canon-centered", "balanced", "expansive"]).optional() }).strict(),
  materialFingerprint: digest, provenanceFingerprint: digest,
}).strict();
export type AdaptationIntent = z.infer<typeof intentShape>;

export function adaptationBudget(intent: Pick<AdaptationIntent, "budget" | "expansion">) {
  const values = [intent.budget.sourceEquivalent, ...intent.expansion.map((v) => v.allocation)];
  const planned = values.some((v) => v.kind === "unknown") ? null : values.reduce((sum, v) => sum + (v.kind === "unknown" ? 0 : v.words), 0);
  const target = intent.budget.target.kind === "unknown" ? null : intent.budget.target.words;
  return { planned, target, difference: planned === null || target === null ? null : target - planned,
    status: planned === null || target === null ? "unknown" : planned === target ? "reconciled" : "review-required" };
}
export function adaptationOverrideConflicts(overrides: AdaptationIntent["overrides"]) {
  const conflicts: Array<{ id: string; overrideIds: string[]; targetId: string; aspect: string; scope: string }> = [];
  const groups = new Map<string, typeof overrides>();
  for (const item of overrides.filter((o) => o.active)) for (const targetId of item.targetIds) {
    const key = sourceCanonicalJson([targetId, item.aspect.toLowerCase(), item.scope.toLowerCase()]);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const [key, items] of groups) if (new Set(items.map((o) => o.effect)).size > 1) {
    const [targetId, aspect, scope] = JSON.parse(key) as [string, string, string];
    conflicts.push({ id: `aic_${sourceDigest(key).slice(0, 32)}`, overrideIds: items.map((v) => v.id).sort(), targetId, aspect, scope });
  }
  return sourceSorted(conflicts);
}
export function assertRequestedSemantics(value: unknown): void {
  const achieved = /\b(?:canon route (?:is )?preserved|route (?:already )?exists|ending (?:is )?reachable|canon graph (?:is )?preserved|obligation (?:is )?achieved|fidelity (?:is )?verified|generated structure satisfies|scenes (?:have been|are) faithfully reproduced|graph reachability (?:is )?(?:verified|proven))\b/i;
  const walk = (item: unknown): boolean => typeof item === "string" ? achieved.test(item)
    : Array.isArray(item) ? item.some(walk) : !!item && typeof item === "object" && Object.values(item).some(walk);
  if (walk(value)) throw new Error("adaptation_achieved_claim_forbidden");
}
function canonicalIntent(intent: AdaptationIntent) {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? sourceSorted(item.map(canonical))
    : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).map(([key, v]) => [key, canonical(v)])) : item;
  return canonical(intent) as AdaptationIntent;
}
export function adaptationIntentFingerprints(intent: AdaptationIntent) {
  const { materialFingerprint: _, provenanceFingerprint: __, revision, preset, ...policy } = canonicalIntent(intent);
  const material = (value: unknown): unknown => Array.isArray(value) ? sourceSorted(value.map(material))
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([k]) => !["provenance", "reviewed", "discrepancyReviewed"].includes(k)).map(([k, v]) => [k, material(v)])) : value;
  return { materialFingerprint: sourceDigest(material(policy)), provenanceFingerprint: sourceDigest({ revision, preset,
    discrepancyReviewed: intent.budget.discrepancyReviewed, records: [...intent.overrides, ...intent.inventions, ...intent.obligations, ...intent.exceptions, ...intent.expansion].map((v) => ({ id: v.id, provenance: v.provenance, ...("reviewed" in v ? { reviewed: v.reviewed } : {}) })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }) };
}
export const AdaptationIntentSchema = intentShape.superRefine((intent, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  try { assertRequestedSemantics(intent); } catch (e) { issue((e as Error).message); }
  if (new TextEncoder().encode(JSON.stringify(intent)).length > ADAPTATION_INTENT_LIMITS.bytes) issue("adaptation_byte_budget_exceeded");
  const collections = [...intent.overrides, ...intent.inventions, ...intent.obligations, ...intent.exceptions, ...intent.expansion];
  if (new Set(collections.map((v) => v.id)).size !== collections.length) issue("adaptation_duplicate_ids");
  if (collections.some((v) => v.provenance.projectId !== intent.projectId)) issue("adaptation_foreign_provenance");
  if (intent.binding.source.projectId !== intent.projectId) issue("adaptation_foreign_binding");
  if (intent.preset && sourceCanonicalJson(intent.dimensions) !== sourceCanonicalJson(expandFidelityPreset(intent.preset))) issue("adaptation_preset_dimensions_mismatch");
  if (adaptationOverrideConflicts(intent.overrides).length) issue("adaptation_override_conflict");
  for (const exception of intent.exceptions) {
    const obligation = intent.obligations.find((o) => o.id === exception.obligationId);
    if (!obligation || exception.targetIds.some((v) => !obligation.targetIds.includes(v))
      || exception.evidence.some((v) => !obligation.evidence.some((e) => sourceCanonicalJson(e) === sourceCanonicalJson(v)))) issue("adaptation_exception_orphaned");
  }
  const dependencies = [...intent.inventions, ...intent.expansion];
  const allowed = new Set([...intent.overrides, ...intent.inventions, ...intent.obligations, ...intent.expansion].map((v) => v.id));
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (key: string): boolean => {
    if (visiting.has(key)) return false;
    if (visited.has(key)) return true;
    visiting.add(key);
    for (const child of dependencies.find((v) => v.id === key)?.dependencyIds ?? []) if (!allowed.has(child) || !visit(child)) return false;
    visiting.delete(key); visited.add(key); return true;
  };
  for (const item of dependencies) if (!visit(item.id)) issue("adaptation_dependency_invalid");
  for (const item of intent.expansion) {
    if (item.overrideIds.some((id) => !intent.overrides.some((o) => o.id === id)) || item.inventionIds.some((id) => !intent.inventions.some((o) => o.id === id))) issue("adaptation_expansion_reference_invalid");
    if ((item.origin === "source-elaboration" && !item.sourceRecordIds.length) || (item.origin === "override-consequence" && !item.overrideIds.length)
      || (item.origin === "adaptation-only" && (!item.inventionIds.length || item.sourceRecordIds.length))) issue("adaptation_expansion_origin_invalid");
  }
  const fingerprints = adaptationIntentFingerprints(intent);
  if (fingerprints.materialFingerprint !== intent.materialFingerprint || fingerprints.provenanceFingerprint !== intent.provenanceFingerprint) issue("adaptation_fingerprint_invalid");
});
export function normalizeAdaptationIntent(value: Omit<AdaptationIntent, "materialFingerprint" | "provenanceFingerprint">): AdaptationIntent {
  const candidate = { ...value, materialFingerprint: "0".repeat(64), provenanceFingerprint: "0".repeat(64) };
  return AdaptationIntentSchema.parse({ ...candidate, ...adaptationIntentFingerprints(candidate) });
}
export function newAdaptationIntent(projectId: string, binding: AdaptationIntent["binding"], preset: FidelityPreset = "meaningful-divergence"): AdaptationIntent {
  return normalizeAdaptationIntent({ schemaId: "adaptation-intent", schemaVersion: 1, projectId, binding, preset, dimensions: expandFidelityPreset(preset),
    preserveCanonRoute: false, endingIntent: "not-required", overrides: [], inventions: [], obligations: [], exceptions: [], expansion: [],
    budget: { sourceEquivalent: { kind: "unknown" }, target: { kind: "unknown" }, discrepancyReviewed: false }, revision: { kind: "manual", previousVersionId: null } });
}
export function assertAdaptationDossier(intent: AdaptationIntent, dossier: SourceDossier): void {
  if (intent.projectId !== dossier.projectId || intent.binding.dossierMaterialFingerprint !== dossier.materialFingerprint
    || sourceCanonicalJson(intent.binding.source) !== sourceCanonicalJson(dossier.binding)) throw new Error("adaptation_dossier_binding_invalid");
  const targets = (references: string[]) => references.map((id) => {
    const record = dossier.records.find((r) => r.id === id && r.status === "supported");
    if (!record) throw new Error("adaptation_target_invalid");
    return record;
  });
  for (const item of intent.overrides) targets(item.targetIds);
  for (const item of [...intent.obligations, ...intent.exceptions]) {
    const records = targets(item.targetIds);
    if ("kind" in item) {
      const categories: Record<typeof item.kind, string[]> = { event: ["event", "turningpoint"], relationship: ["relationship"], reveal: ["event", "knowledge", "unresolvedthread"],
        "character-state": ["character"], chronology: ["chronology", "event", "turningpoint"], ending: ["event", "turningpoint", "chronology"], world: ["worldfact", "rule", "location", "institution"], tone: ["tone", "style", "theme"] };
      if (records.some((r) => !categories[item.kind].includes(r.category))) throw new Error("adaptation_obligation_kind_unsupported");
    }
    if (item.evidence.some((e) => !records.some((r) => r.evidence.some((actual) => sourceCanonicalJson(e) === sourceCanonicalJson(actual))))) throw new Error("adaptation_obligation_evidence_invalid");
    if (records.some((r) => !item.evidence.some((e) => r.evidence.some((actual) => sourceCanonicalJson(e) === sourceCanonicalJson(actual))))) throw new Error("adaptation_obligation_evidence_missing");
  }
  for (const item of intent.expansion) targets(item.sourceRecordIds);
  if (intent.endingIntent !== "not-required" && !intent.obligations.some((o) => o.kind === "ending")) throw new Error("adaptation_ending_obligation_missing");
  if (intent.preserveCanonRoute && !intent.obligations.length) throw new Error("adaptation_canon_obligation_missing");
}

export const AdaptationOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dimension"), dimension: z.enum(FIDELITY_DIMENSIONS), level }).strict(),
  z.object({ kind: z.literal("preservation"), preserveCanonRoute: z.boolean(), endingIntent: intentShape.shape.endingIntent }).strict(),
  z.object({ kind: z.literal("override"), value: AdaptationOverrideSchema.omit({ provenance: true }) }).strict(),
  z.object({ kind: z.literal("invention"), value: AdaptationInventionSchema.omit({ provenance: true }) }).strict(),
  z.object({ kind: z.literal("obligation"), value: RequestedObligationSchema.omit({ provenance: true }) }).strict(),
  z.object({ kind: z.literal("exception"), value: AdaptationExceptionSchema.omit({ provenance: true }) }).strict(),
  z.object({ kind: z.literal("expansion"), value: ExpansionItemSchema.omit({ provenance: true }) }).strict(),
  z.object({ kind: z.literal("remove"), collection: z.enum(["overrides", "inventions", "obligations", "exceptions", "expansion"]), id }).strict(),
]);
export const AdaptationSuggestionSchema = z.object({ schemaVersion: z.literal(1), intent: z.literal("adaptation-preference"), operations: z.array(AdaptationOperationSchema).min(1).max(ADAPTATION_INTENT_LIMITS.operations) }).strict();
export type AdaptationSuggestion = z.infer<typeof AdaptationSuggestionSchema>;
export const AdaptationPreviewInputSchema = z.object({ request: z.string().trim().min(1).max(6000), recordIds: ids.refine((v) => v.length <= ADAPTATION_INTENT_LIMITS.records, "Too many records"),
  providerId: id, modelId: id }).strict();
export const AdaptationProposalSchema = z.object({ schemaId: z.literal("adaptation-intent-proposal"), schemaVersion: z.literal(1), projectId: id,
  baseVersionId: id.nullable(), input: AdaptationPreviewInputSchema, binding: AdaptationBindingSchema,
  contextFingerprint: digest, promptVersion: z.literal("adaptation-intent-v1"), suggestion: AdaptationSuggestionSchema, candidate: AdaptationIntentSchema,
  status: z.enum(["pending", "applied", "rejected"]), appliedVersionId: id.nullable(),
}).strict();
export type AdaptationProposal = z.infer<typeof AdaptationProposalSchema>;
export function applyAdaptationOperations(base: AdaptationIntent, suggestion: AdaptationSuggestion, requestDigest: string): AdaptationIntent {
  assertRequestedSemantics(suggestion);
  const next = structuredClone(base);
  const collectionNames = { override: "overrides", invention: "inventions", obligation: "obligations", exception: "exceptions", expansion: "expansion" } as const;
  for (const operation of suggestion.operations) {
    if (operation.kind === "dimension") { next.dimensions[operation.dimension] = operation.level; next.preset = null; }
    else if (operation.kind === "preservation") { next.preserveCanonRoute = operation.preserveCanonRoute; next.endingIntent = operation.endingIntent; }
    else if (operation.kind === "remove") { next[operation.collection] = next[operation.collection].filter((v) => v.id !== operation.id) as never; }
    else {
      const key = collectionNames[operation.kind];
      const item = { ...operation.value, provenance: { origin: "proposal" as const, projectId: next.projectId, requestDigest } };
      next[key] = [...next[key].filter((v) => v.id !== item.id), item] as never;
    }
  }
  next.budget.discrepancyReviewed = false;
  const conflicts = adaptationOverrideConflicts(next.overrides);
  if (conflicts.length) throw Object.assign(new Error("adaptation_override_conflict"), { conflicts: conflicts.map(({ id, overrideIds }) => ({ id, overrideIds })) });
  return normalizeAdaptationIntent(next);
}
