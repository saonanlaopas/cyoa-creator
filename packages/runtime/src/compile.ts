import { stableFingerprint } from "./canonical.js";
import {
  conditionCompatible,
  createRuntimeMechanicRegistry,
  effectCompatible,
  RuntimeSemanticError,
} from "./semantics.js";
import type {
  CompiledRuntime,
  RuntimeCompileFinding,
  RuntimeCompileSource,
  RuntimeCondition,
  RuntimeMechanicDefinition,
} from "./types.js";

export type CompiledRuntimeSemantics = Pick<
  CompiledRuntime,
  "schemaVersion" | "simulationPolicyVersion" | "startPassageId" | "mechanics" | "passages"
  | "choices" | "endings" | "routeIds" | "decisionIds"
>;

export function compiledRuntimeSemantics(runtime: CompiledRuntimeSemantics): CompiledRuntimeSemantics {
  return {
    schemaVersion: runtime.schemaVersion,
    simulationPolicyVersion: runtime.simulationPolicyVersion,
    startPassageId: runtime.startPassageId,
    mechanics: runtime.mechanics,
    passages: runtime.passages,
    choices: runtime.choices,
    endings: runtime.endings,
    routeIds: runtime.routeIds,
    decisionIds: runtime.decisionIds,
  };
}

export function compiledRuntimeFingerprint(runtime: CompiledRuntimeSemantics): string {
  return stableFingerprint(compiledRuntimeSemantics(runtime));
}

export class RuntimeCompileError extends Error {
  public constructor(public readonly findings: RuntimeCompileFinding[]) {
    super(findings[0]?.message ?? "Runtime compilation failed");
  }
}

function gateCondition(
  condition: RuntimeCompileSource["mechanics"]["gates"][number]["conditions"][number],
  definition: RuntimeMechanicDefinition | undefined,
): RuntimeCondition | null {
  if (!definition) return null;
  if (condition.operator === "at-least") return condition.value === null ? null : {
    kind: "compare", mechanicKey: condition.mechanicKey, operator: "gte", value: condition.value,
  };
  if (condition.operator === "at-most") return condition.value === null ? null : {
    kind: "compare", mechanicKey: condition.mechanicKey, operator: "lte", value: condition.value,
  };
  if (condition.operator === "equals") return condition.value === null ? null : {
    kind: "compare", mechanicKey: condition.mechanicKey, operator: "eq", value: condition.value,
  };
  const presentValue = definition.valueType === "boolean" ? true : definition.valueType === "number" ? 0 : "";
  return {
    kind: "compare",
    mechanicKey: condition.mechanicKey,
    operator: condition.operator === "present"
      ? definition.valueType === "boolean" ? "eq" : "neq"
      : definition.valueType === "boolean" ? "eq" : "eq",
    value: condition.operator === "absent" && definition.valueType === "boolean" ? false : presentValue,
  };
}

export function compileRuntime(source: RuntimeCompileSource): CompiledRuntime {
  const findings: RuntimeCompileFinding[] = [];
  const add = (finding: RuntimeCompileFinding): void => { findings.push(finding); };
  let mechanics: Record<string, RuntimeMechanicDefinition> = {};
  try {
    mechanics = createRuntimeMechanicRegistry(source.mechanics);
  } catch (error) {
    const semantic = error as RuntimeSemanticError;
    add({ code: "runtime.mechanic.invalid", message: semantic.message, mechanicKey: semantic.mechanicKey });
  }
  const routeIds = new Set(source.routeIds);
  const decisionIds = new Set(source.routeDecisionIds);
  const endingIds = new Set(source.endings.map((ending) => ending.id));
  const passages = Object.fromEntries([...source.passageVersions]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((passage) => [passage.id, {
      id: passage.id,
      choiceIds: [...passage.choiceIds],
      terminal: passage.terminal,
      endingId: passage.endingId,
      routeIds: [...passage.routeIds].sort(),
      requiredFactIds: [...passage.requiredFactIds].sort(),
      revealedFactIds: [...passage.revealedFactIds].sort(),
    }]));
  if (!source.startPassageId || !passages[source.startPassageId]) add({
    code: "runtime.start.invalid", message: "Runtime start passage is missing", passageId: source.startPassageId ?? undefined,
  });
  const routeGateConditions = new Map<string, RuntimeCondition[]>();
  const endingGateConditions = new Map<string, RuntimeCondition[]>();
  for (const gate of [...source.mechanics.gates].sort((left, right) => left.id.localeCompare(right.id))) {
    if ((gate.targetType === "route" && !routeIds.has(gate.targetId))
      || (gate.targetType === "ending" && !endingIds.has(gate.targetId))) add({
      code: "runtime.gate.target-missing", message: `Runtime gate ${gate.id} has an unknown target`,
      ...(gate.targetType === "ending" ? { endingId: gate.targetId } : {}),
    });
    const conditions = gate.conditions.map((condition) => {
      const compiled = gateCondition(condition, mechanics[condition.mechanicKey]);
      if (!compiled || !conditionCompatible(compiled, mechanics)) add({
        code: "runtime.gate.condition-invalid", message: `Runtime gate ${gate.id} has an invalid condition`,
        mechanicKey: condition.mechanicKey,
      });
      return compiled;
    }).filter((item): item is RuntimeCondition => Boolean(item));
    const expression: RuntimeCondition = gate.logic === "all" ? { kind: "all", items: conditions } : { kind: "any", items: conditions };
    const target = gate.targetType === "route" ? routeGateConditions : endingGateConditions;
    target.set(gate.targetId, [...(target.get(gate.targetId) ?? []), expression]);
  }
  const choices = Object.fromEntries([...source.choiceVersions]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((choice) => {
      const sourcePassage = passages[choice.sourcePassageId];
      const destination = passages[choice.destinationPassageId];
      if (!sourcePassage) add({ code: "runtime.choice.source-missing", message: `Choice ${choice.id} source is missing`, choiceId: choice.id, passageId: choice.sourcePassageId });
      else if (!sourcePassage.choiceIds.includes(choice.id)) add({ code: "runtime.choice.source-unlisted", message: `Choice ${choice.id} is not listed by its source passage`, choiceId: choice.id, passageId: choice.sourcePassageId });
      if (!destination) add({ code: "runtime.choice.destination-missing", message: `Choice ${choice.id} destination is missing`, choiceId: choice.id, passageId: choice.destinationPassageId });
      if (!conditionCompatible(choice.condition, mechanics)) add({ code: "runtime.choice.condition-invalid", message: `Choice ${choice.id} has an invalid condition`, choiceId: choice.id });
      for (const effect of choice.effects) if (!effectCompatible(effect, mechanics[effect.mechanicKey])) add({
        code: "runtime.choice.effect-invalid", message: `Choice ${choice.id} has an invalid effect ${effect.id}`,
        choiceId: choice.id, mechanicKey: effect.mechanicKey,
      });
      for (const decisionId of choice.sourceDecisionIds) if (!decisionIds.has(decisionId)) add({
        code: "runtime.choice.decision-missing", message: `Choice ${choice.id} references unknown decision ${decisionId}`, choiceId: choice.id,
      });
      const gates = destination?.routeIds.flatMap((routeId) => routeGateConditions.get(routeId) ?? []) ?? [];
      return [choice.id, {
        id: choice.id,
        sourcePassageId: choice.sourcePassageId,
        destinationPassageId: choice.destinationPassageId,
        condition: choice.condition,
        routeGateConditions: gates,
        unavailableBehavior: choice.unavailableBehavior,
        unavailableExplanation: choice.unavailableExplanation,
        effects: choice.effects,
        sourceDecisionIds: [...choice.sourceDecisionIds].sort(),
        position: choice.position,
      }];
    }));
  for (const passage of Object.values(passages)) {
    if (passage.terminal && passage.choiceIds.length) add({ code: "runtime.terminal.outgoing", message: `Terminal passage ${passage.id} has outgoing choices`, passageId: passage.id });
    if (passage.terminal && (!passage.endingId || !endingIds.has(passage.endingId))) add({ code: "runtime.terminal.ending-invalid", message: `Terminal passage ${passage.id} has no valid ending`, passageId: passage.id, endingId: passage.endingId ?? undefined });
    if (!passage.terminal && !passage.choiceIds.length) add({ code: "runtime.passage.dead-end", message: `Nonterminal passage ${passage.id} has no choices`, passageId: passage.id });
    for (const routeId of passage.routeIds) if (!routeIds.has(routeId)) add({ code: "runtime.passage.route-missing", message: `Passage ${passage.id} references unknown route ${routeId}`, passageId: passage.id });
    for (const choiceId of passage.choiceIds) if (!choices[choiceId] || choices[choiceId].sourcePassageId !== passage.id) add({ code: "runtime.passage.choice-invalid", message: `Passage ${passage.id} has invalid choice ${choiceId}`, passageId: passage.id, choiceId });
  }
  const endings = Object.fromEntries([...source.endings].sort((left, right) => left.id.localeCompare(right.id)).map((ending) => {
    if (!routeIds.has(ending.routeId)) add({ code: "runtime.ending.route-missing", message: `Ending ${ending.id} references unknown route ${ending.routeId}`, endingId: ending.id });
    return [ending.id, { id: ending.id, routeId: ending.routeId, gateConditions: endingGateConditions.get(ending.id) ?? [] }];
  }));
  findings.sort((left, right) => left.code.localeCompare(right.code)
    || (left.passageId ?? "").localeCompare(right.passageId ?? "")
    || (left.choiceId ?? "").localeCompare(right.choiceId ?? ""));
  if (findings.length) throw new RuntimeCompileError(findings);
  const runtimeSemantics = {
    schemaVersion: 1 as const,
    simulationPolicyVersion: "foundation-5a-v1" as const,
    startPassageId: source.startPassageId!,
    mechanics,
    passages,
    choices,
    endings,
    routeIds: [...source.routeIds].sort(),
    decisionIds: [...source.routeDecisionIds].sort(),
  };
  return {
    ...runtimeSemantics,
    sourceSnapshotId: source.snapshotId,
    sourceStructureVersionId: source.structureVersionId,
    fingerprint: compiledRuntimeFingerprint(runtimeSemantics),
  };
}
