import { z } from "zod";
import { SourceEvidenceSchema, SourceObservationSchema, SourceDossierSchema, assertSourceDossier,
  sourceCanonicalJson, sourceConflicts, sourceDigest, sourceDossierFingerprints, sourceSorted, sourceUnique,
  type AnalysisSource, type SourceDossier, type SourceRecord } from "./source-analysis.js";

const id = z.string().min(1).max(240).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const common = { intent: z.literal("source-analysis-correction"), reason: z.string().trim().min(1).max(1_000), previousVersionId: id };
export const SourceCorrectionOperationSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("field"), recordId: id,
    changes: SourceObservationSchema.pick({ category: true, identityKey: true, field: true, claim: true, aliases: true, references: true, uncertainty: true }).partial().strict(),
    evidence: z.array(SourceEvidenceSchema).min(1).max(100_000) }).strict(),
  z.object({ ...common, kind: z.literal("merge"), recordIds: z.array(id).min(2).max(32), targetId: id }).strict(),
  z.object({ ...common, kind: z.literal("split"), recordId: id,
    children: z.array(z.object({ id, identityKey: z.string().min(1).max(1_000), claim: z.string().min(1).max(1_000),
      evidence: z.array(SourceEvidenceSchema).min(1).max(100_000) }).strict()).min(2).max(32),
    assignments: z.array(z.object({ recordId: id, replacementIds: z.array(id).min(1).max(32) }).strict()).max(10_000) }).strict(),
  z.object({ ...common, kind: z.literal("reject"), recordId: id }).strict(),
  z.object({ ...common, kind: z.literal("evidence"), recordId: id,
    evidence: z.array(SourceEvidenceSchema).min(1).max(100_000) }).strict(),
  z.object({ ...common, kind: z.literal("classification"), recordId: id,
    classification: z.enum(["source-canon", "inference"]), evidence: z.array(SourceEvidenceSchema).min(1).max(100_000) }).strict(),
]);
export type SourceCorrectionOperation = z.infer<typeof SourceCorrectionOperationSchema>;

export function correctSourceDossier(previous: SourceDossier, value: unknown, source: AnalysisSource): SourceDossier {
  const operation = SourceCorrectionOperationSchema.parse(value);
  const dossier: SourceDossier = structuredClone(previous);
  const lookup = (target: string): SourceRecord => {
    const record = dossier.records.find((r) => r.id === target);
    if (!record || record.status !== "supported") throw new Error("source_correction_target_invalid");
    return record;
  };
  if (operation.kind === "merge") {
    if (new Set(operation.recordIds).size !== operation.recordIds.length || !operation.recordIds.includes(operation.targetId)) throw new Error("source_merge_mapping_invalid");
    const records = operation.recordIds.map(lookup);
    if (records.some((r) => r.category !== "character" || r.field !== "identity")) throw new Error("source_merge_requires_identities");
    const target = lookup(operation.targetId);
    target.aliases = sourceUnique(records.flatMap((r) => [r.identityKey, ...r.aliases]));
    target.observationIds = sourceUnique(records.flatMap((r) => r.observationIds));
    target.evidence = sourceUnique(records.flatMap((r) => r.evidence));
    // A mixed epistemic merge never upgrades an inferred identity to source canon.
    if (records.some((r) => r.classification === "inference")) target.classification = "inference";
    for (const record of dossier.records) {
      record.references = sourceUnique(record.references.map((ref) => operation.recordIds.includes(ref) ? target.id : ref));
      if (operation.recordIds.includes(record.id) && record.id !== target.id) record.status = "rejected";
    }
  } else if (operation.kind === "split") {
    const parent = lookup(operation.recordId);
    if (parent.category !== "character" || parent.field !== "identity") throw new Error("source_split_requires_identity");
    const childIds = operation.children.map((c) => c.id);
    if (new Set(childIds).size !== childIds.length || childIds.some((child) => dossier.records.some((r) => r.id === child))) throw new Error("source_split_duplicate_identity");
    const originalEvidence = new Set(parent.evidence.map(sourceCanonicalJson));
    const assignedEvidence = new Set(operation.children.flatMap((c) => c.evidence).map(sourceCanonicalJson));
    if (originalEvidence.size !== assignedEvidence.size || [...originalEvidence].some((e) => !assignedEvidence.has(e))) throw new Error("source_split_evidence_assignment_invalid");
    const dependents = dossier.records.filter((r) => r.references.includes(parent.id));
    if (new Set(operation.assignments.map((a) => a.recordId)).size !== operation.assignments.length
      || operation.assignments.length !== dependents.length
      || operation.assignments.some((a) => !dependents.some((r) => r.id === a.recordId) || a.replacementIds.some((ref) => !childIds.includes(ref)))) throw new Error("source_split_dependent_assignment_required");
    for (const dependent of dependents) {
      const assignment = operation.assignments.find((a) => a.recordId === dependent.id)!;
      dependent.references = sourceUnique(dependent.references.flatMap((ref) => ref === parent.id ? assignment.replacementIds : [ref]));
    }
    parent.status = "rejected";
    for (const child of operation.children) dossier.records.push({ ...structuredClone(parent), ...child, status: "supported", aliases: [], references: [] });
  } else {
    const record = lookup(operation.recordId);
    if (operation.kind === "reject") record.status = "rejected";
    if (operation.kind === "field") Object.assign(record, operation.changes, { evidence: operation.evidence });
    if (operation.kind === "evidence") record.evidence = operation.evidence;
    if (operation.kind === "classification") Object.assign(record, { classification: operation.classification, evidence: operation.evidence });
  }
  dossier.records = sourceSorted(dossier.records);
  dossier.conflicts = sourceConflicts(dossier.records);
  const afterFingerprint = sourceDossierFingerprints(dossier).materialFingerprint;
  dossier.corrections.push({ id: `src_${sourceDigest(operation).slice(0, 32)}`, kind: operation.kind,
    intent: operation.intent, reason: operation.reason, previousVersionId: operation.previousVersionId,
    operation, beforeFingerprint: previous.materialFingerprint, afterFingerprint });
  Object.assign(dossier, sourceDossierFingerprints(dossier));
  assertSourceDossier(dossier, source, dossier.binding);
  return SourceDossierSchema.parse(dossier);
}
