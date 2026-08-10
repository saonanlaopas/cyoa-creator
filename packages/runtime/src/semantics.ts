import type {
  RuntimeCondition,
  RuntimeEffect,
  RuntimeMechanicDefinition,
  RuntimeMechanicsSource,
  RuntimeScalar,
  RuntimeState,
  RuntimeStateDelta,
} from "./types.js";

export class RuntimeSemanticError extends Error {
  public constructor(
    public readonly code: "condition_invalid" | "effect_invalid" | "effect_out_of_bounds" | "state_invalid",
    message: string,
    public readonly mechanicKey?: string,
  ) {
    super(message);
  }
}

export function createRuntimeMechanicRegistry(source: RuntimeMechanicsSource): Record<string, RuntimeMechanicDefinition> {
  const entries: Array<[string, RuntimeMechanicDefinition]> = [];
  for (const item of source.visibleStats) entries.push([item.key, {
    key: item.key, category: "stat", valueType: "number", initial: item.initial,
    minimum: item.minimum, maximum: item.maximum,
  }]);
  for (const item of source.relationships) entries.push([item.key, {
    key: item.key, category: "relationship", valueType: "number", initial: item.initial,
    minimum: item.minimum, maximum: item.maximum,
    bands: [...item.bands].sort((left, right) => left.minimum - right.minimum || left.label.localeCompare(right.label)),
  }]);
  for (const item of source.flags) entries.push([item.key, {
    key: item.key, category: "flag", valueType: "boolean", initial: false,
  }]);
  for (const item of source.resources) entries.push([item.key, item.kind === "inventory" ? {
    key: item.key, category: "resource", valueType: "string", initial: "",
  } : {
    key: item.key, category: "resource", valueType: "number", initial: item.initial, minimum: 0,
  }]);
  const result: Record<string, RuntimeMechanicDefinition> = {};
  for (const [key, definition] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (result[key]) throw new RuntimeSemanticError("state_invalid", `Duplicate runtime mechanic key: ${key}`, key);
    if (definition.valueType === "number" && (typeof definition.initial !== "number"
      || (definition.minimum !== undefined && definition.initial < definition.minimum)
      || (definition.maximum !== undefined && definition.initial > definition.maximum))) {
      throw new RuntimeSemanticError("state_invalid", `Runtime mechanic ${key} has an invalid initial value`, key);
    }
    result[key] = definition;
  }
  return result;
}

function compare(actual: RuntimeScalar, operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte", expected: RuntimeScalar): boolean {
  if (operator === "eq") return actual === expected;
  if (operator === "neq") return actual !== expected;
  if (typeof actual !== "number" || typeof expected !== "number") {
    throw new RuntimeSemanticError("condition_invalid", `Ordered comparison requires numeric values`);
  }
  if (operator === "gt") return actual > expected;
  if (operator === "gte") return actual >= expected;
  if (operator === "lt") return actual < expected;
  return actual <= expected;
}

export function mechanicValue(state: RuntimeState, definition: RuntimeMechanicDefinition): RuntimeScalar {
  if (definition.category === "stat") return state.stats[definition.key] ?? definition.initial;
  if (definition.category === "relationship") return state.relationships[definition.key] ?? definition.initial;
  if (definition.category === "flag") return state.flags[definition.key] ?? definition.initial;
  return state.resources[definition.key] ?? definition.initial;
}

export function conditionCompatible(
  condition: RuntimeCondition | null,
  registry: Record<string, RuntimeMechanicDefinition>,
): boolean {
  if (!condition) return true;
  if (condition.kind === "all" || condition.kind === "any") {
    return condition.items.length > 0 && condition.items.every((item) => conditionCompatible(item, registry));
  }
  if (condition.kind === "not") return conditionCompatible(condition.item, registry);
  if (condition.kind === "visit-count") return Number.isInteger(condition.value) && condition.value >= 0;
  const definition = registry[condition.mechanicKey];
  if (!definition) return false;
  if (["gt", "gte", "lt", "lte"].includes(condition.operator)) {
    return definition.valueType === "number" && typeof condition.value === "number";
  }
  return typeof condition.value === definition.valueType;
}

export function evaluateRuntimeCondition(
  condition: RuntimeCondition | null,
  state: RuntimeState,
  registry: Record<string, RuntimeMechanicDefinition>,
): boolean {
  if (!condition) return true;
  if (condition.kind === "all") {
    if (!condition.items.length) throw new RuntimeSemanticError("condition_invalid", "An all condition requires at least one item");
    return condition.items.every((item) => evaluateRuntimeCondition(item, state, registry));
  }
  if (condition.kind === "any") {
    if (!condition.items.length) throw new RuntimeSemanticError("condition_invalid", "An any condition requires at least one item");
    return condition.items.some((item) => evaluateRuntimeCondition(item, state, registry));
  }
  if (condition.kind === "not") return !evaluateRuntimeCondition(condition.item, state, registry);
  if (condition.kind === "visit-count") {
    if (!Number.isInteger(condition.value) || condition.value < 0) {
      throw new RuntimeSemanticError("condition_invalid", "Visit-count condition requires a non-negative integer");
    }
    return compare(state.visitCounts[condition.passageId] ?? 0, condition.operator, condition.value);
  }
  const definition = registry[condition.mechanicKey];
  if (!definition || !conditionCompatible(condition, registry)) {
    throw new RuntimeSemanticError("condition_invalid", `Invalid condition for mechanic ${condition.mechanicKey}`, condition.mechanicKey);
  }
  return compare(mechanicValue(state, definition), condition.operator, condition.value);
}

export type RuntimeStaticTruth = "always-true" | "always-false" | "unknown";

export function conditionStaticTruth(
  condition: RuntimeCondition | null,
  registry: Record<string, RuntimeMechanicDefinition>,
  writableMechanics: Set<string>,
): RuntimeStaticTruth {
  if (!condition) return "always-true";
  if (condition.kind === "all") {
    const values = condition.items.map((item) => conditionStaticTruth(item, registry, writableMechanics));
    if (values.includes("always-false")) return "always-false";
    return values.length > 0 && values.every((value) => value === "always-true") ? "always-true" : "unknown";
  }
  if (condition.kind === "any") {
    const values = condition.items.map((item) => conditionStaticTruth(item, registry, writableMechanics));
    if (values.includes("always-true")) return "always-true";
    return values.length > 0 && values.every((value) => value === "always-false") ? "always-false" : "unknown";
  }
  if (condition.kind === "not") {
    const value = conditionStaticTruth(condition.item, registry, writableMechanics);
    return value === "always-true" ? "always-false" : value === "always-false" ? "always-true" : "unknown";
  }
  if (condition.kind === "visit-count") return "unknown";
  const definition = registry[condition.mechanicKey];
  if (!definition || !conditionCompatible(condition, registry)) return "unknown";
  if (!writableMechanics.has(condition.mechanicKey)) {
    return compare(definition.initial, condition.operator, condition.value) ? "always-true" : "always-false";
  }
  if (definition.valueType !== "number" || typeof condition.value !== "number") return "unknown";
  if (condition.operator === "gt" && definition.maximum !== undefined && condition.value >= definition.maximum) return "always-false";
  if (condition.operator === "gte" && definition.maximum !== undefined && condition.value > definition.maximum) return "always-false";
  if (condition.operator === "lt" && definition.minimum !== undefined && condition.value <= definition.minimum) return "always-false";
  if (condition.operator === "lte" && definition.minimum !== undefined && condition.value < definition.minimum) return "always-false";
  if (condition.operator === "eq" && definition.minimum !== undefined && definition.maximum !== undefined
    && (condition.value < definition.minimum || condition.value > definition.maximum)) return "always-false";
  if (condition.operator === "neq" && definition.minimum !== undefined && definition.maximum !== undefined
    && definition.minimum === definition.maximum && condition.value === definition.minimum) return "always-false";
  return "unknown";
}

export function effectCompatible(effect: RuntimeEffect, definition: RuntimeMechanicDefinition | undefined): boolean {
  if (!definition) return false;
  if (definition.valueType === "boolean") {
    return (effect.operation === "set" && typeof effect.value === "boolean")
      || (effect.operation === "clear" && effect.value === null);
  }
  if (definition.valueType === "number") {
    if (!["set", "add", "subtract"].includes(effect.operation) || typeof effect.value !== "number") return false;
    return effect.operation !== "set" || definition.minimum === undefined || definition.maximum === undefined
      || (effect.value >= definition.minimum && effect.value <= definition.maximum);
  }
  return effect.operation === "set" && typeof effect.value === "string";
}

export function createInitialRuntimeState(
  startPassageId: string,
  registry: Record<string, RuntimeMechanicDefinition>,
): RuntimeState {
  const state: RuntimeState = {
    currentPassageId: startPassageId,
    stats: {}, relationships: {}, flags: {}, resources: {}, decisions: [], routes: [], knownFacts: [], visitCounts: {}, turn: 0,
  };
  for (const definition of Object.values(registry)) {
    if (definition.category === "stat") state.stats[definition.key] = definition.initial as number;
    else if (definition.category === "relationship") state.relationships[definition.key] = definition.initial as number;
    else if (definition.category === "flag") state.flags[definition.key] = definition.initial as boolean;
    else state.resources[definition.key] = definition.initial as number | string;
  }
  return state;
}

function setMechanicValue(state: RuntimeState, definition: RuntimeMechanicDefinition, value: RuntimeScalar): void {
  if (definition.category === "stat") state.stats[definition.key] = value as number;
  else if (definition.category === "relationship") state.relationships[definition.key] = value as number;
  else if (definition.category === "flag") state.flags[definition.key] = value as boolean;
  else state.resources[definition.key] = value as number | string;
}

export function cloneRuntimeState(state: RuntimeState): RuntimeState {
  return {
    currentPassageId: state.currentPassageId,
    stats: { ...state.stats }, relationships: { ...state.relationships }, flags: { ...state.flags }, resources: { ...state.resources },
    decisions: [...state.decisions], routes: [...state.routes], knownFacts: [...state.knownFacts],
    visitCounts: { ...state.visitCounts }, turn: state.turn,
  };
}

export function applyRuntimeEffects(
  state: RuntimeState,
  effects: RuntimeEffect[],
  registry: Record<string, RuntimeMechanicDefinition>,
): { state: RuntimeState; deltas: RuntimeStateDelta[] } {
  const next = cloneRuntimeState(state);
  const deltas: RuntimeStateDelta[] = [];
  for (const effect of effects) {
    const definition = registry[effect.mechanicKey];
    if (!effectCompatible(effect, definition)) {
      throw new RuntimeSemanticError("effect_invalid", `Invalid effect ${effect.id} for mechanic ${effect.mechanicKey}`, effect.mechanicKey);
    }
    const before = mechanicValue(next, definition!);
    let after: RuntimeScalar;
    if (effect.operation === "clear") after = false;
    else if (effect.operation === "set") after = effect.value as RuntimeScalar;
    else if (effect.operation === "add") after = (before as number) + (effect.value as number);
    else after = (before as number) - (effect.value as number);
    if (definition!.valueType === "number" && ((definition!.minimum !== undefined && (after as number) < definition!.minimum)
      || (definition!.maximum !== undefined && (after as number) > definition!.maximum))) {
      throw new RuntimeSemanticError("effect_out_of_bounds", `Effect ${effect.id} moves ${effect.mechanicKey} outside its bounds`, effect.mechanicKey);
    }
    setMechanicValue(next, definition!, after);
    if (before !== after) deltas.push({ path: `${definition!.category}.${effect.mechanicKey}`, before, after });
  }
  return { state: next, deltas };
}
