import { serializedBytes, stableFingerprint } from "./canonical.js";
import {
  applyRuntimeEffects,
  cloneRuntimeState,
  createInitialRuntimeState,
  evaluateRuntimeCondition,
  RuntimeSemanticError,
} from "./semantics.js";
import type {
  CompiledRuntime,
  DeterministicPathDefinition,
  RuntimeChoiceAvailability,
  RuntimeFinding,
  RuntimeFindingCode,
  RuntimeResult,
  RuntimeState,
  RuntimeStateDelta,
  RuntimeTrace,
  RuntimeTraceStep,
} from "./types.js";

export const DEFAULT_DETERMINISTIC_PATH_POLICY = Object.freeze({
  version: "foundation-5a-v1" as const,
  maxSteps: 1_000,
  maxVisitsPerPassage: 20,
  maxTraceBytes: 5_000_000,
});

export class RuntimeTraceLimitError extends Error {
  public readonly code = "runtime_trace_request_too_large";

  public constructor(public readonly serializedBytes: number, public readonly maximumBytes: number) {
    super(`Deterministic path and initial trace require ${serializedBytes} bytes; maximum is ${maximumBytes}`);
  }
}

function sortedUnion(values: string[], additions: string[]): string[] {
  return [...new Set([...values, ...additions])].sort();
}

function enterPassage(runtime: CompiledRuntime, state: RuntimeState, passageId: string): RuntimeState {
  const passage = runtime.passages[passageId];
  if (!passage) return { ...cloneRuntimeState(state), currentPassageId: passageId };
  const next = cloneRuntimeState(state);
  next.currentPassageId = passageId;
  next.visitCounts[passageId] = (next.visitCounts[passageId] ?? 0) + 1;
  // A terminal passage's route IDs classify its ending; they cannot establish
  // route eligibility immediately before that ending is resolved.
  if (!passage.terminal) next.routes = sortedUnion(next.routes, passage.routeIds);
  next.knownFacts = sortedUnion(next.knownFacts, passage.revealedFactIds);
  return next;
}

export function initializeRuntimeState(runtime: CompiledRuntime): RuntimeState {
  return enterPassage(runtime, createInitialRuntimeState(runtime.startPassageId, runtime.mechanics), runtime.startPassageId);
}

export function evaluateRuntimeChoice(
  runtime: CompiledRuntime,
  state: RuntimeState,
  choiceId: string,
): RuntimeChoiceAvailability {
  const choice = runtime.choices[choiceId];
  if (!choice) return { choiceId, visible: false, enabled: false, reason: "Choice does not exist", conditionResult: false };
  const conditionResult = evaluateRuntimeCondition(choice.condition, state, runtime.mechanics)
    && choice.routeGateConditions.every((condition) => evaluateRuntimeCondition(condition, state, runtime.mechanics));
  return {
    choiceId,
    visible: conditionResult || choice.unavailableBehavior !== "hidden",
    enabled: conditionResult,
    reason: conditionResult ? null : choice.unavailableExplanation || "Choice requirements are not satisfied",
    conditionResult,
  };
}

export function listRuntimeChoices(runtime: CompiledRuntime, state: RuntimeState): RuntimeChoiceAvailability[] {
  const passage = runtime.passages[state.currentPassageId];
  if (!passage) return [];
  return passage.choiceIds.map((choiceId) => runtime.choices[choiceId]).filter(Boolean)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    .map((choice) => evaluateRuntimeChoice(runtime, state, choice.id));
}

function stateDelta(before: RuntimeState, after: RuntimeState): RuntimeStateDelta[] {
  const deltas: RuntimeStateDelta[] = [];
  const compareRecord = (prefix: string, left: Record<string, number | boolean | string>, right: Record<string, number | boolean | string>) => {
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      if (left[key] !== right[key]) deltas.push({ path: `${prefix}.${key}`, before: left[key] ?? null, after: right[key] ?? null });
    }
  };
  compareRecord("stats", before.stats, after.stats);
  compareRecord("relationships", before.relationships, after.relationships);
  compareRecord("flags", before.flags, after.flags);
  compareRecord("resources", before.resources, after.resources);
  if (before.currentPassageId !== after.currentPassageId) deltas.push({ path: "currentPassageId", before: before.currentPassageId, after: after.currentPassageId });
  if (before.turn !== after.turn) deltas.push({ path: "turn", before: before.turn, after: after.turn });
  for (const [path, left, right] of [
    ["decisions", before.decisions, after.decisions],
    ["routes", before.routes, after.routes],
    ["knownFacts", before.knownFacts, after.knownFacts],
  ] as const) if (left.join("\0") !== right.join("\0")) deltas.push({ path, before: left.join(","), after: right.join(",") });
  compareRecord("visitCounts", before.visitCounts, after.visitCounts);
  return deltas;
}

function finding(input: Omit<RuntimeFinding, "id">): RuntimeFinding {
  return { ...input, id: `rtf_${stableFingerprint(input)}` };
}

function result(kind: RuntimeResult["kind"], passageId: string, endingId: string | null = null, eligible: boolean | null = null): RuntimeResult {
  return { kind, passageId, endingId, eligible };
}

function matchesExpected(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(expected as Record<string, unknown>).every(([key, value]) => (
      matchesExpected((actual as Record<string, unknown>)[key], value)
    ));
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function resolveRuntimeTerminal(
  runtime: CompiledRuntime,
  state: RuntimeState,
): { result: RuntimeResult | null; conditionResults: boolean[] } {
  const passage = runtime.passages[state.currentPassageId];
  if (!passage || !passage.terminal) return { result: null, conditionResults: [] };
  const ending = passage.endingId ? runtime.endings[passage.endingId] : undefined;
  if (!ending) return { result: result("blocked", state.currentPassageId), conditionResults: [] };
  const conditionResults = ending.gateConditions.map((condition) => evaluateRuntimeCondition(condition, state, runtime.mechanics));
  const routeEligible = !ending.routeId || state.routes.includes(ending.routeId);
  const eligible = routeEligible && conditionResults.every(Boolean);
  return {
    result: result(eligible ? "completed-ending" : "ending-ineligible", state.currentPassageId, ending.id, eligible),
    conditionResults,
  };
}

function normalizedFailure(
  runtime: CompiledRuntime,
  simulationInputFingerprint: string,
  code: RuntimeFindingCode,
  message: string,
  stepIndex: number,
  state: RuntimeState,
  details: Partial<Pick<RuntimeFinding, "passageId" | "choiceId" | "mechanicKey" | "endingId">> = {},
): RuntimeFinding {
  return finding({
    code, message, simulationInputFingerprint, compiledRuntimeFingerprint: runtime.fingerprint,
    stepIndex, passageId: state.currentPassageId, ...details,
  });
}

function outcomeFindings(
  runtime: CompiledRuntime,
  simulationInputFingerprint: string,
  path: DeterministicPathDefinition,
  state: RuntimeState,
  finalResult: RuntimeResult,
  stepIndex: number,
  existing: RuntimeFinding[],
): RuntimeFinding[] {
  const findings = [...existing];
  if (finalResult.kind === "ending-ineligible" && !findings.some((item) => item.code === "runtime.ending-ineligible")) {
    findings.push(normalizedFailure(
      runtime, simulationInputFingerprint, "runtime.ending-ineligible", `Ending ${finalResult.endingId} requirements are not satisfied`,
      stepIndex, state, { endingId: finalResult.endingId ?? undefined },
    ));
  }
  if (path.expectedEndingId !== undefined && path.expectedEndingId !== finalResult.endingId) findings.push(normalizedFailure(
    runtime, simulationInputFingerprint, "runtime.expected-ending-mismatch",
    `Expected ending ${path.expectedEndingId ?? "none"} but reached ${finalResult.endingId ?? "none"}`,
    stepIndex, state, { endingId: finalResult.endingId ?? undefined },
  ));
  if (path.expectedState) {
    const mismatched = Object.entries(path.expectedState).some(([key, expected]) => (
      !matchesExpected(state[key as keyof RuntimeState], expected)
    ));
    if (mismatched) findings.push(normalizedFailure(
      runtime, simulationInputFingerprint, "runtime.expected-state-mismatch",
      "Final runtime state does not match the deterministic path assertions", stepIndex, state,
    ));
  }
  return findings;
}

function createTrace(
  runtime: CompiledRuntime,
  simulationInputFingerprint: string,
  path: DeterministicPathDefinition,
  visitedPassageIds: string[],
  selectedChoiceIds: string[],
  steps: RuntimeTraceStep[],
  state: RuntimeState,
  finalResult: RuntimeResult,
  findings: RuntimeFinding[],
): RuntimeTrace {
  const traceWithoutFingerprint = {
    schemaVersion: 1 as const,
    simulationInputFingerprint,
    compiledRuntimeFingerprint: runtime.fingerprint,
    path,
    visitedPassageIds: [...visitedPassageIds],
    selectedChoiceIds: [...selectedChoiceIds],
    steps: [...steps],
    finalState: cloneRuntimeState(state),
    result: finalResult,
    findings: [...findings],
  };
  return { ...traceWithoutFingerprint, fingerprint: stableFingerprint(traceWithoutFingerprint) };
}

function traceLimitFailure(
  runtime: CompiledRuntime,
  simulationInputFingerprint: string,
  path: DeterministicPathDefinition,
  visitedPassageIds: string[],
  selectedChoiceIds: string[],
  steps: RuntimeTraceStep[],
  state: RuntimeState,
  stepIndex: number,
  choiceId?: string,
): RuntimeTrace {
  const limitFinding = normalizedFailure(
    runtime, simulationInputFingerprint, "runtime.trace-limit-reached",
    "Deterministic trace would exceed its serialized byte limit", stepIndex, state,
    choiceId ? { choiceId } : {},
  );
  return createTrace(
    runtime, simulationInputFingerprint, path, visitedPassageIds, selectedChoiceIds, steps, state,
    result("trace-limit-reached", state.currentPassageId), [limitFinding],
  );
}

export type RuntimeChoiceTransition =
  | { ok: true; state: RuntimeState; step: RuntimeTraceStep }
  | { ok: false; state: RuntimeState; finding: RuntimeFinding; result: RuntimeResult };

export function applyRuntimeChoice(
  runtime: CompiledRuntime,
  simulationInputFingerprint: string,
  state: RuntimeState,
  choiceId: string,
  stepIndex: number,
): RuntimeChoiceTransition {
  const passage = runtime.passages[state.currentPassageId];
  if (!passage) return {
    ok: false, state: cloneRuntimeState(state), result: result("blocked", state.currentPassageId),
    finding: normalizedFailure(runtime, simulationInputFingerprint, "runtime.current-passage-missing", "Current passage is missing from the runtime", stepIndex, state),
  };
  if (passage.terminal) return {
    ok: false, state: cloneRuntimeState(state), result: result("blocked", state.currentPassageId, passage.endingId),
    finding: normalizedFailure(runtime, simulationInputFingerprint, "runtime.path-after-terminal", "Path selected another choice after reaching a terminal passage", stepIndex, state, { choiceId, endingId: passage.endingId ?? undefined }),
  };
  const choice = runtime.choices[choiceId];
  if (!choice) return {
    ok: false, state: cloneRuntimeState(state), result: result("blocked", state.currentPassageId),
    finding: normalizedFailure(runtime, simulationInputFingerprint, "runtime.choice-missing", `Choice ${choiceId} does not exist`, stepIndex, state, { choiceId }),
  };
  if (choice.sourcePassageId !== state.currentPassageId || !passage.choiceIds.includes(choiceId)) return {
    ok: false, state: cloneRuntimeState(state), result: result("blocked", state.currentPassageId),
    finding: normalizedFailure(runtime, simulationInputFingerprint, "runtime.choice-wrong-source", `Choice ${choiceId} does not belong to the current passage`, stepIndex, state, { choiceId }),
  };
  let availability: RuntimeChoiceAvailability;
  try {
    availability = evaluateRuntimeChoice(runtime, state, choiceId);
  } catch (error) {
    const semantic = error as RuntimeSemanticError;
    return {
      ok: false, state: cloneRuntimeState(state), result: result("blocked", state.currentPassageId),
      finding: normalizedFailure(runtime, simulationInputFingerprint, "runtime.condition-invalid", semantic.message, stepIndex, state, { choiceId, mechanicKey: semantic.mechanicKey }),
    };
  }
  if (!availability.enabled) return {
    ok: false, state: cloneRuntimeState(state), result: result("blocked", state.currentPassageId),
    finding: normalizedFailure(runtime, simulationInputFingerprint, "runtime.choice-unavailable", availability.reason ?? "Choice is unavailable", stepIndex, state, { choiceId }),
  };
  if (!runtime.passages[choice.destinationPassageId]) return {
    ok: false, state: cloneRuntimeState(state), result: result("blocked", state.currentPassageId),
    finding: normalizedFailure(runtime, simulationInputFingerprint, "runtime.destination-missing", `Choice ${choiceId} destination is missing`, stepIndex, state, { choiceId, passageId: choice.destinationPassageId }),
  };
  const before = cloneRuntimeState(state);
  let after: RuntimeState;
  try {
    after = applyRuntimeEffects(state, choice.effects, runtime.mechanics).state;
  } catch (error) {
    const semantic = error as RuntimeSemanticError;
    return {
      ok: false, state: cloneRuntimeState(state), result: result("blocked", state.currentPassageId),
      finding: normalizedFailure(runtime, simulationInputFingerprint, "runtime.effect-invalid", semantic.message, stepIndex, state, { choiceId, mechanicKey: semantic.mechanicKey }),
    };
  }
  after.decisions = sortedUnion(after.decisions, choice.sourceDecisionIds);
  after.turn += 1;
  after = enterPassage(runtime, after, choice.destinationPassageId);
  return {
    ok: true,
    state: after,
    step: {
      stepIndex,
      passageId: before.currentPassageId,
      selectedChoiceId: choiceId,
      nextPassageId: choice.destinationPassageId,
      availability,
      stateBefore: before,
      appliedEffects: choice.effects,
      stateDelta: stateDelta(before, after),
      stateAfter: cloneRuntimeState(after),
    },
  };
}

export function runDeterministicPath(
  runtime: CompiledRuntime,
  simulationInputFingerprint: string,
  path: DeterministicPathDefinition,
): RuntimeTrace {
  const policy = path.policy;
  if (policy.version !== "foundation-5a-v1" || policy.maxSteps < 1 || policy.maxSteps > 10_000
    || policy.maxVisitsPerPassage < 1 || policy.maxVisitsPerPassage > 1_000
    || policy.maxTraceBytes < 1_000 || policy.maxTraceBytes > 20_000_000) {
    throw new Error("Invalid deterministic simulation policy");
  }
  let state = initializeRuntimeState(runtime);
  const steps: RuntimeTraceStep[] = [];
  const findings: RuntimeFinding[] = [];
  const visitedPassageIds = [state.currentPassageId];
  const selectedChoiceIds: string[] = [];
  const initialBoundedFailure = traceLimitFailure(
    runtime, simulationInputFingerprint, path, [state.currentPassageId], [], [], state, 0, path.choiceIds[0],
  );
  const initialFailureBytes = serializedBytes(initialBoundedFailure);
  if (initialFailureBytes > policy.maxTraceBytes) {
    throw new RuntimeTraceLimitError(initialFailureBytes, policy.maxTraceBytes);
  }
  let conservativeTraceBytes = initialFailureBytes;
  let finalResult: RuntimeResult | null = null;
  const terminalAtStart = resolveRuntimeTerminal(runtime, state).result;
  if (terminalAtStart && path.choiceIds.length === 0) finalResult = terminalAtStart;
  for (let stepIndex = 0; stepIndex < path.choiceIds.length && !finalResult; stepIndex += 1) {
    if (stepIndex >= policy.maxSteps) {
      findings.push(normalizedFailure(runtime, simulationInputFingerprint, "runtime.step-limit-reached", "Deterministic path exceeded its maximum step count", stepIndex, state));
      finalResult = result("step-limit-reached", state.currentPassageId);
      break;
    }
    const choiceId = path.choiceIds[stepIndex]!;
    const transition = applyRuntimeChoice(runtime, simulationInputFingerprint, state, choiceId, stepIndex);
    if (!transition.ok) {
      findings.push(transition.finding);
      finalResult = transition.result;
      break;
    }
    const step = transition.step;
    const nextState = transition.state;
    const nextSteps = [...steps, step];
    const nextVisitedPassageIds = [...visitedPassageIds, nextState.currentPassageId];
    const nextSelectedChoiceIds = [...selectedChoiceIds, choiceId];
    const nextTerminal = resolveRuntimeTerminal(runtime, nextState).result;
    const provisionalResult = nextTerminal ?? result("path-exhausted", nextState.currentPassageId);
    const finalStateGrowth = Math.max(0, serializedBytes(nextState) - serializedBytes(state));
    const projectedTraceBytes = conservativeTraceBytes + serializedBytes(step)
      + serializedBytes(choiceId) + serializedBytes(nextState.currentPassageId) + finalStateGrowth + 512;
    if (projectedTraceBytes > policy.maxTraceBytes) {
      const provisionalTrace = createTrace(
        runtime, simulationInputFingerprint, path, nextVisitedPassageIds, nextSelectedChoiceIds, nextSteps, nextState,
        provisionalResult,
        outcomeFindings(runtime, simulationInputFingerprint, path, nextState, provisionalResult, nextSteps.length, findings),
      );
      const exactProvisionalBytes = serializedBytes(provisionalTrace);
      if (exactProvisionalBytes > policy.maxTraceBytes) {
        const bounded = traceLimitFailure(
          runtime, simulationInputFingerprint, path, visitedPassageIds, selectedChoiceIds, steps, state, stepIndex, choiceId,
        );
        return serializedBytes(bounded) <= policy.maxTraceBytes ? bounded : initialBoundedFailure;
      }
      conservativeTraceBytes = exactProvisionalBytes;
    } else {
      conservativeTraceBytes = projectedTraceBytes;
    }
    state = nextState;
    steps.push(step);
    visitedPassageIds.push(state.currentPassageId);
    selectedChoiceIds.push(choiceId);
    if ((state.visitCounts[state.currentPassageId] ?? 0) > policy.maxVisitsPerPassage) {
      findings.push(normalizedFailure(runtime, simulationInputFingerprint, "runtime.cycle-guard-reached", "Deterministic path exceeded the passage visit limit", stepIndex, state, { choiceId }));
      finalResult = result("cycle-guard-reached", state.currentPassageId);
      break;
    }
    if (nextTerminal) finalResult = nextTerminal;
  }
  if (!finalResult) {
    const terminal = resolveRuntimeTerminal(runtime, state).result;
    finalResult = terminal ?? result("path-exhausted", state.currentPassageId);
  }
  const completed = createTrace(
    runtime, simulationInputFingerprint, path, visitedPassageIds, selectedChoiceIds, steps, state, finalResult,
    outcomeFindings(runtime, simulationInputFingerprint, path, state, finalResult, steps.length, findings),
  );
  if (serializedBytes(completed) <= policy.maxTraceBytes) return completed;
  const bounded = traceLimitFailure(
    runtime, simulationInputFingerprint, path, visitedPassageIds, selectedChoiceIds, steps, state, steps.length,
  );
  if (serializedBytes(bounded) <= policy.maxTraceBytes) return bounded;
  return initialBoundedFailure;
}
