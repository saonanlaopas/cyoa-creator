import { RepairFlagMechanicSchema, RepairRelationshipMechanicSchema, RepairResourceMechanicSchema, RepairVisibleStatMechanicSchema, collectStableIds, sourceCanonicalJson, type ProposedPlanningOperation } from "@story-to-cyoa/domain";
import type { EditPlan, EditResponse, EditTarget } from "./conversational-edit-contract.js";
import { creationCollection } from "./conversational-collection-targets.js";

const collections = {
  visibleStats: RepairVisibleStatMechanicSchema.strict(), relationships: RepairRelationshipMechanicSchema.strict(),
  flags: RepairFlagMechanicSchema.strict(), resources: RepairResourceMechanicSchema.strict(),
};
interface MechanicCreation { collection: string; id: string; key: string; groupId: string }
type MechanicCollection = keyof typeof collections;

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
    if (op.kind !== "add-item" || target?.owner !== "mechanics" || !creationCollection(target, op)
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

export function keyedMechanicTarget(target: EditTarget) {
  if (target.owner !== "mechanics" || target.scope || target.key !== `mechanics:${target.targetId}`) return;
  const path = /^\/([^/]+)\/(0|[1-9][0-9]*)$/.exec(target.path);
  if (!path || !Object.hasOwn(collections, path[1]!)) return;
  const collection = path[1] as MechanicCollection;
  const record = collections[collection].parse(target.value);
  if (record.id === target.targetId) return { collection, index: Number(path[2]), record };
}

export function authorizeMechanicRemovals(before: unknown, after: unknown, targets: EditTarget[], operations: ProposedPlanningOperation[]) {
  const removals = targets.filter(target => operations.some(op => op.kind === "remove-item" && op.targetId === target.targetId))
    .flatMap(target => { const removal = keyedMechanicTarget(target); return removal ? [removal] : []; });
  const identities = new Set<string>();
  if (!removals.length) return { identities, removals };
  if (operations.some(op => op.kind === "set-fields" && op.targetId === "root" && Object.keys(op.changes!).some(field => Object.hasOwn(collections, field)))) {
    throw new Error("edit_mechanic_removal_requires_exact_scope");
  }
  const remaining = structuredClone(before) as Record<MechanicCollection, unknown[]>;
  // Remove only captured record slots; surviving occurrences of the same string stay owned by their original records.
  for (const { collection, index, record } of removals.sort((a, b) => b.index - a.index)) {
    if (sourceCanonicalJson(remaining[collection][index]) !== sourceCanonicalJson(record)) throw new Error("edit_mechanic_removal_target_stale");
    remaining[collection].splice(index, 1);
    collectStableIds(record, identities);
  }
  const count = (value: unknown, result = new Map<string, number>()): Map<string, number> => {
    if (value && typeof value === "object") for (const [field, child] of Object.entries(value)) {
      if ((field === "id" || field === "key") && typeof child === "string" && identities.has(child)) {
        const token = `${field}:${child}`;
        result.set(token, (result.get(token) ?? 0) + 1);
      } else count(child, result);
    }
    return result;
  };
  const permitted = count(remaining), actual = count(after);
  if ([...actual].some(([token, n]) => n > (permitted.get(token) ?? 0))) throw new Error("edit_mechanic_removal_identity_reused");
  if ([...permitted].some(([token, n]) => n > (actual.get(token) ?? 0))) throw new Error("edit_identity_changed");
  return { identities, removals };
}
