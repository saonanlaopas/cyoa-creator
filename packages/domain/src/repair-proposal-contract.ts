import { z } from "zod";
import {
  RepairExpectedBaseSchema,
  type RepairExpectedBase,
  type RepairFingerprint,
  type RepairPlanDefinition,
} from "./repair-plan-contract.js";

export const repairProposalSchema = Object.freeze({ id: "cyoa.repair-proposal", version: 1 });

export const REPAIR_PROPOSAL_POLICY_V1 = Object.freeze({
  id: "foundation-6b-v1" as const,
  maxTargetsPerUnit: 4,
  maxUnits: 24,
  maxContextBytesPerUnit: 160_000,
  maxEstimatedInputTokensPerUnit: 24_000,
  maxOutputTokensPerUnit: 8_000,
  maxOperationsPerUnit: 16,
  maxGroupsPerProposal: 48,
  maxGeneratedIds: 48,
  maxFindingsPerGroup: 8,
  maxProposalBytes: 2_000_000,
  maxAttemptsPerUnit: 3,
  maxRepairsPerAttempt: 1,
  maxRepairInputBytes: 128_000,
});

const Id = z.string().trim().min(1).max(256);
const Fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
const JsonObject = z.record(z.string(), z.unknown());
const FindingIds = z.array(Fingerprint).min(1).max(REPAIR_PROPOSAL_POLICY_V1.maxFindingsPerGroup);
const EntityKind = z.enum([
  "passage", "choice", "thread", "mechanic", "relationship", "canon-fact", "route",
  "route-act", "route-decision", "route-reconvergence", "route-ending-hook", "ending",
]);

const FieldDiffSchema = z.object({
  field: Id,
  before: z.unknown().optional(),
  after: z.unknown().optional(),
}).strict();

const OperationCommon = z.object({
  id: Id,
  groupId: Id,
  logicalKey: Id,
  entityId: Id,
  targetKey: Id,
  fieldDiffs: z.array(FieldDiffSchema).min(1).max(1_000),
  sourceFindingFingerprints: FindingIds,
});

const UpdateOperationSchema = OperationCommon.extend({
  kind: z.literal("update-entity"),
  entityKind: EntityKind,
  expectedBase: RepairExpectedBaseSchema,
  authorizedParentTargetKey: z.null(),
  before: JsonObject,
  after: JsonObject,
  requiresUnlock: z.literal(false),
}).strict();

const AddOperationSchema = OperationCommon.extend({
  kind: z.literal("add-entity"),
  entityKind: z.enum(["choice", "thread"]),
  expectedBase: z.null(),
  authorizedParentTargetKey: Id,
  before: z.null(),
  after: JsonObject,
  requiresUnlock: z.literal(false),
}).strict();

const ProseOperationSchema = OperationCommon.extend({
  kind: z.literal("create-passage-draft-candidate"),
  entityKind: z.literal("passage-prose"),
  expectedBase: RepairExpectedBaseSchema,
  authorizedParentTargetKey: z.null(),
  before: z.null(),
  after: z.object({ proposedProse: z.string().min(1).max(120_000) }).strict(),
  requiresUnlock: z.boolean(),
}).strict();

export const RepairProposalOperationSchema = z.discriminatedUnion("kind", [
  UpdateOperationSchema,
  AddOperationSchema,
  ProseOperationSchema,
]);
export type RepairProposalOperation = z.infer<typeof RepairProposalOperationSchema>;

const GroupSchema = z.object({
  id: Id,
  logicalKey: Id,
  label: z.string().trim().min(1).max(300),
  summary: z.string().trim().max(2_000),
  sourceFindingFingerprints: FindingIds,
  authorizedTargetKeys: z.array(Id).min(1).max(REPAIR_PROPOSAL_POLICY_V1.maxTargetsPerUnit),
  operationIds: z.array(Id).min(1).max(REPAIR_PROPOSAL_POLICY_V1.maxOperationsPerUnit),
  dependsOnGroupIds: z.array(Id).max(REPAIR_PROPOSAL_POLICY_V1.maxGroupsPerProposal),
  expectedImpactNodeIds: z.array(Id).max(1_000),
  validation: z.object({ status: z.literal("valid"), errors: z.array(z.string()).max(0), warnings: z.array(z.string()).max(100) }).strict(),
}).strict();

const PassageFindingSchema = z.object({
  code: Id,
  severity: z.enum(["error", "warning", "info"]),
  entityType: z.enum(["project", "act", "sequence", "passage", "choice", "thread", "mechanic", "route", "ending"]),
  entityId: Id,
  message: z.string().min(1).max(20_000),
  evidence: z.array(z.string().max(20_000)).max(100),
  suggestion: z.string().max(20_000),
  acknowledged: z.boolean(),
  overrideRationale: z.string().max(20_000).optional(),
}).strict();

const BudgetItemSchema = z.object({ id: Id, target: z.number(), planned: z.number(), difference: z.number() }).strict();
const PassageValidationSchema = z.object({
  findings: z.array(PassageFindingSchema),
  budgets: z.object({
    project: z.object({ target: z.number(), planned: z.number(), difference: z.number() }).strict(),
    acts: z.array(BudgetItemSchema), sequences: z.array(BudgetItemSchema), routes: z.array(BudgetItemSchema),
  }).strict(),
  coverage: z.object({
    reachablePassageIds: z.array(Id), unreachablePassageIds: z.array(Id),
    endingCoverage: z.array(z.object({ endingId: Id, incomingPassageIds: z.array(Id), plausible: z.boolean() }).strict()),
    routeCoverage: z.array(z.object({ routeId: Id, passageCount: z.number().int().min(0), endingCount: z.number().int().min(0) }).strict()),
    pathWords: z.object({ minimum: z.number().nullable(), maximum: z.number().nullable(), representative: z.number().nullable(), truncated: z.boolean() }).strict(),
    mechanicCoverage: z.array(z.object({ key: Id, reads: z.array(Id), writes: z.array(Id) }).strict()),
  }).strict(),
}).strict();

const PlanningFindingSchema = z.object({
  code: Id,
  severity: z.enum(["error", "warning", "info"]),
  artifactId: z.enum(["brief", "bible", "routes", "endings", "mechanics"]),
  entityId: Id.optional(), path: z.string().max(2_000).optional(),
  message: z.string().min(1).max(20_000), suggestion: z.string().max(20_000).optional(),
}).strict();

const ValidationSchema = z.object({
  status: z.literal("valid"),
  errors: z.array(z.string()).max(0),
  warnings: z.array(z.string().max(20_000)).max(10_000),
  passageValidation: PassageValidationSchema,
  planningFindings: z.array(PlanningFindingSchema),
  resultingEntityFingerprints: z.array(z.object({ entityKind: Id, entityId: Id, fingerprint: Fingerprint }).strict()),
}).strict();

export const RepairProposalRecordSchema = z.object({
  schemaId: z.literal(repairProposalSchema.id),
  schemaVersion: z.literal(repairProposalSchema.version),
  id: Id,
  projectId: Id,
  repairPlanId: Id,
  repairPlanArtifactVersionId: Id,
  repairPlanDefinitionFingerprint: Fingerprint,
  definitionFingerprint: Fingerprint,
  sourceFindingFingerprints: z.array(Fingerprint).min(1),
  expectedBases: z.array(RepairExpectedBaseSchema).min(1),
  generationFingerprint: Fingerprint,
  generatedIds: z.array(z.object({
    logicalKey: Id, entityKind: z.enum(["choice", "thread"]), authorizedParentTargetKey: Id, id: Id,
  }).strict()).max(REPAIR_PROPOSAL_POLICY_V1.maxGeneratedIds),
  groups: z.array(GroupSchema).min(1).max(REPAIR_PROPOSAL_POLICY_V1.maxGroupsPerProposal),
  operations: z.array(RepairProposalOperationSchema).min(1),
  validation: ValidationSchema,
  provenance: z.object({
    mode: z.enum(["manual-deterministic", "ai-assisted"]),
    providerId: Id.nullable(), modelId: Id.nullable(), jobId: Id.nullable(),
    candidates: z.array(z.object({
      unitId: Id, attemptId: Id.nullable(), contextFingerprint: Fingerprint, candidateFingerprint: Fingerprint,
    }).strict()).min(1).max(REPAIR_PROPOSAL_POLICY_V1.maxUnits),
  }).strict(),
  createdAt: z.string().datetime(),
}).strict();
export type RepairProposalRecord = z.infer<typeof RepairProposalRecordSchema>;

export interface RepairProposalContractContext {
  projectId: string;
  repairPlanId: string;
  repairPlanArtifactVersionId: string;
  repairPlanDefinitionFingerprint: string;
  repairPlan: RepairPlanDefinition;
  fingerprint: RepairFingerprint;
  expectedBefore?: (operation: RepairProposalOperation) => unknown;
}

export function validateRepairProposalRecord(value: unknown, context: RepairProposalContractContext): RepairProposalRecord {
  const record = RepairProposalRecordSchema.parse(value);
  const fingerprint = context.fingerprint;
  if (record.projectId !== context.projectId || record.repairPlanId !== context.repairPlanId
    || record.repairPlanArtifactVersionId !== context.repairPlanArtifactVersionId
    || record.repairPlanDefinitionFingerprint !== context.repairPlanDefinitionFingerprint
    || fingerprint(context.repairPlan) !== context.repairPlanDefinitionFingerprint) {
    throw new Error("Repair-proposal repair-plan identity mismatch");
  }
  const { id: _id, definitionFingerprint: _definitionFingerprint, createdAt: _createdAt, ...definition } = record;
  const definitionFingerprint = fingerprint(definition);
  if (record.definitionFingerprint !== definitionFingerprint || record.id !== `rpp_${definitionFingerprint.slice(0, 32)}`) {
    throw new Error("Repair-proposal definition fingerprint mismatch");
  }
  if (JSON.stringify(record.expectedBases) !== JSON.stringify(context.repairPlan.expectedBases)) {
    throw new Error("Repair-proposal expected bases do not match the exact repair plan");
  }
  const planFindings = [...context.repairPlan.resolvedFindings.map((item) => item.sourceFingerprint)].sort();
  if (JSON.stringify(record.sourceFindingFingerprints) !== JSON.stringify(planFindings)) {
    throw new Error("Repair-proposal source findings do not match the exact repair plan");
  }
  assertUnique(record.sourceFindingFingerprints, "Repair-proposal finding lineage is duplicated");
  assertUnique(record.generatedIds.map((item) => item.id), "Repair-proposal generated IDs are duplicated");
  assertUnique(record.generatedIds.map((item) => `${item.entityKind}:${item.logicalKey}`), "Repair-proposal generated logical keys are duplicated");
  assertUnique(record.groups.map((item) => item.id), "Repair-proposal groups are duplicated");
  assertUnique(record.groups.map((item) => item.logicalKey), "Repair-proposal group logical keys are duplicated");
  assertUnique(record.operations.map((item) => item.id), "Repair-proposal operations are duplicated");
  assertUnique(record.operations.map((item) => item.logicalKey), "Repair-proposal operation logical keys are duplicated");
  assertUnique(record.provenance.candidates.map((item) => item.unitId), "Repair-proposal candidate unit lineage is duplicated");
  assertSorted(record.sourceFindingFingerprints, "Repair-proposal source findings are not canonical");
  assertSorted(record.generatedIds.map((item) => item.id), "Repair-proposal generated IDs are not canonical");
  assertSorted(record.groups.map((item) => item.logicalKey), "Repair-proposal groups are not canonical");
  assertSorted(record.operations.map((item) => item.id), "Repair-proposal operations are not canonical");
  assertSorted(record.provenance.candidates.map((item) => item.unitId), "Repair-proposal candidate provenance is not canonical");

  if (record.provenance.mode === "manual-deterministic") {
    if (record.provenance.providerId !== null || record.provenance.modelId !== null || record.provenance.jobId !== null
      || record.provenance.candidates.some((item) => item.attemptId !== null)) throw new Error("Manual repair-proposal provenance is invalid");
  } else if (!record.provenance.providerId || !record.provenance.modelId || !record.provenance.jobId
    || record.provenance.candidates.some((item) => !item.attemptId)) throw new Error("AI repair-proposal provenance is incomplete");

  const findings = new Set(planFindings);
  const targetKeys = new Set(context.repairPlan.authorizedTargets.map(repairTargetKeyFromPlan));
  const expectedByTarget = new Map(context.repairPlan.expectedBases.map((item) => [item.targetKey, item]));
  const groups = new Map(record.groups.map((group) => [group.id, group]));
  const operations = new Map(record.operations.map((operation) => [operation.id, operation]));
  const assigned = record.groups.flatMap((group) => group.operationIds);
  if (assigned.length !== record.operations.length || new Set(assigned).size !== assigned.length
    || assigned.some((id) => !operations.has(id))) throw new Error("Repair-proposal operations must belong to exactly one group");

  for (const group of record.groups) {
    const expectedGroupId = `rpg_${fingerprint({ planFingerprint: record.repairPlanDefinitionFingerprint, generationFingerprint: record.generationFingerprint, logicalKey: group.logicalKey }).slice(0, 32)}`;
    if (group.id !== expectedGroupId) throw new Error("Repair-proposal group ID is not deterministic");
    assertUnique(group.operationIds, "Repair-proposal group operations are duplicated");
    assertUnique(group.dependsOnGroupIds, "Repair-proposal group dependencies are duplicated");
    assertUnique(group.sourceFindingFingerprints, "Repair-proposal group finding lineage is duplicated");
    assertUnique(group.authorizedTargetKeys, "Repair-proposal group target authority is duplicated");
    assertSorted(group.operationIds, "Repair-proposal group operation IDs are not canonical");
    assertSorted(group.dependsOnGroupIds, "Repair-proposal group dependencies are not canonical");
    assertSorted(group.sourceFindingFingerprints, "Repair-proposal group findings are not canonical");
    assertSorted(group.authorizedTargetKeys, "Repair-proposal group targets are not canonical");
    if (group.dependsOnGroupIds.some((id) => id === group.id || !groups.has(id))) throw new Error("Repair-proposal group dependency is invalid");
    if (group.sourceFindingFingerprints.some((item) => !findings.has(item))) throw new Error("Repair-proposal group cites a finding outside the exact repair plan");
    if (group.authorizedTargetKeys.some((item) => !targetKeys.has(item))) throw new Error("Repair-proposal group target is outside the exact repair plan");
    const expectedImpact = context.repairPlan.impactGraph.nodes.filter((node) => group.authorizedTargetKeys.includes(node.entityId)).map((node) => node.id).sort();
    if (JSON.stringify(group.expectedImpactNodeIds) !== JSON.stringify(expectedImpact)) throw new Error("Repair-proposal group impact lineage is invalid");
    if (group.validation.errors.length || group.validation.warnings.length) throw new Error("Repair-proposal group validation payload is invalid");
  }
  assertAcyclic(record.groups);

  const declarationById = new Map(record.generatedIds.map((item) => [item.id, item]));
  const producerById = new Map<string, RepairProposalOperation>();
  for (const operation of record.operations) {
    const expectedOperationId = `rpo_${fingerprint({ groupId: operation.groupId, logicalKey: operation.logicalKey, kind: operation.kind, entityKind: operation.entityKind, entityId: operation.entityId }).slice(0, 32)}`;
    if (operation.id !== expectedOperationId || !groups.has(operation.groupId)) throw new Error("Repair-proposal operation identity is invalid");
    const group = groups.get(operation.groupId)!;
    if (!group.operationIds.includes(operation.id)) throw new Error("Repair-proposal operation group assignment is invalid");
    if (operation.sourceFindingFingerprints.some((item) => !findings.has(item))) throw new Error("Repair-proposal operation cites a finding outside the exact repair plan");
    assertUnique(operation.sourceFindingFingerprints, "Repair-proposal operation finding lineage is duplicated");
    assertSorted(operation.sourceFindingFingerprints, "Repair-proposal operation findings are not canonical");
    const authorityKey = operation.kind === "add-entity" ? operation.authorizedParentTargetKey : operation.targetKey;
    if (!group.authorizedTargetKeys.includes(authorityKey)) throw new Error("Repair-proposal operation exceeds its group target authority");
    validateOperation(
      operation,
      expectedByTarget,
      context,
      declarationById,
      fingerprint,
      record.generationFingerprint,
      group.logicalKey,
      record.provenance.candidates.map((item) => item.unitId),
    );
    if (operation.kind === "add-entity") {
      if (producerById.has(operation.entityId)) throw new Error("Generated repair entity has multiple producers");
      producerById.set(operation.entityId, operation);
    }
  }
  for (const declaration of record.generatedIds) {
    const producer = producerById.get(declaration.id);
    if (!producer || producer.kind !== "add-entity" || producer.entityKind !== declaration.entityKind
      || producer.authorizedParentTargetKey !== declaration.authorizedParentTargetKey) {
      throw new Error("Repair-proposal generated declaration/producer mismatch");
    }
  }
  if ([...producerById].some(([id]) => !declarationById.has(id))) throw new Error("Repair-proposal generated entity is undeclared");
  assertGeneratedDependencies(record.groups, record.operations, producerById);

  const expectedResults = record.operations.map((operation) => ({
    entityKind: operation.entityKind, entityId: operation.entityId, fingerprint: fingerprint(operation.after),
  })).sort((left, right) => `${left.entityKind}:${left.entityId}`.localeCompare(`${right.entityKind}:${right.entityId}`));
  if (JSON.stringify(record.validation.resultingEntityFingerprints) !== JSON.stringify(expectedResults)) throw new Error("Repair-proposal validation result fingerprints are invalid");
  const validationWarnings = [
    ...record.validation.passageValidation.findings.filter((item) => item.severity !== "error").map((item) => `${item.code}: ${item.message}`),
    ...record.validation.planningFindings.filter((item) => item.severity !== "error").map((item) => `${item.code}: ${item.message}`),
  ];
  if (record.validation.passageValidation.findings.some((item) => item.severity === "error")
    || record.validation.planningFindings.some((item) => item.severity === "error")
    || JSON.stringify(record.validation.warnings) !== JSON.stringify([...new Set(validationWarnings)].sort())) {
    throw new Error("Repair-proposal validation payload is invalid");
  }
  return record;
}

function validateOperation(
  operation: RepairProposalOperation,
  expectedByTarget: Map<string, RepairExpectedBase>,
  context: RepairProposalContractContext,
  declarationById: Map<string, RepairProposalRecord["generatedIds"][number]>,
  fingerprint: RepairFingerprint,
  generationFingerprint: string,
  groupLogicalKey: string,
  provenanceUnitIds: string[],
): void {
  if (operation.kind === "add-entity") {
    if (operation.targetKey !== `${operation.entityKind}:${operation.entityId}` || !operation.authorizedParentTargetKey.startsWith("passage:")) {
      throw new Error("Repair-proposal add operation target is invalid");
    }
    const declaration = declarationById.get(operation.entityId);
    if (!declaration || declaration.entityKind !== operation.entityKind
      || declaration.authorizedParentTargetKey !== operation.authorizedParentTargetKey) throw new Error("Repair-proposal add operation has no exact declaration");
    const expectedIds = provenanceUnitIds.map((unitId) => `rpg_${operation.entityKind}_${fingerprint({
      repairPlanDefinitionFingerprint: context.repairPlanDefinitionFingerprint, generationFingerprint, unitId,
      groupLogicalKey, entityKind: operation.entityKind, logicalKey: declaration.logicalKey,
    }).slice(0, 32)}`);
    if (operation.after.id !== operation.entityId || (operation.entityKind === "choice"
      ? `passage:${String(operation.after.sourcePassageId)}` !== operation.authorizedParentTargetKey
      : ![...(arrayStrings(operation.after.setupPassageIds)), ...(arrayStrings(operation.after.payoffPassageIds))].includes(operation.authorizedParentTargetKey.slice(8)))) {
      throw new Error("Repair-proposal generated entity ownership is invalid");
    }
    if (!/^rpg_(choice|thread)_[0-9a-f]{32}$/.test(operation.entityId) || !expectedIds.includes(operation.entityId)) {
      throw new Error("Repair-proposal generated entity ID is invalid");
    }
  } else {
    const expected = expectedByTarget.get(operation.targetKey);
    if (!expected || JSON.stringify(operation.expectedBase) !== JSON.stringify(expected)) throw new Error("Repair-proposal operation expected base is invalid");
    assertTargetCompatibility(operation.entityKind, operation.entityId, operation.targetKey, expected);
    if (operation.kind === "create-passage-draft-candidate") {
      if (expected.kind !== "passage-prose-head" || operation.requiresUnlock !== expected.acceptedLocked) throw new Error("Repair-proposal prose unlock requirement is invalid");
    } else {
      if (context.expectedBefore && JSON.stringify(operation.before) !== JSON.stringify(context.expectedBefore(operation))) throw new Error("Repair-proposal operation before payload is not the exact immutable base");
      assertProtectedFields(operation.entityKind, operation.before, operation.after);
      if (JSON.stringify(Object.keys(operation.before).sort()) !== JSON.stringify(Object.keys(operation.after).sort())) throw new Error("Repair-proposal update payload is non-canonical");
    }
  }
  const expectedDiffs = fieldDiffs(operation.before, operation.after);
  if (operation.kind === "update-entity" && !expectedDiffs.length) throw new Error("Repair-proposal update operation has no effect");
  if (JSON.stringify(operation.fieldDiffs) !== JSON.stringify(expectedDiffs)) throw new Error("Repair-proposal operation field differences are invalid");
}

function assertTargetCompatibility(entityKind: RepairProposalOperation["entityKind"], entityId: string, targetKey: string, base: RepairExpectedBase): void {
  if (entityKind === "passage-prose") {
    if (targetKey !== `prose:${entityId}` || base.kind !== "passage-prose-head" || base.passageId !== entityId) throw new Error("Repair-proposal prose target/base mismatch");
    return;
  }
  if (entityKind === "passage" || entityKind === "choice" || entityKind === "thread") {
    if (targetKey !== `${entityKind}:${entityId}` || base.kind !== "passage-entity-version" || base.entityKind !== entityKind || base.entityId !== entityId) throw new Error("Repair-proposal passage entity target/base mismatch");
    return;
  }
  const targetPrefix = entityKind === "canon-fact" ? "fact" : entityKind;
  if (targetKey !== `${targetPrefix}:${entityId}` || base.kind !== "artifact-entity-version" || base.entityType !== entityKind || base.entityId !== entityId) throw new Error("Repair-proposal artifact entity target/base mismatch");
}

function assertProtectedFields(kind: Exclude<RepairProposalOperation["entityKind"], "passage-prose">, before: Record<string, unknown>, after: Record<string, unknown>): void {
  const fields = kind === "passage" ? ["id", "sequenceId"]
    : kind === "choice" ? ["id", "sourcePassageId"]
      : kind === "relationship" ? ["id", "characterIds"]
        : kind === "mechanic" ? ["id", "key", "relationshipId"]
          : kind === "route-act" ? ["id", "routeId"]
            : kind === "route-decision" ? ["id", "actId"]
              : kind === "route-ending-hook" ? ["id", "routeId"]
                : kind === "ending" ? ["id", "hookId", "routeId"] : ["id"];
  for (const field of fields) if (canonical(before[field]) !== canonical(after[field])) throw new Error(`Repair-proposal operation changes protected ${kind}.${field}`);
}

function fieldDiffs(before: unknown, after: unknown): Array<{ field: string; before?: unknown; after?: unknown }> {
  const left = before && typeof before === "object" ? before as Record<string, unknown> : {};
  const right = after && typeof after === "object" ? after as Record<string, unknown> : {};
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    .filter((field) => canonical(left[field]) !== canonical(right[field]))
    .map((field) => ({ field, before: left[field], after: right[field] }));
}

function assertAcyclic(groups: RepairProposalRecord["groups"]): void {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("Repair-proposal group dependency cycle");
    if (visited.has(id)) return;
    const group = byId.get(id); if (!group) throw new Error("Repair-proposal group dependency is invalid");
    visiting.add(id); group.dependsOnGroupIds.forEach(visit); visiting.delete(id); visited.add(id);
  };
  groups.forEach((group) => visit(group.id));
}

function assertGeneratedDependencies(groups: RepairProposalRecord["groups"], operations: RepairProposalRecord["operations"], producers: Map<string, RepairProposalOperation>): void {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  for (const operation of operations) {
    const references = collectStrings(operation.after);
    for (const [id, producer] of producers) {
      if (!references.has(id) || producer.groupId === operation.groupId) continue;
      if (!groupsById.get(operation.groupId)?.dependsOnGroupIds.includes(producer.groupId)) throw new Error(`Repair-proposal group lacks dependency on generated entity ${id}`);
    }
  }
}

function repairTargetKeyFromPlan(target: RepairPlanDefinition["authorizedTargets"][number]): string {
  switch (target.kind) {
    case "passage-plan-passage": return `passage:${target.passageId}`;
    case "passage-plan-choice": return `choice:${target.choiceId}`;
    case "narrative-thread": return `thread:${target.threadId}`;
    case "passage-prose": return `prose:${target.passageId}`;
    case "mechanic": return `mechanic:${target.mechanicKey}`;
    case "relationship": return `relationship:${target.relationshipId}`;
    case "canon-fact": return `fact:${target.factId}`;
    case "route": return `route:${target.routeId}`;
    case "route-section": return `route-${target.sectionKind}:${target.sectionId}`;
    case "ending": return `ending:${target.endingId}`;
  }
}

function arrayStrings(value: unknown): string[] { return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : []; }
function collectStrings(value: unknown, result = new Set<string>()): Set<string> {
  if (typeof value === "string") result.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, result));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach((item) => collectStrings(item, result));
  return result;
}
function assertUnique(values: string[], message: string): void { if (new Set(values).size !== values.length) throw new Error(message); }
function assertSorted(values: string[], message: string): void { if (values.some((value, index) => index > 0 && values[index - 1]!.localeCompare(value) > 0)) throw new Error(message); }
function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
