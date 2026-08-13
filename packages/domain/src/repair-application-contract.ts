import { z } from "zod";
import { RepairExpectedBaseSchema } from "./repair-plan-contract.js";

export const repairApplicationSchema = Object.freeze({ id: "cyoa.repair-application", version: 1 });
export const REPAIR_APPLICATION_POLICY_V1 = Object.freeze({
  id: "foundation-6c-v1" as const,
  maxSelectedGroups: 48,
  maxOperations: 768,
  maxAuditBytes: 4_000_000,
});

const Id = z.string().trim().min(1).max(256);
const Fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
const Ids = z.array(Id).max(REPAIR_APPLICATION_POLICY_V1.maxOperations);

export const RepairFindingDispositionSchema = z.object({
  sourceKind: z.enum([
    "foundation-3-static-validation", "foundation-5a-runtime",
    "foundation-5b-playtest", "foundation-5c-narrative-review",
  ]),
  sourceFingerprint: Fingerprint,
  status: z.enum([
    "repair-applied", "deterministically-resolved", "still-present",
    "superseded-by-changed-base", "requires-revalidation",
    "requires-human-review", "requires-narrative-rereview",
  ]),
  verificationKind: z.enum(["static", "exact-simulation-replay", "historical-only"]),
  message: z.string().min(1).max(20_000),
  evidence: z.record(z.string(), z.unknown()),
}).strict();
export type RepairFindingDisposition = z.infer<typeof RepairFindingDispositionSchema>;

const ResultVersionSchema = z.object({
  operationId: Id,
  entityKind: Id,
  entityId: Id,
  versionId: Id,
}).strict();

const StalenessEventSchema = z.object({
  id: Id,
  reasonCode: Id,
  sourceEntityKind: Id,
  sourceEntityId: Id,
  draftVersionId: Id,
  passageId: Id,
}).strict();

export const RepairDraftProvenanceSchema = z.object({
  applicationId: Id,
  applicationDefinitionFingerprint: Fingerprint,
  proposalId: Id,
  proposalArtifactVersionId: Id,
  proposalDefinitionFingerprint: Fingerprint,
  repairPlanId: Id,
  repairPlanArtifactVersionId: Id,
  repairPlanDefinitionFingerprint: Fingerprint,
  operationId: Id,
  sourceFindingFingerprints: z.array(Fingerprint).min(1).max(REPAIR_APPLICATION_POLICY_V1.maxOperations),
  passageId: Id,
  passagePlanBaseVersionId: Id,
  expectedCurrentDraftVersionId: Id.nullable(),
  expectedAcceptedDraftVersionId: Id.nullable(),
  upstreamVersions: z.record(z.string(), Id),
  neighboringDraftVersions: z.record(z.string(), Id),
  draftVersionId: Id,
}).strict();
export type RepairDraftProvenance = z.infer<typeof RepairDraftProvenanceSchema>;

export const RepairApplicationDefinitionSchema = z.object({
  policy: z.object({ id: z.literal(REPAIR_APPLICATION_POLICY_V1.id) }).strict(),
  proposalId: Id,
  proposalArtifactVersionId: Id,
  proposalDefinitionFingerprint: Fingerprint,
  explicitlySelectedGroupIds: z.array(Id).min(1).max(REPAIR_APPLICATION_POLICY_V1.maxSelectedGroups),
  requiredDependencyGroupIds: z.array(Id).max(REPAIR_APPLICATION_POLICY_V1.maxSelectedGroups),
  effectiveGroupIds: z.array(Id).min(1).max(REPAIR_APPLICATION_POLICY_V1.maxSelectedGroups),
  operationIds: Ids.min(1),
  expectedBases: z.array(RepairExpectedBaseSchema).min(1),
}).strict();
export type RepairApplicationDefinition = z.infer<typeof RepairApplicationDefinitionSchema>;

export const RepairApplicationRecordSchema = z.object({
  schemaId: z.literal(repairApplicationSchema.id),
  schemaVersion: z.literal(repairApplicationSchema.version),
  id: Id,
  projectId: Id,
  proposalId: Id,
  proposalArtifactVersionId: Id,
  proposalDefinitionFingerprint: Fingerprint,
  repairPlanId: Id,
  repairPlanArtifactVersionId: Id,
  repairPlanDefinitionFingerprint: Fingerprint,
  explicitlySelectedGroupIds: z.array(Id).min(1).max(REPAIR_APPLICATION_POLICY_V1.maxSelectedGroups),
  requiredDependencyGroupIds: z.array(Id).max(REPAIR_APPLICATION_POLICY_V1.maxSelectedGroups),
  effectiveGroupIds: z.array(Id).min(1).max(REPAIR_APPLICATION_POLICY_V1.maxSelectedGroups),
  operationIds: Ids.min(1),
  expectedBases: z.array(RepairExpectedBaseSchema).min(1),
  generatedEntityIds: z.array(z.object({ entityKind: z.enum(["choice", "thread"]), entityId: Id }).strict()),
  previewFingerprint: Fingerprint,
  definitionFingerprint: Fingerprint,
  validationFingerprint: Fingerprint,
  policy: z.object({ id: z.literal(REPAIR_APPLICATION_POLICY_V1.id) }).strict(),
  preApplyVersions: z.record(z.string(), z.string().nullable()),
  resultingVersions: z.array(ResultVersionSchema),
  stalenessEvents: z.array(StalenessEventSchema),
  verification: z.object({
    checks: z.array(z.object({
      kind: z.enum(["static", "exact-simulation-replay", "historical-only"]),
      sourceFingerprint: Fingerprint,
      bounded: z.boolean(),
      description: z.string().min(1).max(20_000),
    }).strict()),
    dispositions: z.array(RepairFindingDispositionSchema),
  }).strict(),
  result: z.literal("applied"),
  appliedAt: z.string().datetime(),
}).strict();
export type RepairApplicationRecord = z.infer<typeof RepairApplicationRecordSchema>;

export function repairApplicationDefinitionFromRecord(record: RepairApplicationRecord): RepairApplicationDefinition {
  return RepairApplicationDefinitionSchema.parse({
    policy: record.policy,
    proposalId: record.proposalId,
    proposalArtifactVersionId: record.proposalArtifactVersionId,
    proposalDefinitionFingerprint: record.proposalDefinitionFingerprint,
    explicitlySelectedGroupIds: record.explicitlySelectedGroupIds,
    requiredDependencyGroupIds: record.requiredDependencyGroupIds,
    effectiveGroupIds: record.effectiveGroupIds,
    operationIds: record.operationIds,
    expectedBases: record.expectedBases,
  });
}
