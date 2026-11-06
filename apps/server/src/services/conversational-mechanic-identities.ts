import { RepairFlagMechanicSchema, RepairRelationshipMechanicSchema, RepairResourceMechanicSchema, RepairVisibleStatMechanicSchema, sourceCanonicalJson } from "@story-to-cyoa/domain";
import type { EditPlan, EditResponse } from "./conversational-edit-contract.js";

const collections = {
  visibleStats: RepairVisibleStatMechanicSchema.strict(), relationships: RepairRelationshipMechanicSchema.strict(),
  flags: RepairFlagMechanicSchema.strict(), resources: RepairResourceMechanicSchema.strict(),
};
interface MechanicCreation { collection: string; id: string; key: string; groupId: string }

/** References use schema fields, not incidental words in labels or prose. */
export function mechanicKeyReferences(value: unknown, result = new Set<string>()): Set<string> {
  if (value && typeof value === "object") for (const [field, child] of Object.entries(value)) {
    if (field === "mechanicKey" && typeof child === "string") result.add(child);
    if (field === "mechanicKeys" && Array.isArray(child)) child.forEach(key => { if (typeof key === "string") result.add(key); });
    mechanicKeyReferences(child, result);
  }
  return result;
}

/** Authorize a semantic key only as the paired identity of a schema-valid, scoped creation. */
export function mechanicCreations(plan: EditPlan, response: EditResponse, generated: ReadonlySet<string>): MechanicCreation[] {
  const result: MechanicCreation[] = [];
  for (const group of response.groups) for (const op of group.operations) {
    const target = plan.targets.find(t => t.key === op.targetKey);
    if (op.kind !== "add-item" || target?.owner !== "mechanics" || target.targetId !== "root" || target.path !== ""
      || !op.collection || !Object.hasOwn(collections, op.collection)) continue;
    const item = collections[op.collection as keyof typeof collections].parse(op.item);
    if (sourceCanonicalJson(item) !== sourceCanonicalJson(op.item)) throw new Error("edit_candidate_not_closed");
    if (!generated.has(item.id)) throw new Error("edit_generated_id_invalid");
    if (generated.has(item.key)) throw new Error("edit_generated_id_collision");
    result.push({ collection: op.collection, id: item.id, key: item.key, groupId: group.id });
  }
  return result;
}

function records(value: unknown) {
  const plan = value as Record<string, unknown>;
  return Object.keys(collections).flatMap(collection => Array.isArray(plan?.[collection])
    ? (plan[collection] as unknown[]).flatMap(item => item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"
      ? [{ collection, id: (item as { id: string }).id, key: (item as { key?: unknown }).key }] : []) : []);
}

/** Bind keys to their original records, including root replacements/swaps and historical replay. */
export function authorizeMechanicKeys(before: unknown, after: unknown, creations: readonly MechanicCreation[]): Set<string> {
  const existing = new Map(records(before).map(item => [item.id, item]));
  for (const item of records(after)) {
    const old = existing.get(item.id);
    if (old && old.key !== item.key) throw new Error("edit_mechanic_key_rename_unsupported");
    if (!old && !creations.some(c => c.collection === item.collection && c.id === item.id && c.key === item.key)) throw new Error("edit_generated_id_invalid");
  }
  return new Set(creations.map(c => c.key));
}
