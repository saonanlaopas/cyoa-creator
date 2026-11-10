import { zodToJsonSchema } from "zod-to-json-schema";
import { sourceCanonicalJson, sourceDigest } from "@story-to-cyoa/domain";
import { ChoicePlanSchema, NarrativeThreadSchema, PassagePlanSchema, SequencePlanSchema, type PassageStructure } from "@story-to-cyoa/pipeline";
import type { EditOperation, EditTarget } from "./conversational-edit-contract.js";

const schemas = { passage: PassagePlanSchema, choice: ChoicePlanSchema, thread: NarrativeThreadSchema };
const kinds = ["passage", "choice", "thread"] as const;
const itemSchemas = Object.fromEntries(kinds.map(kind => [kind, zodToJsonSchema(schemas[kind].strict())]));
const maxPassages = SequencePlanSchema.shape.passageIds.removeDefault()._def.maxLength!.value;

function creationTarget(versionId: string, entityKind: typeof kinds[number]): EditTarget {
  const key = `create:passage-plan:${entityKind}`;
  return { key, owner: "passage-structure", targetId: key, versionId, path: "", label: `Passage plan / Create ${entityKind}`,
    scope: { kind: "entity-creation", version: 1, entityKind },
    value: { schemaVersion: 1, structureVersionId: versionId, entityKind, allowedOperations: ["add-entity"], itemSchemaDefinition: itemSchemas[entityKind] } };
}

function sequenceTarget(versionId: string, sequence: PassageStructure["sequences"][number]): EditTarget {
  const { id: sequenceId, actId, label, routeIds, planningStatus, passageIds } = sequence;
  return { key: `collection:sequence:${sequenceId}:passageIds`, owner: "passage-structure", targetId: sequenceId, path: "", versionId,
    label: `Sequence / Append passage to ${label} (${passageIds.length}/${maxPassages})`.slice(0, 300),
    scope: { kind: "sequence-passage-append", version: 1, sequenceId },
    value: { schemaVersion: 1, structureVersionId: versionId, sequenceId, actId, routeIds, planningStatus,
      itemCount: passageIds.length, maxItems: maxPassages, allowedOperations: ["append-passage"] } };
}

export function passageCreationTargets(versionId: string, structure: PassageStructure): EditTarget[] {
  return [...kinds.map(kind => creationTarget(versionId, kind)), ...structure.sequences.map(sequence => sequenceTarget(versionId, sequence))];
}

export function assertPassageTarget(target: EditTarget, structure: unknown): void {
  const scope = target.scope;
  if (!structure) throw new Error("edit_passage_creation_scope_invalid");
  if (scope?.kind === "entity-creation" && kinds.includes(scope.entityKind)
    && sourceCanonicalJson(target) === sourceCanonicalJson(creationTarget(target.versionId, scope.entityKind))) return;
  if (scope?.kind === "sequence-passage-append") {
    const sequence = (structure as PassageStructure).sequences.find(item => item.id === scope.sequenceId);
    if (sequence && sourceCanonicalJson(target) === sourceCanonicalJson(sequenceTarget(target.versionId, sequence))) return;
  }
  throw new Error("edit_passage_creation_scope_invalid");
}

export function permitsEntityCreation(target: EditTarget | undefined, op: EditOperation): boolean {
  return target?.owner === "passage-structure" && op.kind === "add-entity" && !!op.entityKind && !!op.item
    && (target.scope
      ? target.scope.kind === "entity-creation" && target.scope.entityKind === op.entityKind
      : target.key === "passage-structure:root" && target.targetId === "root" && target.path === "");
}

export function appendSequencePassages(structure: PassageStructure, links: Map<string, string[]>): PassageStructure {
  return { ...structure, sequences: structure.sequences.map(sequence => {
    const ids = links.get(sequence.id);
    if (!ids) return sequence;
    if (sequence.planningStatus === "locked") throw new Error("edit_planning_lock_protected");
    const passageIds = [...sequence.passageIds, ...ids];
    if (passageIds.length > maxPassages) throw new Error("edit_sequence_passage_capacity_exceeded");
    if (ids.some(id => sequence.passageIds.includes(id)) || new Set(ids).size !== ids.length) throw new Error("edit_sequence_passage_duplicate");
    return { ...sequence, passageIds };
  }) };
}

export function sequenceAppendReview(target: EditTarget, before: PassageStructure, after: PassageStructure) {
  const old = before.sequences.find(item => item.id === target.targetId)!.passageIds;
  const next = after.sequences.find(item => item.id === target.targetId)!.passageIds;
  return { owner: target.owner, targetId: target.targetId,
    before: { structureVersionId: target.versionId, sequenceId: target.targetId, count: old.length, passageIdsFingerprint: sourceDigest(old) },
    after: { sequenceId: target.targetId, count: next.length, appendedPassageIds: next.slice(old.length), existingOrderUnchanged: true } };
}
