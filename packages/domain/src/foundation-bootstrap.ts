import { z } from "zod";
import { AdaptationIntentSchema, assertAdaptationDossier, assertRequestedSemantics } from "./adaptation-intent.js";
import { SourceDossierSchema, sourceCanonicalJson, sourceDossierFingerprints } from "./source-analysis.js";
import { CreativeDirectionSchema, assertCreativeDirectionReferences } from "./creative-direction.js";
import { ProjectBriefSchema } from "./project-brief.js";
import { LongFormStoryBibleSchema } from "./long-form-story-bible.js";
import { LongFormRoutePlanSchema } from "./long-form-route-plan.js";
import { LongFormEndingPlanSchema } from "./long-form-ending-plan.js";
import { LongFormMechanicsPlanSchema } from "./long-form-mechanics-plan.js";
import { buildLongFormProjectReferenceIndex, validateLongFormProject } from "./long-form-foundation.js";

export const FOUNDATION_ARTIFACT_IDS = ["brief", "creative-direction", "bible", "routes", "endings", "mechanics"] as const;
export type FoundationArtifactId = typeof FOUNDATION_ARTIFACT_IDS[number];
export const FOUNDATION_BOOTSTRAP_POLICY = "foundation-bootstrap-v1" as const;
export const FOUNDATION_BOOTSTRAP_LIMITS = Object.freeze({ contextBytes: 96_000, outputBytes: 192_000, provenance: 2_000, attempts: 4, structuralRepairs: 0 });
const id = z.string().trim().min(1).max(240);
const ids = z.array(id).max(1_000).refine((values) => new Set(values).size === values.length, "IDs must be unique");
const shape = <T extends z.ZodTypeAny>(schema: T) => ({ brief: schema, "creative-direction": schema, bible: schema, routes: schema, endings: schema, mechanics: schema });
export const FoundationArtifactsSchema = z.object({ brief: ProjectBriefSchema, "creative-direction": CreativeDirectionSchema,
  bible: LongFormStoryBibleSchema, routes: LongFormRoutePlanSchema, endings: LongFormEndingPlanSchema, mechanics: LongFormMechanicsPlanSchema }).strict();
export type FoundationArtifacts = z.infer<typeof FoundationArtifactsSchema>;
export const FoundationArtifactVersionsSchema = z.object(shape(id.nullable())).strict();
export const FoundationBootstrapContextSchema = z.object({
  schemaVersion: z.literal(1), policyVersion: z.literal(FOUNDATION_BOOTSTRAP_POLICY), projectId: id,
  title: z.string().trim().min(1).max(200), dossierVersionId: id, intentVersionId: id,
  dossier: SourceDossierSchema, intent: AdaptationIntentSchema,
  baseVersionIds: FoundationArtifactVersionsSchema, baseArtifacts: z.object({ brief: ProjectBriefSchema.nullable(), "creative-direction": CreativeDirectionSchema.nullable(),
    bible: LongFormStoryBibleSchema.nullable(), routes: LongFormRoutePlanSchema.nullable(), endings: LongFormEndingPlanSchema.nullable(), mechanics: LongFormMechanicsPlanSchema.nullable() }).strict(),
  request: z.string().trim().min(1).max(6_000), providerId: id, modelId: id,
}).strict();
export type FoundationBootstrapContext = z.infer<typeof FoundationBootstrapContextSchema>;
export type BootstrapContext = FoundationBootstrapContext;

export const FoundationFieldProvenanceSchema = z.object({
  artifactId: z.enum(FOUNDATION_ARTIFACT_IDS), fieldPath: z.string().min(2).max(1_000).startsWith("/"),
  origin: z.enum(["source", "inference", "a3-correction", "a4-override", "adaptation-only"]),
  sourceRecordIds: ids, correctionIds: ids, overrideIds: ids, inventionIds: ids,
  rationale: z.string().trim().min(1).max(1_200),
}).strict();
export type FoundationFieldProvenance = z.infer<typeof FoundationFieldProvenanceSchema>;
export const FoundationCanonAssessmentSchema = z.object({
  obligationId: id,
  status: z.enum(["represented", "condensed", "intentionally-changed", "blocked", "pending-passage-validation"]),
  routeIds: ids, actIds: ids, endingIds: ids, rationale: z.string().trim().min(1).max(1_200),
  structuralEvidence: z.array(z.object({ artifactId: z.enum(["routes", "endings"]), fieldPath: z.string().min(2).max(1_000).startsWith("/") }).strict()).max(100),
}).strict();
export const FoundationBootstrapCandidateSchema = z.object({
  schemaVersion: z.literal(1), artifacts: FoundationArtifactsSchema,
  provenance: z.array(FoundationFieldProvenanceSchema).min(1).max(FOUNDATION_BOOTSTRAP_LIMITS.provenance),
  canonAssessment: z.array(FoundationCanonAssessmentSchema).max(1_000),
  passageValidation: z.literal("pending"),
}).strict();
export type FoundationBootstrapCandidate = z.infer<typeof FoundationBootstrapCandidateSchema>;

export function foundationFieldPaths(value: unknown, path = ""): string[] {
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([key]) => !["schemaVersion", "schemaId", "materialFingerprint", "provenanceFingerprint", "fieldProvenance"].includes(key));
    if (entries.length) return entries.flatMap(([key, child]) => foundationFieldPaths(child, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`));
  }
  return path ? [path] : [];
}

export function assertFoundationBootstrapContext(value: unknown): FoundationBootstrapContext {
  if (new TextEncoder().encode(sourceCanonicalJson(value)).length > FOUNDATION_BOOTSTRAP_LIMITS.contextBytes) throw new Error("bootstrap_context_overflow");
  const context = FoundationBootstrapContextSchema.parse(value);
  if (context.dossier.projectId !== context.projectId || context.intent.projectId !== context.projectId
    || context.intent.binding.dossierVersionId !== context.dossierVersionId) throw new Error("bootstrap_input_identity_invalid");
  const fingerprints = sourceDossierFingerprints(context.dossier);
  if (fingerprints.materialFingerprint !== context.dossier.materialFingerprint || fingerprints.provenanceFingerprint !== context.dossier.provenanceFingerprint)
    throw new Error("bootstrap_dossier_fingerprint_invalid");
  assertAdaptationDossier(context.intent, context.dossier);
  if (context.intent.budget.target.kind !== "unknown" && (context.intent.budget.target.words < 50_000 || context.intent.budget.target.words > 1_000_000))
    throw new Error("bootstrap_budget_incompatible: review the author word budget before Long-form bootstrap");
  for (const artifactId of FOUNDATION_ARTIFACT_IDS) {
    if ((context.baseVersionIds[artifactId] === null) !== (context.baseArtifacts[artifactId] === null)) throw new Error("bootstrap_base_precondition_invalid");
  }
  return context;
}

export function parseFoundationBootstrapCandidate(value: unknown, input: FoundationBootstrapContext): FoundationBootstrapCandidate {
  const context = assertFoundationBootstrapContext(input);
  if (new TextEncoder().encode(sourceCanonicalJson(value)).length > FOUNDATION_BOOTSTRAP_LIMITS.outputBytes) throw new Error("bootstrap_output_overflow");
  const candidate = FoundationBootstrapCandidateSchema.parse(value);
  // Ordinary editing schemas historically strip unknown fields. Provider candidates must not.
  if (sourceCanonicalJson(candidate) !== sourceCanonicalJson(value)) throw new Error("bootstrap_candidate_not_closed");
  assertRequestedSemantics(candidate.artifacts);
  assertRequestedSemantics(candidate.canonAssessment.map((item) => item.rationale));
  assertRequestedSemantics(candidate.provenance.map((item) => item.rationale));
  const index = buildLongFormProjectReferenceIndex(candidate.artifacts);
  if ([...index.byId.values()].some((entries) => entries.length !== 1)) throw new Error("bootstrap_duplicate_identity");
  const errors = validateLongFormProject(candidate.artifacts).filter((finding) => finding.severity === "error");
  if (errors.length) throw new Error(`bootstrap_reference_invalid: ${errors.map((finding) => finding.code).join(",")}`);
  const { bible, routes, endings, mechanics } = candidate.artifacts;
  const baseBrief = context.baseArtifacts.brief, baseBible = context.baseArtifacts.bible;
  if (baseBrief && (candidate.artifacts.brief.adaptationFidelity !== baseBrief.adaptationFidelity
    || context.baseArtifacts["creative-direction"] && (candidate.artifacts.brief.tone !== baseBrief.tone || candidate.artifacts.brief.pointOfView !== baseBrief.pointOfView))
    || baseBible && context.baseArtifacts["creative-direction"] && sourceCanonicalJson(bible.proseGuidance) !== sourceCanonicalJson(baseBible.proseGuidance))
    throw new Error("bootstrap_historical_presentation_changed");
  assertCreativeDirectionReferences(candidate.artifacts["creative-direction"], { characterIds: bible.characters.map((item) => item.id),
    relationships: bible.relationships, routeIds: routes.routes.map((item) => item.id), acts: routes.acts });
  if (routes.totalWordTarget !== candidate.artifacts.brief.totalWordTarget || endings.projectWordTarget !== routes.totalWordTarget)
    throw new Error("bootstrap_word_budget_mismatch");
  if (context.intent.budget.target.kind !== "unknown" && candidate.artifacts.brief.totalWordTarget !== context.intent.budget.target.words)
    throw new Error("bootstrap_author_budget_changed");
  const mechanicIds: string[] = [];
  const collect = (value: unknown): void => { if (Array.isArray(value)) value.forEach(collect); else if (value && typeof value === "object") {
    if ("id" in value) mechanicIds.push(String(value.id)); Object.values(value).forEach(collect);
  } };
  collect(mechanics);
  if (new Set(mechanicIds).size !== mechanicIds.length) throw new Error("bootstrap_duplicate_identity");
  const records = new Map(context.dossier.records.filter((item) => item.status === "supported").map((item) => [item.id, item]));
  const corrections = new Map(context.dossier.corrections.map((item) => [item.id, item]));
  const overrides = new Map(context.intent.overrides.filter((item) => item.active && item.reviewed).map((item) => [item.id, item]));
  const inventions = new Set(context.intent.inventions.map((item) => item.id));
  const sourceExcerptIds = new Set([...records.values()].flatMap((record) => record.evidence.map((evidence) => evidence.excerptId)));
  if (bible.canonFacts.some((fact) => fact.sourceExcerptIds.some((id) => !sourceExcerptIds.has(id)))) throw new Error("bootstrap_source_evidence_invalid");
  const paths = new Set(FOUNDATION_ARTIFACT_IDS.flatMap((artifactId) => foundationFieldPaths(candidate.artifacts[artifactId]).map((path) => `${artifactId}:${path}`)));
  const provided = new Set<string>();
  for (const record of candidate.provenance) {
    const key = `${record.artifactId}:${record.fieldPath}`;
    if (!paths.has(key) || provided.has(key)) throw new Error("bootstrap_provenance_path_invalid");
    provided.add(key);
    if (record.sourceRecordIds.some((id) => !records.has(id)) || record.correctionIds.some((id) => !corrections.has(id))
      || record.overrideIds.some((id) => !overrides.has(id)) || record.inventionIds.some((id) => !inventions.has(id))) throw new Error("bootstrap_provenance_ungrounded");
    if (record.origin === "source" && (!record.sourceRecordIds.length || record.sourceRecordIds.some((id) => records.get(id)!.classification !== "source-canon")
      || record.correctionIds.length || record.overrideIds.length || record.inventionIds.length)) throw new Error("bootstrap_source_provenance_invalid");
    if (record.origin === "inference" && (!record.sourceRecordIds.length || record.correctionIds.length || record.overrideIds.length || record.inventionIds.length)) throw new Error("bootstrap_inference_provenance_invalid");
    if (record.origin === "a3-correction" && (!record.correctionIds.length || !record.sourceRecordIds.length || record.overrideIds.length || record.inventionIds.length)) throw new Error("bootstrap_correction_provenance_invalid");
    if (record.origin === "a4-override" && (!record.overrideIds.length || !record.sourceRecordIds.length || record.correctionIds.length || record.inventionIds.length
      || record.sourceRecordIds.some((id) => !record.overrideIds.some((overrideId) => overrides.get(overrideId)!.targetIds.includes(id))))) throw new Error("bootstrap_override_provenance_invalid");
    if (record.origin === "adaptation-only" && (record.sourceRecordIds.length || record.correctionIds.length || record.overrideIds.length)) throw new Error("bootstrap_invention_provenance_invalid");
    for (const correctionId of record.correctionIds) {
      const operation = corrections.get(correctionId)!.operation as Record<string, unknown>;
      const targets = [operation.recordId, operation.targetId, ...(Array.isArray(operation.recordIds) ? operation.recordIds : []),
        ...(Array.isArray(operation.children) ? operation.children.map((child: { id: string }) => child.id) : [])];
      if (!record.sourceRecordIds.some((id) => targets.includes(id))) throw new Error("bootstrap_correction_provenance_invalid");
    }
  }
  if (provided.size !== paths.size) throw new Error("bootstrap_provenance_incomplete");
  bible.canonFacts.forEach((fact, index) => {
    const provenance = candidate.provenance.find((item) => item.artifactId === "bible" && item.fieldPath === `/canonFacts/${index}/statement`)!;
    const linked = provenance.sourceRecordIds.map((id) => records.get(id)!);
    if (!["source", "a3-correction"].includes(provenance.origin) || !linked.length
      || linked.some((record) => record.classification !== "source-canon")
      || fact.statement !== linked.map((record) => record.claim).join("\n")
      || fact.sourceExcerptIds.some((id) => !linked.some((record) => record.evidence.some((evidence) => evidence.excerptId === id))))
      throw new Error("bootstrap_canon_fact_ungrounded");
  });
  // Overrides are author policy even when no canon obligation targets the affected record.
  for (const override of overrides.values()) {
    const grounded = candidate.provenance.some((entry) => {
      if (entry.origin !== "a4-override" || !entry.overrideIds.includes(override.id)
        || override.targetIds.some((targetId) => !entry.sourceRecordIds.includes(targetId))) return false;
      if (!(entry.artifactId === "bible" && /^\/adaptationOpportunities\/\d+\/description$/.test(entry.fieldPath))
        && !(["routes", "endings"].includes(entry.artifactId) && /\/(summary|purpose|promise|thematicPayoff)$/.test(entry.fieldPath))) return false;
      const material = entry.fieldPath.slice(1).split("/").reduce<unknown>((value, segment) => value && typeof value === "object"
        ? (value as Record<string, unknown>)[segment.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined, candidate.artifacts[entry.artifactId]);
      return typeof material === "string" && material.split("\n").some((_, index, lines) => lines.slice(index, index + override.effect.split("\n").length).join("\n") === override.effect);
    });
    if (!grounded) throw new Error("bootstrap_active_override_ungrounded");
  }
  const assessed = new Set<string>();
  for (const assessment of candidate.canonAssessment) {
    const obligation = context.intent.obligations.find((item) => item.id === assessment.obligationId);
    if (!obligation || assessed.has(assessment.obligationId)) throw new Error("bootstrap_obligation_mapping_invalid");
    assessed.add(assessment.obligationId);
    if (assessment.status === "blocked" && !assessment.routeIds.length && !assessment.actIds.length && !assessment.endingIds.length && !assessment.structuralEvidence.length) continue;
    if (!assessment.routeIds.length || !assessment.actIds.length || !assessment.endingIds.length
      || assessment.routeIds.some((id) => !routes.routes.some((item) => item.id === id))
      || assessment.actIds.some((id) => !routes.acts.some((item) => item.id === id && (item.routeId === null || assessment.routeIds.includes(item.routeId))))
      || assessment.endingIds.some((id) => !endings.endings.some((item) => item.id === id && assessment.routeIds.includes(item.routeId)))) throw new Error("bootstrap_obligation_mapping_invalid");
    if (assessment.status === "condensed" && !obligation.transformations.includes("compress")) throw new Error("bootstrap_obligation_transformation_forbidden");
    if (assessment.status === "intentionally-changed" && !context.intent.exceptions.some((item) => item.obligationId === obligation.id && item.reviewed)) throw new Error("bootstrap_obligation_transformation_forbidden");
    const grounded = new Set<string>();
    const groundedEntities = new Set<string>();
    const evidencePaths = new Set<string>();
    for (const evidence of assessment.structuralEvidence) {
      const key = `${evidence.artifactId}:${evidence.fieldPath}`;
      if (evidencePaths.has(key)) throw new Error("bootstrap_obligation_evidence_invalid");
      evidencePaths.add(key);
      const segments = evidence.fieldPath.slice(1).split("/").map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
      const collection = segments[0], position = segments[1], field = segments[2];
      if (!position || !/^(0|[1-9][0-9]*)$/.test(position) || segments.length !== 3 || !["summary", "purpose", "promise", "thematicPayoff"].includes(field ?? ""))
        throw new Error("bootstrap_obligation_evidence_invalid");
      const entity = evidence.artifactId === "routes" && collection === "routes" ? routes.routes[Number(position)]
        : evidence.artifactId === "routes" && collection === "acts" ? routes.acts[Number(position)]
          : evidence.artifactId === "endings" && collection === "endings" ? endings.endings[Number(position)] : undefined;
      const includedIds = collection === "routes" ? assessment.routeIds : collection === "acts" ? assessment.actIds : assessment.endingIds;
      if (!entity || !includedIds.includes(entity.id)) throw new Error("bootstrap_obligation_evidence_invalid");
      const material = (entity as unknown as Record<string, unknown>)[field!];
      const provenance = candidate.provenance.find((item) => item.artifactId === evidence.artifactId && item.fieldPath === evidence.fieldPath);
      if (typeof material !== "string" || !provenance || provenance.origin === "adaptation-only") throw new Error("bootstrap_obligation_evidence_ungrounded");
      let previousPosition = -1;
      for (const targetId of obligation.targetIds) {
        if (!provenance.sourceRecordIds.includes(targetId)) continue;
        const activeOverrides = [...overrides.values()].filter((override) => override.targetIds.includes(targetId));
        const claims = activeOverrides.length ? activeOverrides.map((override) => override.effect) : [records.get(targetId)!.claim];
        const lines = material.split("\n");
        const positions = claims.map((claim) => lines.findIndex((_, index) => lines.slice(index, index + claim.split("\n").length).join("\n") === claim));
        const position = Math.min(...positions);
        if (positions.some((position) => position < 0) || activeOverrides.length && (provenance.origin !== "a4-override" || activeOverrides.some((override) => !provenance.overrideIds.includes(override.id)))) continue;
        if (obligation.kind === "chronology" && assessment.status !== "intentionally-changed" && position <= previousPosition)
          throw new Error("bootstrap_obligation_order_invalid");
        previousPosition = position;
        grounded.add(targetId);
        groundedEntities.add(`${collection}:${entity.id}`);
      }
    }
    if (obligation.targetIds.some((id) => !grounded.has(id))
      || assessment.routeIds.some((id) => !groundedEntities.has(`routes:${id}`))
      || assessment.actIds.some((id) => !groundedEntities.has(`acts:${id}`))
      || assessment.endingIds.some((id) => !groundedEntities.has(`endings:${id}`))) throw new Error("bootstrap_obligation_evidence_ungrounded");
  }
  if (assessed.size !== context.intent.obligations.length) throw new Error("bootstrap_obligation_mapping_incomplete");
  return candidate;
}
