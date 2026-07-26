import { z } from "zod";

export const ScalarSchema = z.union([z.boolean(), z.string(), z.number()]);

export const ConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("statAtLeast"), key: z.string().min(1), value: z.number() }),
  z.object({ kind: z.literal("flagEquals"), key: z.string().min(1), value: ScalarSchema }),
  z.object({ kind: z.literal("hasItem"), itemId: z.string().min(1) }),
  z.object({ kind: z.literal("relationshipAtLeast"), key: z.string().min(1), value: z.number() }),
]);

const DelaySchema = z.union([z.literal("nextPassage"), z.number().int().positive()]).optional();

export const EffectSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("addStat"), key: z.string().min(1), value: z.number(), delay: DelaySchema }),
  z.object({ op: z.literal("setFlag"), key: z.string().min(1), value: ScalarSchema, delay: DelaySchema }),
  z.object({ op: z.literal("addItem"), itemId: z.string().min(1), delay: DelaySchema }),
  z.object({ op: z.literal("removeItem"), itemId: z.string().min(1), delay: DelaySchema }),
  z.object({ op: z.literal("addRelationship"), key: z.string().min(1), value: z.number(), delay: DelaySchema }),
]);

export const RelationshipBandSchema = z.object({
  min: z.number(),
  label: z.string().min(1),
});

export const MechanicsSchema = z.object({
  visibleStats: z.record(z.string(), z.object({
    label: z.string().min(1),
    initial: z.number().default(0),
    min: z.number().optional(),
    max: z.number().optional(),
  })).default({}),
  relationships: z.record(z.string(), z.object({
    label: z.string().min(1),
    initial: z.number().default(0),
    bands: z.array(RelationshipBandSchema).default([]),
  })).default({}),
  hiddenFlags: z.record(z.string(), ScalarSchema).default({}),
  inventory: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })).default([]),
  protagonistTendencies: z.array(z.string()).default([]),
  divergenceMode: z.enum(["canon-centered", "balanced", "expansive"]).default("balanced"),
  randomness: z.boolean().default(false),
});

export const PendingEffectSchema = z.object({
  remaining: z.number().int().positive(),
  effect: EffectSchema,
});

export const StoryStateSchema = z.object({
  stats: z.record(z.string(), z.number()).default({}),
  relationships: z.record(z.string(), z.number()).default({}),
  flags: z.record(z.string(), ScalarSchema).default({}),
  inventory: z.array(z.string()).default([]),
  pendingEffects: z.array(PendingEffectSchema).default([]),
});

export type Condition = z.infer<typeof ConditionSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type Mechanics = z.infer<typeof MechanicsSchema>;
export type StoryState = z.infer<typeof StoryStateSchema>;

function applyImmediate(state: StoryState, effect: Effect): StoryState {
  const next: StoryState = {
    stats: { ...state.stats },
    relationships: { ...state.relationships },
    flags: { ...state.flags },
    inventory: [...state.inventory],
    pendingEffects: [...state.pendingEffects],
  };
  switch (effect.op) {
    case "addStat":
      next.stats[effect.key] = (next.stats[effect.key] ?? 0) + effect.value;
      break;
    case "setFlag":
      next.flags[effect.key] = effect.value;
      break;
    case "addItem":
      if (!next.inventory.includes(effect.itemId)) next.inventory.push(effect.itemId);
      break;
    case "removeItem":
      next.inventory = next.inventory.filter((id) => id !== effect.itemId);
      break;
    case "addRelationship":
      next.relationships[effect.key] = (next.relationships[effect.key] ?? 0) + effect.value;
      break;
  }
  return next;
}

export function applyEffects(state: StoryState, effects: Effect[]): StoryState {
  let next = StoryStateSchema.parse(state);
  const stillPending: StoryState["pendingEffects"] = [];
  for (const pending of next.pendingEffects) {
    if (pending.remaining <= 1) next = applyImmediate(next, pending.effect);
    else stillPending.push({ ...pending, remaining: pending.remaining - 1 });
  }
  next.pendingEffects = stillPending;

  for (const effect of effects) {
    if (effect.delay) {
      const remaining = effect.delay === "nextPassage" ? 1 : effect.delay;
      next.pendingEffects.push({ remaining, effect: { ...effect, delay: undefined } });
    } else {
      next = applyImmediate(next, effect);
    }
  }
  return next;
}

export function isConditionMet(state: StoryState, condition: Condition): boolean {
  switch (condition.kind) {
    case "statAtLeast": return (state.stats[condition.key] ?? 0) >= condition.value;
    case "flagEquals": return state.flags[condition.key] === condition.value;
    case "hasItem": return state.inventory.includes(condition.itemId);
    case "relationshipAtLeast": return (state.relationships[condition.key] ?? 0) >= condition.value;
  }
}

export function relationshipLabel(mechanics: Mechanics, key: string, value: number): string | undefined {
  const relationship = mechanics.relationships[key];
  if (!relationship) return undefined;
  return [...relationship.bands]
    .sort((a, b) => b.min - a.min)
    .find((band) => value >= band.min)?.label ?? relationship.label;
}
