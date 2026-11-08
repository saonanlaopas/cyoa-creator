import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { CreativeDirectionSchema, LongFormStoryBibleSchema, LongFormRoutePlanSchema, LongFormEndingPlanSchema,
  LongFormMechanicsPlanSchema, RepairChoicePlanSchema, RepairStateEffectSchema, sourceCanonicalJson, sourceDigest } from "@story-to-cyoa/domain";
import type { EditOwner, EditTarget, EditResponse } from "./conversational-edit-contract.js";

// Version 1 is intentionally allowlisted. Primitive arrays and protected provenance are not creation scopes.
const definitions = {
  "creative-direction": { schema: CreativeDirectionSchema, fields: ["scopedVariations"] },
  bible: { schema: LongFormStoryBibleSchema, fields: ["characters", "relationships", "settings", "timeline", "worldRules", "themes", "canonFacts", "contradictions", "adaptationOpportunities", "unresolvedQuestions"] },
  routes: { schema: LongFormRoutePlanSchema, fields: ["acts", "routes", "decisionPoints", "reconvergences", "endingHooks", "unresolvedQuestions"] },
  endings: { schema: LongFormEndingPlanSchema, fields: ["endings", "unresolvedQuestions"] },
  mechanics: { schema: LongFormMechanicsPlanSchema, fields: ["visibleStats", "relationships", "flags", "resources", "gates", "choiceEffectPlans", "balancingRules", "unresolvedQuestions"] },
} as const;
type Operation = EditResponse["groups"][number]["operations"][number];
const unwrap = (schema: z.ZodTypeAny): z.ZodTypeAny => {
  while (schema instanceof z.ZodEffects || schema instanceof z.ZodDefault || schema instanceof z.ZodOptional) {
    schema = schema instanceof z.ZodEffects ? schema.innerType() : schema instanceof z.ZodDefault ? schema.removeDefault() : schema.unwrap();
  }
  return schema;
};
function definition(owner: EditOwner, field: string) {
  if (!Object.hasOwn(definitions, owner)) return undefined;
  const entry = definitions[owner as keyof typeof definitions];
  if (!(entry.fields as readonly string[]).includes(field)) return undefined;
  const object = unwrap(entry.schema) as z.AnyZodObject;
  const array = unwrap(object.shape[field]) as z.ZodArray<z.ZodTypeAny>;
  return { item: array.element, maximum: array._def.maxLength!.value };
}

export function collectionTargets(owner: EditOwner, versionId: string, artifact: unknown): EditTarget[] {
  if (!Object.hasOwn(definitions, owner)) return [];
  return definitions[owner as keyof typeof definitions].fields.map(collection => collectionTarget(owner, versionId, artifact, collection));
}
function collectionTarget(owner: EditOwner, versionId: string, artifact: unknown, collection: string): EditTarget {
  const spec = definition(owner, collection), value = artifact as Record<string, unknown>;
  if (!spec || !Array.isArray(value[collection])) throw new Error("edit_collection_scope_invalid");
  const count = value[collection].length;
  return { key: `collection:${owner}:${collection}`, owner, targetId: `collection:${collection}`, path: `/${collection}`, versionId,
    label: `${owner} / Add ${collection.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()} (${count}/${spec.maximum})`, scope: { kind: "collection", version: 1, collection },
    value: { schemaId: "cyoa.edit-collection", schemaVersion: 1, artifactId: owner, artifactSchemaVersion: value.schemaVersion,
      parentVersionId: versionId, collection, itemSchema: `${owner}.${collection}.v1`, itemSchemaDefinition: zodToJsonSchema(spec.item, { $refStrategy: "none" }), itemCount: count,
      maxItems: spec.maximum, allowedOperations: ["add-item"] } };
}
export function assertCollectionTarget(target: EditTarget, artifact: unknown): void {
  if (!target.scope) return;
  if (target.scope.kind !== "collection" || target.scope.version !== 1
    || sourceCanonicalJson(target) !== sourceCanonicalJson(collectionTarget(target.owner, target.versionId, artifact, target.scope.collection))) {
    throw new Error("edit_collection_scope_invalid");
  }
}
export function creationCollection(target: EditTarget | undefined, op: Operation): string | undefined {
  if (!target) return undefined;
  if (target.scope) {
    if (target.scope.kind !== "collection" || target.scope.version !== 1 || op.kind !== "add-item"
      || op.collection !== target.scope.collection || !definition(target.owner, op.collection)) throw new Error("edit_collection_operation_not_allowed");
    return op.collection;
  }
  return target.targetId === "root" && target.path === "" && op.kind === "add-item" && op.collection && definition(target.owner, op.collection)
    ? op.collection : undefined;
}

// Only schema-defined identity positions inside a NEW record declare descendant IDs. Reference fields do not.
const childFields: Readonly<Record<string, string>> = {
  "routes.decisionPoints": "choices", "endings.endings": "variants", "mechanics.gates": "conditions", "mechanics.relationships": "bands",
};
export function choiceEffectCreation(target: EditTarget | undefined, op: Operation): { choiceId: string; effectIds: string[] } | undefined {
  if (target?.owner === "choice" && target.path === "" && target.key === `choice:${target.targetId}` && !target.scope
    && op.kind === "add-item" && op.collection === "effects") {
    const effect = RepairStateEffectSchema.safeParse(op.item);
    if (effect.success) return { choiceId: target.targetId, effectIds: [effect.data.id] };
  }
  if (target?.owner === "passage-structure" && target.targetId === "root" && target.path === "" && !target.scope
    && op.kind === "add-entity" && op.entityKind === "choice") {
    const choice = RepairChoicePlanSchema.safeParse(op.item);
    if (choice.success) return { choiceId: choice.data.id, effectIds: choice.data.effects.map(effect => effect.id) };
  }
}

export function creationIdentityValues(target: EditTarget | undefined, op: Operation): unknown[] {
  if (op.kind !== "add-item" && op.kind !== "add-entity") return [];
  const result: unknown[] = [op.item?.id], collection = creationCollection(target, op);
  const childField = collection && target && childFields[`${target.owner}.${collection}`];
  if (childField && definition(target!.owner, collection!)!.item.safeParse(op.item).success) {
    const children = op.item?.[childField];
    if (Array.isArray(children)) result.push(...children.map(child => child.id));
  }
  if (op.kind === "add-entity") result.push(...(choiceEffectCreation(target, op)?.effectIds ?? []));
  return result;
}

export function collectionReview(target: EditTarget, before: unknown, after: unknown, operations: Operation[]) {
  assertCollectionTarget(target, before);
  const field = target.scope!.collection;
  const old = (before as Record<string, unknown[]>)[field]!, next = (after as Record<string, Array<{ id: string }>>)[field]!;
  const ids = operations.map(op => { creationCollection(target, op); return op.item!.id; });
  const addedRecords = ids.map(id => { const item = next.find(record => record.id === id); if (!item) throw new Error("edit_collection_result_invalid"); return item; });
  return { owner: target.owner, targetId: target.targetId,
    before: { parentVersionId: target.versionId, collection: field, count: old.length },
    after: { collection: field, count: next.length, addedRecords,
      existingRecordsUnchanged: sourceCanonicalJson(old) === sourceCanonicalJson(next.filter(record => !ids.includes(record.id))),
      previousRecordsFingerprint: sourceDigest(old) } };
}
