import { createHash } from "node:crypto";
import {
  ChoicePlanSchema,
  NarrativeThreadSchema,
  PassagePlanBundleSchema,
  PassagePlanSchema,
  type ChoicePlan,
  type NarrativeThread,
  type PassagePlan,
  type PassagePlanBundle,
} from "./schemas/passage-plan.js";
import type { PassagePlanningContextPack } from "./passage-planning-context.js";
import type { PassagePlanningUnitCandidate } from "./passage-planning-candidate.js";
import { stableJson } from "./passage-generation-plan.js";

export const passagePlanningProposalSchema = Object.freeze({
  id: "cyoa.passage-planning-proposal-set",
  version: 1,
});

export type PassageProposalEntityKind = "passage" | "choice" | "thread";
export type PassageProposalOperationKind = "add-entity" | "update-entity";

export interface PassageProposalCandidateInput {
  candidateId: string;
  attemptId: string;
  unitId: string;
  unitPosition: number;
  inputFingerprint: string;
  contextFingerprint: string;
  candidate: PassagePlanningUnitCandidate;
  context: PassagePlanningContextPack;
}

export interface PassageProposalCandidateProvenance {
  candidateId: string;
  attemptId: string;
  unitId: string;
  unitPosition: number;
  inputFingerprint: string;
  contextFingerprint: string;
  candidateFingerprint: string;
}

export interface PassageProposalFieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

export interface PassageProposalOperation {
  id: string;
  kind: PassageProposalOperationKind;
  entityKind: PassageProposalEntityKind;
  entityId: string;
  baseVersionId: string | null;
  before: PassagePlan | ChoicePlan | NarrativeThread | null;
  after: PassagePlan | ChoicePlan | NarrativeThread;
  fieldDiffs: PassageProposalFieldDiff[];
  sourceCandidateIds: string[];
}

export interface PassageProposalGroup {
  id: string;
  unitId: string;
  position: number;
  label: string;
  summary: string;
  operationIds: string[];
  dependsOnGroupIds: string[];
  affectedEntityIds: string[];
  downstreamInvalidations: string[];
  validationFindingIds: string[];
  safeToApplyIndependently: boolean;
}

export interface ConsolidatedPassageProposal {
  schemaId: typeof passagePlanningProposalSchema.id;
  schemaVersion: typeof passagePlanningProposalSchema.version;
  candidates: PassageProposalCandidateProvenance[];
  operations: PassageProposalOperation[];
  groups: PassageProposalGroup[];
  consolidationFingerprint: string;
}

export class PassageProposalConsolidationError extends Error {
  public readonly code = "passage_proposal_consolidation_failed";
  public constructor(message: string, public readonly diagnostics: string[] = [message]) {
    super(message);
  }
}

type CandidateEntity = PassageProposalOperation["after"];
type BaseEntity = { versionId: string; content: CandidateEntity };
type CollectedEffect = {
  entityKind: PassageProposalEntityKind;
  entityId: string;
  base: BaseEntity | null;
  after: CandidateEntity;
  generated: boolean;
  ownerUnitId: string;
  ownerPosition: number;
  sourceCandidateIds: Set<string>;
};

const fingerprint = (value: unknown): string => createHash("sha256").update(stableJson(value)).digest("hex");
const operationKey = (kind: PassageProposalEntityKind, id: string) => `${kind}:${id}`;
const entityOrder: Record<PassageProposalEntityKind, number> = { passage: 0, choice: 1, thread: 2 };

export function consolidatePassagePlanningCandidates(
  inputs: PassageProposalCandidateInput[],
): ConsolidatedPassageProposal {
  if (!inputs.length) throw new PassageProposalConsolidationError("No validated generation candidates were supplied");
  const orderedInputs = [...inputs].sort((left, right) =>
    left.unitPosition - right.unitPosition || left.unitId.localeCompare(right.unitId)
    || left.candidateId.localeCompare(right.candidateId));
  const candidateIds = new Set<string>();
  const unitIds = new Set<string>();
  const effects = new Map<string, CollectedEffect>();
  const diagnostics: string[] = [];

  for (const input of orderedInputs) {
    if (candidateIds.has(input.candidateId)) diagnostics.push(`Duplicate candidate ${input.candidateId}`);
    if (unitIds.has(input.unitId)) diagnostics.push(`Multiple candidates supplied for unit ${input.unitId}`);
    candidateIds.add(input.candidateId);
    unitIds.add(input.unitId);
    const generated = new Map(input.candidate.generatedIds.map((item) => [operationKey(item.entityKind, item.id), item]));
    const bases = baseEntities(input.context);
    collectEntities("passage", input.candidate.passages, input, bases, generated, effects, diagnostics);
    collectEntities("choice", input.candidate.choices, input, bases, generated, effects, diagnostics);
    collectEntities("thread", input.candidate.threads, input, bases, generated, effects, diagnostics);
  }
  if (diagnostics.length) {
    throw new PassageProposalConsolidationError(diagnostics[0]!, [...new Set(diagnostics)].sort());
  }

  const operations = [...effects.values()]
    .filter((effect) => !effect.base || stableJson(effect.base.content) !== stableJson(effect.after))
    .map(toOperation)
    .sort((left, right) => {
      const leftEffect = effects.get(operationKey(left.entityKind, left.entityId))!;
      const rightEffect = effects.get(operationKey(right.entityKind, right.entityId))!;
      return leftEffect.ownerPosition - rightEffect.ownerPosition
        || leftEffect.ownerUnitId.localeCompare(rightEffect.ownerUnitId)
        || entityOrder[left.entityKind] - entityOrder[right.entityKind]
        || left.entityId.localeCompare(right.entityId);
    });

  const operationsByUnit = new Map<string, PassageProposalOperation[]>();
  const unitPosition = new Map(orderedInputs.map((item) => [item.unitId, item.unitPosition]));
  for (const operation of operations) {
    const owner = effects.get(operationKey(operation.entityKind, operation.entityId))!.ownerUnitId;
    operationsByUnit.set(owner, [...(operationsByUnit.get(owner) ?? []), operation]);
  }
  const provisionalGroups = [...operationsByUnit.entries()]
    .sort(([left], [right]) => (unitPosition.get(left) ?? 0) - (unitPosition.get(right) ?? 0) || left.localeCompare(right))
    .map(([unitId, unitOperations]) => {
      const id = `ppg_${fingerprint({ unitId, operationIds: unitOperations.map((item) => item.id) }).slice(0, 32)}`;
      return {
        id,
        unitId,
        position: unitPosition.get(unitId) ?? 0,
        label: `Generation unit ${(unitPosition.get(unitId) ?? 0) + 1}`,
        summary: summarizeOperations(unitOperations),
        operationIds: unitOperations.map((item) => item.id),
        affectedEntityIds: unitOperations.map((item) => operationKey(item.entityKind, item.entityId)).sort(),
      };
    });
  const groupByOperationId = new Map(provisionalGroups.flatMap((group) =>
    group.operationIds.map((id) => [id, group.id] as const)));
  const newEntityGroup = new Map(operations.filter((item) => item.kind === "add-entity")
    .map((operation) => [operationKey(operation.entityKind, operation.entityId), groupByOperationId.get(operation.id)!]));
  const operationById = new Map(operations.map((item) => [item.id, item]));
  const groups: PassageProposalGroup[] = provisionalGroups.map((group) => {
    const dependencies = new Set<string>();
    group.operationIds.forEach((operationId) => {
      const operation = operationById.get(operationId)!;
      referencedProposalEntities(operation).forEach((reference) => {
        const dependency = newEntityGroup.get(reference);
        if (dependency && dependency !== group.id) dependencies.add(dependency);
      });
    });
    const dependsOnGroupIds = [...dependencies].sort();
    return {
      ...group,
      dependsOnGroupIds,
      downstreamInvalidations: ["passage-plan-approval", "passage-plan-validation"],
      validationFindingIds: [],
      safeToApplyIndependently: dependsOnGroupIds.length === 0,
    };
  });
  const candidates = orderedInputs.map((input) => ({
    candidateId: input.candidateId,
    attemptId: input.attemptId,
    unitId: input.unitId,
    unitPosition: input.unitPosition,
    inputFingerprint: input.inputFingerprint,
    contextFingerprint: input.contextFingerprint,
    candidateFingerprint: fingerprint(input.candidate),
  }));
  const base = {
    schemaId: passagePlanningProposalSchema.id,
    schemaVersion: passagePlanningProposalSchema.version,
    candidates,
    operations,
    groups,
  };
  return { ...base, consolidationFingerprint: fingerprint(base) };
}

export function materializePassageProposalOperations(
  bundle: PassagePlanBundle,
  operations: PassageProposalOperation[],
): PassagePlanBundle {
  const result = structuredClone(bundle);
  for (const operation of operations) {
    const collection = collectionFor(result, operation.entityKind);
    const index = collection.findIndex((item) => item.id === operation.entityId);
    if (operation.kind === "add-entity") {
      if (index >= 0) throw new PassageProposalConsolidationError(`Entity ${operation.entityId} already exists`);
      collection.push(parseEntity(operation.entityKind, operation.after) as never);
    } else {
      if (index < 0) throw new PassageProposalConsolidationError(`Entity ${operation.entityId} is missing`);
      collection[index] = parseEntity(operation.entityKind, operation.after) as never;
    }
  }
  return PassagePlanBundleSchema.parse(result);
}

export function passageProposalFieldDiffs(before: CandidateEntity | null, after: CandidateEntity): PassageProposalFieldDiff[] {
  const previous = (before ?? {}) as Record<string, unknown>;
  const next = after as unknown as Record<string, unknown>;
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort()
    .filter((field) => stableJson(previous[field]) !== stableJson(next[field]))
    .map((field) => ({ field, before: previous[field], after: next[field] }));
}

function collectEntities(
  entityKind: PassageProposalEntityKind,
  entities: CandidateEntity[],
  input: PassageProposalCandidateInput,
  bases: Map<string, BaseEntity>,
  generated: Map<string, unknown>,
  effects: Map<string, CollectedEffect>,
  diagnostics: string[],
): void {
  for (const raw of entities) {
    const after = parseEntity(entityKind, raw);
    const key = operationKey(entityKind, after.id);
    const isGenerated = generated.has(key);
    const base = bases.get(key) ?? null;
    if (!isGenerated && !base) {
      diagnostics.push(`Candidate ${input.candidateId} lacks an exact immutable base for ${key}`);
      continue;
    }
    if (isGenerated && base) {
      diagnostics.push(`Generated entity ${key} collides with an existing immutable entity`);
      continue;
    }
    const existing = effects.get(key);
    if (!existing) {
      effects.set(key, {
        entityKind, entityId: after.id, base, after, generated: isGenerated,
        ownerUnitId: input.unitId, ownerPosition: input.unitPosition,
        sourceCandidateIds: new Set([input.candidateId]),
      });
      continue;
    }
    if (existing.generated || isGenerated) {
      diagnostics.push(`Generated stable ID collision for ${key} across candidates`);
      continue;
    }
    if (existing.base?.versionId !== base?.versionId || stableJson(existing.after) !== stableJson(after)) {
      diagnostics.push(`Conflicting candidate effects for ${key}`);
      continue;
    }
    existing.sourceCandidateIds.add(input.candidateId);
  }
}

function baseEntities(context: PassagePlanningContextPack): Map<string, BaseEntity> {
  const result = new Map<string, BaseEntity>();
  context.selectedPassages.forEach((item) => result.set(operationKey("passage", item.content.id), item));
  context.choices.forEach((item) => result.set(operationKey("choice", item.content.id), item));
  context.threads.forEach((item) => result.set(operationKey("thread", item.content.id), item));
  return result;
}

function toOperation(effect: CollectedEffect): PassageProposalOperation {
  const sourceCandidateIds = [...effect.sourceCandidateIds].sort();
  const operationBase = {
    kind: effect.base ? "update-entity" as const : "add-entity" as const,
    entityKind: effect.entityKind,
    entityId: effect.entityId,
    baseVersionId: effect.base?.versionId ?? null,
    before: effect.base?.content ?? null,
    after: effect.after,
    fieldDiffs: passageProposalFieldDiffs(effect.base?.content ?? null, effect.after),
    sourceCandidateIds,
  };
  return { ...operationBase, id: `ppo_${fingerprint(operationBase).slice(0, 32)}` };
}

function parseEntity(kind: PassageProposalEntityKind, value: unknown): CandidateEntity {
  if (kind === "passage") return PassagePlanSchema.parse(value);
  if (kind === "choice") return ChoicePlanSchema.parse(value);
  return NarrativeThreadSchema.parse(value);
}

function collectionFor(bundle: PassagePlanBundle, kind: PassageProposalEntityKind) {
  if (kind === "passage") return bundle.passages;
  if (kind === "choice") return bundle.choices;
  return bundle.threads;
}

function referencedProposalEntities(operation: PassageProposalOperation): Set<string> {
  const references = new Set<string>();
  if (operation.entityKind === "passage") {
    const passage = operation.after as PassagePlan;
    passage.choiceIds.forEach((id) => references.add(operationKey("choice", id)));
    passage.setupThreadIds.forEach((id) => references.add(operationKey("thread", id)));
    passage.payoffThreadIds.forEach((id) => references.add(operationKey("thread", id)));
  } else if (operation.entityKind === "choice") {
    const choice = operation.after as ChoicePlan;
    references.add(operationKey("passage", choice.sourcePassageId));
    references.add(operationKey("passage", choice.destinationPassageId));
  } else {
    const thread = operation.after as NarrativeThread;
    thread.setupPassageIds.forEach((id) => references.add(operationKey("passage", id)));
    thread.payoffPassageIds.forEach((id) => references.add(operationKey("passage", id)));
  }
  return references;
}

function summarizeOperations(operations: PassageProposalOperation[]): string {
  const counts = new Map<PassageProposalEntityKind, number>();
  operations.forEach((item) => counts.set(item.entityKind, (counts.get(item.entityKind) ?? 0) + 1));
  return (["passage", "choice", "thread"] as PassageProposalEntityKind[])
    .filter((kind) => counts.has(kind))
    .map((kind) => `${counts.get(kind)} ${kind}${counts.get(kind) === 1 ? "" : "s"}`)
    .join(", ");
}
