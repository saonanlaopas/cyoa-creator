import { z } from "zod";
import { RepairExpectedBaseSchema, type RepairExpectedBase, type RepairFingerprint } from "./repair-plan-contract.js";
import {
  RepairChoicePlanSchema,
  RepairEntityKindSchema,
  RepairNarrativeThreadSchema,
  RepairPassagePlanSchema,
  validateCanonicalRepairEntityPayload,
} from "./repair-entity-contract.js";
import { REPAIR_PROPOSAL_POLICY_V1 } from "./repair-proposal-contract.js";

export const repairProposalCandidateSchema = Object.freeze({ id: "cyoa.repair-proposal-unit-candidate", version: 1 });

const Id = z.string().trim().min(1).max(256);
const Fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
const FindingIds = z.array(Fingerprint).min(1).max(REPAIR_PROPOSAL_POLICY_V1.maxFindingsPerGroup);
const CandidateCommonSchema = z.object({
  logicalKey: Id,
  groupKey: Id,
  sourceFindingFingerprints: FindingIds,
  expectedBase: RepairExpectedBaseSchema,
}).strict();

const UpdatePassageSchema = CandidateCommonSchema.extend({
  kind: z.literal("update-entity"), entityKind: z.literal("passage"), entityId: Id, after: RepairPassagePlanSchema,
}).strict();
const UpdateChoiceSchema = CandidateCommonSchema.extend({
  kind: z.literal("update-entity"), entityKind: z.literal("choice"), entityId: Id, after: RepairChoicePlanSchema,
}).strict();
const UpdateThreadSchema = CandidateCommonSchema.extend({
  kind: z.literal("update-entity"), entityKind: z.literal("thread"), entityId: Id, after: RepairNarrativeThreadSchema,
}).strict();
const UpdateArtifactSchema = CandidateCommonSchema.extend({
  kind: z.literal("update-entity"),
  entityKind: RepairEntityKindSchema.exclude(["passage", "choice", "thread"]),
  entityId: Id,
  after: z.record(z.string(), z.unknown()),
}).strict();
const AddChoiceSchema = CandidateCommonSchema.omit({ expectedBase: true }).extend({
  kind: z.literal("add-entity"), entityKind: z.literal("choice"), entityId: Id,
  authorizedParentTargetKey: Id, generatedLogicalKey: Id, after: RepairChoicePlanSchema,
}).strict();
const AddThreadSchema = CandidateCommonSchema.omit({ expectedBase: true }).extend({
  kind: z.literal("add-entity"), entityKind: z.literal("thread"), entityId: Id,
  authorizedParentTargetKey: Id, generatedLogicalKey: Id, after: RepairNarrativeThreadSchema,
}).strict();
const ProseCandidateSchema = CandidateCommonSchema.extend({
  kind: z.literal("create-passage-draft-candidate"), entityKind: z.literal("passage-prose"), entityId: Id,
  proposedProse: z.string().min(1).max(120_000), requiresUnlock: z.boolean(),
}).strict();

export const RepairProposalCandidateOperationSchema = z.union([
  UpdatePassageSchema, UpdateChoiceSchema, UpdateThreadSchema, UpdateArtifactSchema,
  AddChoiceSchema, AddThreadSchema, ProseCandidateSchema,
]);
export type RepairProposalCandidateOperation = z.infer<typeof RepairProposalCandidateOperationSchema>;

export const RepairProposalUnitCandidateSchema = z.object({
  schemaId: z.literal(repairProposalCandidateSchema.id),
  schemaVersion: z.literal(repairProposalCandidateSchema.version),
  repairPlanDefinitionFingerprint: Fingerprint,
  generationFingerprint: Fingerprint,
  unitId: Id,
  contextFingerprint: Fingerprint,
  generatedIds: z.array(z.object({
    logicalKey: Id, entityKind: z.enum(["choice", "thread"]), authorizedParentTargetKey: Id, id: Id,
  }).strict()).max(REPAIR_PROPOSAL_POLICY_V1.maxGeneratedIds),
  groups: z.array(z.object({
    logicalKey: Id,
    label: z.string().trim().min(1).max(300),
    summary: z.string().trim().max(2_000),
    sourceFindingFingerprints: FindingIds,
    authorizedTargetKeys: z.array(Id).min(1).max(REPAIR_PROPOSAL_POLICY_V1.maxTargetsPerUnit),
    dependsOnGroupKeys: z.array(Id).max(REPAIR_PROPOSAL_POLICY_V1.maxGroupsPerProposal),
    operations: z.array(RepairProposalCandidateOperationSchema).min(1).max(REPAIR_PROPOSAL_POLICY_V1.maxOperationsPerUnit),
  }).strict()).min(1).max(REPAIR_PROPOSAL_POLICY_V1.maxGroupsPerProposal),
}).strict();
export type RepairProposalUnitCandidate = z.infer<typeof RepairProposalUnitCandidateSchema>;

export interface RepairProposalCandidateContractContext {
  repairPlanDefinitionFingerprint: string;
  generationFingerprint: string;
  unitId: string;
  contextFingerprint: string;
  authorizedTargetKeys: string[];
  expectedBases: RepairExpectedBase[];
  fingerprint: RepairFingerprint;
}

export function validateRepairProposalUnitCandidate(
  value: unknown,
  context: RepairProposalCandidateContractContext,
): RepairProposalUnitCandidate {
  const candidate = RepairProposalUnitCandidateSchema.parse(value);
  if (canonical(candidate) !== canonical(value)) throw new Error("Repair-proposal candidate contains unknown, omitted, or defaulted fields");
  if (candidate.repairPlanDefinitionFingerprint !== context.repairPlanDefinitionFingerprint
    || candidate.generationFingerprint !== context.generationFingerprint || candidate.unitId !== context.unitId
    || candidate.contextFingerprint !== context.contextFingerprint) throw new Error("Repair-proposal generation candidate lineage is invalid");

  const authorized = new Set(context.authorizedTargetKeys);
  const expectedByTarget = new Map(context.expectedBases.map((base) => [base.targetKey, base]));
  assertUnique(candidate.groups.map((group) => group.logicalKey), "Repair-proposal candidate group logical keys are duplicated");
  assertUnique(candidate.generatedIds.map((item) => `${item.entityKind}:${item.logicalKey}`), "Repair-proposal candidate generated logical keys are duplicated");
  assertUnique(candidate.generatedIds.map((item) => item.id), "Repair-proposal candidate generated IDs are duplicated");
  const operations = candidate.groups.flatMap((group) => group.operations);
  if (operations.length > REPAIR_PROPOSAL_POLICY_V1.maxOperationsPerUnit) throw new Error("Repair-proposal candidate operation limit exceeded");
  assertUnique(operations.map((operation) => operation.logicalKey), "Repair-proposal candidate operation logical keys are duplicated");

  const groupKeys = new Set(candidate.groups.map((group) => group.logicalKey));
  const declarations = new Map(candidate.generatedIds.map((item) => [`${item.entityKind}:${item.logicalKey}`, item]));
  const producedIds = new Set<string>();
  const producerGroupById = new Map<string, string>();
  for (const group of candidate.groups) {
    assertUnique(group.sourceFindingFingerprints, "Repair-proposal candidate group finding lineage is duplicated");
    assertUnique(group.authorizedTargetKeys, "Repair-proposal candidate group target authority is duplicated");
    assertUnique(group.dependsOnGroupKeys, "Repair-proposal candidate group dependencies are duplicated");
    if (group.dependsOnGroupKeys.some((key) => key === group.logicalKey || !groupKeys.has(key))) {
      throw new Error("Repair-proposal candidate group dependency is invalid");
    }
    if (group.authorizedTargetKeys.some((key) => !authorized.has(key))) throw new Error("Repair-proposal generation candidate target lineage is invalid");
    for (const operation of group.operations) {
      if (operation.groupKey !== group.logicalKey) throw new Error("Repair-proposal candidate operation group mismatch");
      assertUnique(operation.sourceFindingFingerprints, "Repair-proposal candidate operation finding lineage is duplicated");
      if (operation.kind === "add-entity") {
        if (!authorized.has(operation.authorizedParentTargetKey) || !group.authorizedTargetKeys.includes(operation.authorizedParentTargetKey)) {
          throw new Error("Repair-proposal candidate generated entity parent is unauthorized");
        }
        validateCanonicalRepairEntityPayload(operation.entityKind, operation.after);
        const declaration = declarations.get(`${operation.entityKind}:${operation.generatedLogicalKey}`);
        const expectedId = deterministicRepairEntityId({
          repairPlanDefinitionFingerprint: context.repairPlanDefinitionFingerprint,
          generationFingerprint: context.generationFingerprint,
          unitId: context.unitId,
          groupLogicalKey: group.logicalKey,
          entityKind: operation.entityKind,
          logicalKey: operation.generatedLogicalKey,
        }, context.fingerprint);
        if (!declaration || declaration.id !== operation.entityId || operation.after.id !== operation.entityId
          || declaration.authorizedParentTargetKey !== operation.authorizedParentTargetKey || operation.entityId !== expectedId) {
          throw new Error("Repair-proposal candidate generated declaration/producer mismatch");
        }
        producedIds.add(operation.entityId);
        producerGroupById.set(operation.entityId, group.logicalKey);
      } else {
        const expected = expectedByTarget.get(operation.expectedBase.targetKey);
        if (!expected || canonical(expected) !== canonical(operation.expectedBase)
          || !authorized.has(operation.expectedBase.targetKey) || !group.authorizedTargetKeys.includes(operation.expectedBase.targetKey)) {
          throw new Error("Repair-proposal candidate expected base is invalid");
        }
        if (operation.kind === "update-entity") validateCanonicalRepairEntityPayload(operation.entityKind, operation.after);
      }
    }
  }
  if (candidate.generatedIds.some((item) => !producedIds.has(item.id))) throw new Error("Repair-proposal candidate generated declaration lacks a producer");
  for (const group of candidate.groups) {
    for (const operation of group.operations) {
      const references = collectStrings(operation.kind === "create-passage-draft-candidate" ? operation.proposedProse : operation.after);
      for (const [id, producerGroup] of producerGroupById) {
        if (references.has(id) && producerGroup !== group.logicalKey && !group.dependsOnGroupKeys.includes(producerGroup)) {
          throw new Error(`Repair-proposal candidate group lacks dependency on generated entity ${id}`);
        }
      }
    }
  }
  assertAcyclic(candidate.groups);
  return candidate;
}

export function deterministicRepairEntityId(input: {
  repairPlanDefinitionFingerprint: string; generationFingerprint: string; unitId: string;
  groupLogicalKey: string; entityKind: "choice" | "thread"; logicalKey: string;
}, fingerprint: RepairFingerprint): string {
  return `rpg_${input.entityKind}_${fingerprint(input).slice(0, 32)}`;
}

function assertAcyclic(groups: RepairProposalUnitCandidate["groups"]): void {
  const byKey = new Map(groups.map((group) => [group.logicalKey, group]));
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) throw new Error("Repair-proposal candidate group dependency cycle");
    if (visited.has(key)) return;
    const group = byKey.get(key); if (!group) throw new Error("Repair-proposal candidate group dependency is invalid");
    visiting.add(key); group.dependsOnGroupKeys.forEach(visit); visiting.delete(key); visited.add(key);
  };
  groups.forEach((group) => visit(group.logicalKey));
}

function assertUnique(values: string[], message: string): void {
  if (new Set(values).size !== values.length) throw new Error(message);
}

function collectStrings(value: unknown, result = new Set<string>()): Set<string> {
  if (typeof value === "string") result.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, result));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach((item) => collectStrings(item, result));
  return result;
}

function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
