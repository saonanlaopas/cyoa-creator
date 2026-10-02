import { z } from "zod";
import { compareCreativeDirectionStrings as compare, sha256 } from "./creative-direction.js";

export const SOURCE_ANALYSIS_POLICY = Object.freeze({
  id: "source-analysis-v1", schemaVersion: 1, promptVersion: "source-analysis-v1",
  maxSourceCharacters: 4_000, maxContextBytes: 24_000, maxOutputBytes: 24_000,
  maxRangesPerUnit: 6, maxEncodedSourceBytes: 8_000,
  maxStoredOutputBytes: 64_000,
  maxOutputTokens: 4_000, maxObservationsPerUnit: 32, maxAttempts: 3, maxRepairs: 1,
  maxUnits: 96, maxProvenance: 3_072, maxRecords: 8_192, maxConflicts: 69_632,
  maxCorrections: 128, maxCorrectionBytes: 64 * 1024, maxDossierBytes: 40 * 1024 * 1024,
  maxDossierVersions: 256, maxDossierHistoryBytes: 64 * 1024 * 1024,
});
// Reserve worst-case unit duplication/audit overhead and the complete correction budget before execution.
const maxUnitDossierBytes = 2 * SOURCE_ANALYSIS_POLICY.maxStoredOutputBytes
  + SOURCE_ANALYSIS_POLICY.maxObservationsPerUnit * (8 * 240 + 1024 + 17 * 200);
const maxInitialDossierBytes = SOURCE_ANALYSIS_POLICY.maxDossierBytes
  - SOURCE_ANALYSIS_POLICY.maxCorrections * SOURCE_ANALYSIS_POLICY.maxCorrectionBytes - 64 * 1024;
export function estimateSourceDossierBytes(plan: Pick<SourceAnalysisPlan, "units" | "binding">): number {
  return plan.units.length * maxUnitDossierBytes + new TextEncoder().encode(JSON.stringify(plan.binding)).length + 64 * 1024;
}
export const SOURCE_CATEGORIES = ["premise", "protagonist", "point-of-view", "character", "relationship",
  "location", "institution", "world-fact", "rule", "chronology", "event", "turning-point", "theme",
  "tone", "style", "prose", "object", "knowledge", "unresolved-thread", "ambiguity", "contradiction"] as const;
const id = z.string().min(1).max(240).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(1_000);
export function sourceCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sourceCanonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => compare(a, b)).map(([k, v]) => `${JSON.stringify(k)}:${sourceCanonicalJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const sourceDigest = (value: unknown): string => sha256(sourceCanonicalJson(value));
export const sourceSorted = <T>(values: T[]): T[] => [...values].sort((a, b) => compare(sourceCanonicalJson(a), sourceCanonicalJson(b)));
export function sourceUnique<T>(values: T[]): T[] {
  return [...new Map(sourceSorted(values).map((value) => [sourceCanonicalJson(value), value])).values()];
}

export const AnalysisSourceSchema = z.object({
  metadata: z.object({ title: z.string().optional(), author: z.string().optional(), language: z.string().optional(),
    sourceFormat: z.enum(["txt", "html", "epub"]) }).strict(),
  chapters: z.array(z.object({ id, title: z.string(), order: z.number().int().nonnegative(),
    blocks: z.array(z.object({ type: z.enum(["heading", "paragraph"]), text: z.string(), excerptId: id }).strict()),
  }).strict()).min(1),
}).strict().superRefine((source, ctx) => {
  const chapters = source.chapters.map((c) => c.id);
  const excerpts = source.chapters.flatMap((c) => c.blocks.map((b) => b.excerptId));
  if (new Set(chapters).size !== chapters.length || new Set(excerpts).size !== excerpts.length
    || source.chapters.some((c, i) => c.order !== i)) ctx.addIssue({ code: "custom", message: "Source identities/order are invalid" });
});
export type AnalysisSource = z.infer<typeof AnalysisSourceSchema>;
export const SourceBindingSchema = z.object({ projectId: id, sourceVersionId: id, sourceFingerprint: digest,
  scopeVersionId: id, chapterIds: z.array(id).min(1), scopeFingerprint: digest }).strict();
export type SourceBinding = z.infer<typeof SourceBindingSchema>;
export const SourceEvidenceSchema = SourceBindingSchema.omit({ chapterIds: true }).extend({
  chapterId: id, excerptId: id, start: z.number().int().nonnegative(), end: z.number().int().positive(), digest,
}).strict();
export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>;

export function sourceBinding(projectId: string, sourceVersionId: string, scopeVersionId: string,
  source: AnalysisSource, chapterIds: string[]): SourceBinding {
  AnalysisSourceSchema.parse(source);
  if (!chapterIds.length || new Set(chapterIds).size !== chapterIds.length
    || chapterIds.some((selected) => !source.chapters.some((c) => c.id === selected))) throw new Error("source_scope_invalid");
  const ordered = source.chapters.filter((c) => chapterIds.includes(c.id)).map((c) => c.id);
  const identity = { projectId, sourceVersionId, sourceFingerprint: sourceDigest(source), scopeVersionId, chapterIds: ordered };
  return SourceBindingSchema.parse({ ...identity, scopeFingerprint: sourceDigest(identity) });
}

export function sourceEvidence(binding: SourceBinding, chapterId: string, excerptId: string,
  blockText: string, start = 0, end = blockText.length): SourceEvidence {
  const { chapterIds: _, ...exact } = binding;
  return SourceEvidenceSchema.parse({ ...exact, chapterId, excerptId, start, end, digest: sha256(blockText.slice(start, end)) });
}
function splitsSurrogate(value: string, offset: number): boolean {
  return offset > 0 && offset < value.length && /[\uD800-\uDBFF]/.test(value[offset - 1]!) && /[\uDC00-\uDFFF]/.test(value[offset]!);
}
export function resolveSourceEvidence(source: AnalysisSource, binding: SourceBinding, reference: SourceEvidence): string {
  SourceEvidenceSchema.parse(reference);
  const { chapterIds: _, ...exact } = binding;
  if (Object.entries(exact).some(([key, value]) => reference[key as keyof SourceEvidence] !== value)
    || !binding.chapterIds.includes(reference.chapterId)) throw new Error("source_evidence_binding_invalid");
  const block = source.chapters.find((c) => c.id === reference.chapterId)?.blocks.find((b) => b.excerptId === reference.excerptId);
  if (!block || reference.start >= reference.end || reference.end > block.text.length
    || splitsSurrogate(block.text, reference.start) || splitsSurrogate(block.text, reference.end)
    || sha256(block.text.slice(reference.start, reference.end)) !== reference.digest) throw new Error("source_evidence_range_invalid");
  return block.text.slice(reference.start, reference.end);
}

export const SourceUnitSchema = z.object({ id, order: z.number().int().nonnegative(), ranges: z.array(SourceEvidenceSchema).min(1),
  inputFingerprint: digest, contextFingerprint: digest, characters: z.number().int().positive(), contextBytes: z.number().int().positive(),
}).strict();
export type SourceUnit = z.infer<typeof SourceUnitSchema>;
export const SourceAnalysisPlanSchema = z.object({ schemaVersion: z.literal(1), id, binding: SourceBindingSchema,
  providerId: id, modelId: z.string().min(1).max(240), policyId: z.literal("source-analysis-v1"), promptVersion: z.literal("source-analysis-v1"),
  units: z.array(SourceUnitSchema).min(1).max(SOURCE_ANALYSIS_POLICY.maxUnits), fingerprint: digest,
  sourceCharacters: z.number().int().nonnegative(), sourceBytes: z.number().int().nonnegative(),
  cost: z.union([z.literal(0), z.null()]),
}).strict();
export type SourceAnalysisPlan = z.infer<typeof SourceAnalysisPlanSchema>;
export function sourceUnitContext(source: AnalysisSource, binding: SourceBinding, unit: Pick<SourceUnit, "ranges">) {
  return { schemaVersion: 1, evidence: unit.ranges.map((reference) => ({ reference, text: resolveSourceEvidence(source, binding, reference) })) };
}
export function planSourceAnalysis(binding: SourceBinding, source: AnalysisSource, providerId: string, modelId: string): SourceAnalysisPlan {
  const units: SourceUnit[] = [];
  const bindingBytes = new TextEncoder().encode(JSON.stringify(binding)).length;
  const append = (ranges: SourceEvidence[]) => {
    if (!ranges.length) return;
    if (units.length >= SOURCE_ANALYSIS_POLICY.maxUnits || (units.length + 1) * maxUnitDossierBytes + bindingBytes > maxInitialDossierBytes)
      throw new Error("source_dossier_scope_budget_exceeded: select fewer chapters and preview a new analysis");
    const context = sourceUnitContext(source, binding, { ranges });
    const contextBytes = new TextEncoder().encode(sourceCanonicalJson(context)).length;
    if (contextBytes > SOURCE_ANALYSIS_POLICY.maxContextBytes) throw new Error("source_context_overflow: select smaller source ranges");
    const input = { binding, providerId, modelId, policyId: SOURCE_ANALYSIS_POLICY.id, ranges };
    const inputFingerprint = sourceDigest(input);
    units.push({ id: `sau_${inputFingerprint.slice(0, 32)}`, order: units.length, ranges, inputFingerprint,
      contextFingerprint: sourceDigest(context), characters: context.evidence.reduce((sum, e) => sum + e.text.length, 0), contextBytes });
  };
  for (const chapter of source.chapters.filter((c) => binding.chapterIds.includes(c.id))) {
    let ranges: SourceEvidence[] = [];
    let characters = 0;
    let encodedBytes = 0;
    for (const block of chapter.blocks) {
      let start = 0;
      while (start < block.text.length) {
        let end = Math.min(start + SOURCE_ANALYSIS_POLICY.maxSourceCharacters, block.text.length);
        if (splitsSurrogate(block.text, end)) end -= 1;
        while (new TextEncoder().encode(JSON.stringify(block.text.slice(start, end))).length > SOURCE_ANALYSIS_POLICY.maxEncodedSourceBytes) {
          end = start + Math.floor((end - start) / 2);
          if (splitsSurrogate(block.text, end)) end -= 1;
        }
        const rangeBytes = new TextEncoder().encode(JSON.stringify(block.text.slice(start, end))).length;
        const range = sourceEvidence(binding, chapter.id, block.excerptId, block.text, start, end);
        if (characters + end - start > SOURCE_ANALYSIS_POLICY.maxSourceCharacters
          || ranges.length >= SOURCE_ANALYSIS_POLICY.maxRangesPerUnit || encodedBytes + rangeBytes > SOURCE_ANALYSIS_POLICY.maxEncodedSourceBytes) {
          append(ranges); ranges = []; characters = 0; encodedBytes = 0;
        }
        ranges.push(range); characters += end - start; encodedBytes += rangeBytes; start = end;
      }
    }
    append(ranges);
  }
  if (!units.length) throw new Error("source_empty: selected chapters contain no text");
  const content = { schemaVersion: 1 as const, binding, providerId, modelId, policyId: SOURCE_ANALYSIS_POLICY.id,
    promptVersion: SOURCE_ANALYSIS_POLICY.promptVersion, units,
    sourceCharacters: source.chapters.flatMap((c) => c.blocks).reduce((sum, b) => sum + b.text.length, 0),
    sourceBytes: new TextEncoder().encode(sourceCanonicalJson(source)).length,
    cost: providerId === "offline-source-analysis" ? 0 as const : null };
  const fingerprint = sourceDigest(content);
  return SourceAnalysisPlanSchema.parse({ ...content, id: `sap_${fingerprint.slice(0, 32)}`, fingerprint });
}

export const SourceObservationSchema = z.object({
  id, category: z.enum(SOURCE_CATEGORIES), identityKey: text, field: text, claim: text,
  classification: z.enum(["source-canon", "inference"]), aliases: z.array(text).max(16),
  references: z.array(id).max(32), evidence: z.array(SourceEvidenceSchema).min(1).max(32),
  uncertainty: z.string().max(1_000),
}).strict();
export type SourceObservation = z.infer<typeof SourceObservationSchema>;
export const SourceUnitOutputSchema = z.object({ schemaVersion: z.literal(1), observations: z.array(SourceObservationSchema).max(32) }).strict();
export type SourceUnitOutput = z.infer<typeof SourceUnitOutputSchema>;
export function validateSourceOutput(source: AnalysisSource, plan: SourceAnalysisPlan, unit: SourceUnit, value: unknown, stored = false): SourceUnitOutput {
  const output = SourceUnitOutputSchema.parse(value);
  if (new TextEncoder().encode(sourceCanonicalJson(output)).length > (stored ? SOURCE_ANALYSIS_POLICY.maxStoredOutputBytes : SOURCE_ANALYSIS_POLICY.maxOutputBytes)) throw new Error("source_output_oversized");
  const ids = new Set(output.observations.map((o) => o.id));
  if (ids.size !== output.observations.length) throw new Error("source_observation_duplicate_id");
  for (const observation of output.observations) {
    if (observation.references.some((ref) => !ids.has(ref))) throw new Error("source_observation_orphan_reference");
    for (const evidence of observation.evidence) {
      resolveSourceEvidence(source, plan.binding, evidence);
      if (!unit.ranges.some((r) => r.chapterId === evidence.chapterId && r.excerptId === evidence.excerptId
        && r.start <= evidence.start && r.end >= evidence.end)) throw new Error("source_evidence_outside_unit");
    }
  }
  return output;
}

export const SourceRecordSchema = SourceObservationSchema.extend({
  status: z.enum(["supported", "rejected"]), observationIds: z.array(id).min(1).max(SOURCE_ANALYSIS_POLICY.maxProvenance),
  evidence: z.array(SourceEvidenceSchema).min(1).max(100_000),
  aliases: z.array(text).max(SOURCE_ANALYSIS_POLICY.maxProvenance * 16), references: z.array(id).max(SOURCE_ANALYSIS_POLICY.maxRecords),
}).strict();
export type SourceRecord = z.infer<typeof SourceRecordSchema>;
export const SourceConflictSchema = z.object({ id, kind: z.enum(["ambiguity", "contradiction"]), recordIds: z.array(id).min(2), reason: text }).strict();
export const SourceProvenanceSchema = z.object({ observationId: id, jobId: id, unitId: id, attemptId: id,
  providerId: id, modelId: z.string(), contextFingerprint: digest, original: SourceObservationSchema }).strict();
export type SourceProvenance = z.infer<typeof SourceProvenanceSchema>;
export const SourceCorrectionSchema = z.object({ id, kind: z.enum(["field", "merge", "split", "reject", "evidence", "classification"]),
  intent: z.literal("source-analysis-correction"), reason: text, previousVersionId: id,
  operation: z.record(z.unknown()), beforeFingerprint: digest, afterFingerprint: digest,
}).strict();
export function assertSourceDossierBudget<T extends { records: unknown[]; conflicts: unknown[]; provenance: unknown[]; corrections: unknown[] }>(dossier: T): void {
  if (dossier.records.length > SOURCE_ANALYSIS_POLICY.maxRecords || dossier.conflicts.length > SOURCE_ANALYSIS_POLICY.maxConflicts
    || dossier.provenance.length > SOURCE_ANALYSIS_POLICY.maxProvenance || dossier.corrections.length > SOURCE_ANALYSIS_POLICY.maxCorrections)
    throw new Error("source_dossier_count_budget_exceeded: select a smaller scope or review a new analysis draft");
  if (dossier.corrections.some((c) => new TextEncoder().encode(JSON.stringify(c)).length > SOURCE_ANALYSIS_POLICY.maxCorrectionBytes))
    throw new Error("source_correction_byte_budget_exceeded: use a smaller correction with exact evidence");
  if (new TextEncoder().encode(JSON.stringify(dossier)).length > SOURCE_ANALYSIS_POLICY.maxDossierBytes)
    throw new Error("source_dossier_byte_budget_exceeded: select fewer chapters and preview a new analysis");
}
export const SourceDossierSchema = z.object({ schemaVersion: z.literal(1), projectId: id, planId: id, jobId: id,
  binding: SourceBindingSchema, records: z.array(SourceRecordSchema).max(SOURCE_ANALYSIS_POLICY.maxRecords),
  conflicts: z.array(SourceConflictSchema).max(SOURCE_ANALYSIS_POLICY.maxConflicts), provenance: z.array(SourceProvenanceSchema).max(SOURCE_ANALYSIS_POLICY.maxProvenance),
  corrections: z.array(SourceCorrectionSchema).max(SOURCE_ANALYSIS_POLICY.maxCorrections), materialFingerprint: digest, provenanceFingerprint: digest,
}).strict().superRefine((dossier, ctx) => {
  try { assertSourceDossierBudget(dossier); } catch (error) { ctx.addIssue({ code: "custom", message: (error as Error).message }); }
});
export type SourceDossier = z.infer<typeof SourceDossierSchema>;
export function sourceDossierFingerprints(dossier: Pick<SourceDossier, "binding" | "records" | "conflicts" | "provenance" | "corrections">) {
  return { materialFingerprint: sourceDigest({ binding: dossier.binding, records: sourceSorted(dossier.records), conflicts: sourceSorted(dossier.conflicts) }),
    provenanceFingerprint: sourceDigest({ provenance: sourceSorted(dossier.provenance), corrections: dossier.corrections }) };
}
export function sourceConflicts(records: SourceRecord[]): SourceDossier["conflicts"] {
  const active = records.filter((r) => r.status === "supported");
  const groups = new Map<string, SourceRecord[]>();
  for (const record of active) {
    const key = sourceCanonicalJson([record.category, record.identityKey, record.field]);
    const values = groups.get(key) ?? [];
    values.push(record); groups.set(key, values);
  }
  const conflicts: SourceDossier["conflicts"] = [];
  for (const values of groups.values()) if (new Set(values.map((v) => v.claim)).size > 1) {
    const recordIds = values.map((v) => v.id).sort(compare);
    conflicts.push({ id: `sc_${sourceDigest(recordIds).slice(0, 32)}`, kind: "contradiction", recordIds, reason: "Different claims for the same analytical identity and field" });
  }
  const names = new Map<string, SourceRecord[]>(), seen = new Set<string>();
  for (const identity of active.filter((r) => r.category === "character" && r.field === "identity")) {
    for (const name of new Set([identity.identityKey, ...identity.aliases].map((v) => v.normalize("NFC").toLowerCase()))) {
      const values = names.get(name) ?? []; values.push(identity); names.set(name, values);
    }
  }
  for (const values of names.values()) {
    if (new Set(values.map((v) => v.identityKey)).size < 2) continue;
    const recordIds = values.map((v) => v.id).sort(compare), key = sourceCanonicalJson(recordIds);
    if (seen.has(key)) continue; seen.add(key);
    conflicts.push({ id: `sa_${sourceDigest(recordIds).slice(0, 32)}`, kind: "ambiguity", recordIds, reason: "Unconfirmed identity match; separate identities retained" });
  }
  return sourceSorted(conflicts);
}
export function consolidateSourceDossier(plan: SourceAnalysisPlan, jobId: string, provenance: SourceProvenance[]): SourceDossier {
  if (provenance.length > SOURCE_ANALYSIS_POLICY.maxProvenance) throw new Error("source_dossier_provenance_budget_exceeded: select fewer chapters");
  const map = new Map<string, SourceRecord>();
  const observationToRecord = new Map<string, string>();
  for (const origin of sourceSorted(provenance)) {
    const o = origin.original;
    const material = { category: o.category, identityKey: o.identityKey, field: o.field, claim: o.claim,
      classification: o.classification, uncertainty: o.uncertainty };
    const recordId = `sr_${sourceDigest({ projectId: plan.binding.projectId, material }).slice(0, 32)}`;
    observationToRecord.set(origin.observationId, recordId);
    const previous = map.get(recordId);
    map.set(recordId, { ...o, id: recordId, status: "supported",
      aliases: sourceUnique([...(previous?.aliases ?? []), ...o.aliases]),
      references: sourceUnique([...(previous?.references ?? []), ...o.references]),
      evidence: sourceUnique([...(previous?.evidence ?? []), ...o.evidence]),
      observationIds: sourceUnique([...(previous?.observationIds ?? []), origin.observationId]) });
  }
  const records = sourceSorted([...map.values()].map((record) => ({ ...record,
    references: sourceUnique(record.references.map((r) => {
      const target = observationToRecord.get(r); if (!target) throw new Error("source_dossier_orphan_reference"); return target;
    })) })));
  const dossier = { schemaVersion: 1 as const, projectId: plan.binding.projectId, planId: plan.id, jobId,
    binding: plan.binding, records, conflicts: sourceConflicts(records), provenance: sourceSorted(provenance), corrections: [] };
  assertSourceDossierBudget({ ...dossier, materialFingerprint: "0".repeat(64), provenanceFingerprint: "0".repeat(64) });
  return SourceDossierSchema.parse({ ...dossier, ...sourceDossierFingerprints(dossier) });
}
export function assertSourceDossier(dossier: SourceDossier, source: AnalysisSource, binding: SourceBinding): void {
  SourceDossierSchema.parse(dossier);
  if (dossier.projectId !== binding.projectId || sourceCanonicalJson(dossier.binding) !== sourceCanonicalJson(binding)) throw new Error("source_dossier_binding_invalid");
  const fingerprints = sourceDossierFingerprints(dossier);
  if (dossier.materialFingerprint !== fingerprints.materialFingerprint || dossier.provenanceFingerprint !== fingerprints.provenanceFingerprint) throw new Error("source_dossier_fingerprint_invalid");
  const ids = new Set(dossier.records.map((r) => r.id));
  const observations = new Set(dossier.provenance.map((p) => p.observationId));
  if (ids.size !== dossier.records.length || observations.size !== dossier.provenance.length) throw new Error("source_dossier_duplicate_id");
  for (const r of dossier.records) {
    if (r.references.some((ref) => !ids.has(ref)) || r.observationIds.some((ref) => !observations.has(ref))) throw new Error("source_dossier_orphan_reference");
    r.evidence.forEach((ref) => resolveSourceEvidence(source, binding, ref));
  }
  dossier.provenance.forEach((p) => p.original.evidence.forEach((ref) => resolveSourceEvidence(source, binding, ref)));
  if (sourceCanonicalJson(dossier.conflicts) !== sourceCanonicalJson(sourceConflicts(dossier.records))) throw new Error("source_dossier_conflicts_invalid");
}
