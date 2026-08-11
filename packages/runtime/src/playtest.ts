import { serializedBytes, stableFingerprint } from "./canonical.js";
import {
  applyRuntimeChoice,
  initializeRuntimeState,
  listRuntimeChoices,
  resolveRuntimeTerminal,
} from "./engine.js";
import { PLAYTEST_PRNG_VERSION, DeterministicPlaytestPrng } from "./prng.js";
import {
  PLAYTEST_BACKEND_LIMITS,
  PLAYTEST_POLICY_VERSION,
  PLAYTEST_STRATEGY_VERSION,
  type ChoiceCoverageItem,
  type CompactPlaytestStep,
  type CompactPlaytestTrace,
  type ContinuityReport,
  type EndingCoverageItem,
  type MechanicTrajectoryReport,
  type PassageCoverageItem,
  type PacingReport,
  type PlaytestAggregateReport,
  type PlaytestAnalysisSource,
  type PlaytestCampaignRecord,
  type PlaytestEvidenceLevel,
  type PlaytestFinding,
  type PlaytestFindingCategory,
  type PlaytestPolicy,
  type PlaytestPolicyInputRuntimeBounds,
  type PlaytestPolicyRequest,
  type PlaytestSampleSummary,
  type PlaytestThreadEvidence,
  type PlaytestWordSummary,
  type ReplayPlaytestSampleResult,
  type RouteCoverageItem,
  type RouteExclusiveReportItem,
  type RunPlaytestCampaignInput,
} from "./playtest-types.js";
import type {
  CompiledRuntime,
  RuntimeCondition,
  RuntimeFinding,
  RuntimeMechanicDefinition,
  RuntimeResult,
  RuntimeScalar,
  RuntimeState,
  RuntimeTraceStep,
} from "./types.js";

export class PlaytestPolicyError extends Error {
  public constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export class PlaytestIntegrityError extends Error {
  public readonly code = "playtest_evidence_integrity_failure";
}

export function createPlaytestPolicy(
  request: PlaytestPolicyRequest,
  runtimeBounds: PlaytestPolicyInputRuntimeBounds,
): PlaytestPolicy {
  const sampleCount = integer(request.sampleCount ?? 100, "sampleCount");
  const maxStepsPerSample = integer(
    request.maxStepsPerSample ?? Math.min(300, runtimeBounds.maxSteps, PLAYTEST_BACKEND_LIMITS.maxStepsPerSample),
    "maxStepsPerSample",
  );
  const maxVisitsPerPassage = integer(
    request.maxVisitsPerPassage ?? Math.min(runtimeBounds.maxVisitsPerPassage, PLAYTEST_BACKEND_LIMITS.maxVisitsPerPassage),
    "maxVisitsPerPassage",
  );
  const maxTraceBytesPerSample = integer(
    request.maxTraceBytesPerSample
      ?? Math.min(runtimeBounds.maxTraceBytes, PLAYTEST_BACKEND_LIMITS.maxTraceBytesPerSample),
    "maxTraceBytesPerSample",
  );
  const linearStretchThreshold = integer(request.linearStretchThreshold ?? 4, "linearStretchThreshold");
  const denseChoiceThreshold = integer(request.denseChoiceThreshold ?? 5, "denseChoiceThreshold");
  if (sampleCount < 1 || sampleCount > PLAYTEST_BACKEND_LIMITS.maxSamples) {
    throw new PlaytestPolicyError("playtest_sample_count_invalid", `Sample count must be between 1 and ${PLAYTEST_BACKEND_LIMITS.maxSamples}`);
  }
  if (maxStepsPerSample < 1 || maxStepsPerSample > runtimeBounds.maxSteps
    || maxStepsPerSample > PLAYTEST_BACKEND_LIMITS.maxStepsPerSample) {
    throw new PlaytestPolicyError("playtest_step_bound_invalid", "Playtest step limits may lower but never raise runtime/backend bounds");
  }
  if (maxVisitsPerPassage < 1 || maxVisitsPerPassage > runtimeBounds.maxVisitsPerPassage
    || maxVisitsPerPassage > PLAYTEST_BACKEND_LIMITS.maxVisitsPerPassage) {
    throw new PlaytestPolicyError("playtest_visit_bound_invalid", "Playtest visit limits may lower but never raise runtime/backend bounds");
  }
  if (maxTraceBytesPerSample < 1_000 || maxTraceBytesPerSample > runtimeBounds.maxTraceBytes
    || maxTraceBytesPerSample > PLAYTEST_BACKEND_LIMITS.maxTraceBytesPerSample) {
    throw new PlaytestPolicyError("playtest_trace_bound_invalid", "Playtest trace limits may lower but never raise runtime/backend bounds");
  }
  if (linearStretchThreshold < 2 || linearStretchThreshold > 20
    || denseChoiceThreshold < 3 || denseChoiceThreshold > 20) {
    throw new PlaytestPolicyError("playtest_threshold_invalid", "Experience-analysis thresholds are outside backend bounds");
  }
  const requestedWork = sampleCount * maxStepsPerSample;
  if (requestedWork > PLAYTEST_BACKEND_LIMITS.maxTotalSampledSteps) {
    throw new PlaytestPolicyError(
      "playtest_total_work_too_large",
      `Requested campaign permits ${requestedWork} steps; maximum is ${PLAYTEST_BACKEND_LIMITS.maxTotalSampledSteps}`,
    );
  }
  return {
    version: PLAYTEST_POLICY_VERSION,
    prngVersion: PLAYTEST_PRNG_VERSION,
    strategyVersion: PLAYTEST_STRATEGY_VERSION,
    sampleCount,
    maxStepsPerSample,
    maxVisitsPerPassage,
    maxTraceBytesPerSample,
    maxTotalSampledSteps: PLAYTEST_BACKEND_LIMITS.maxTotalSampledSteps,
    maxCampaignBytes: PLAYTEST_BACKEND_LIMITS.maxCampaignBytes,
    maxFindings: PLAYTEST_BACKEND_LIMITS.maxFindings,
    maxFindingBytes: PLAYTEST_BACKEND_LIMITS.maxFindingBytes,
    maxRetainedFullTraces: PLAYTEST_BACKEND_LIMITS.maxRetainedFullTraces,
    maxChoiceIdsPerCampaign: PLAYTEST_BACKEND_LIMITS.maxChoiceIdsPerCampaign,
    linearStretchThreshold,
    denseChoiceThreshold,
  };
}

function integer(value: number, field: string): number {
  if (!Number.isSafeInteger(value)) throw new PlaytestPolicyError("playtest_policy_invalid", `${field} must be an integer`);
  return value;
}

interface ChoiceObservation {
  stepIndex: number;
  passageId: string;
  enabledChoiceIds: string[];
  authoredChoiceCount: number;
}

interface ExecutedSample {
  trace: CompactPlaytestTrace;
  runtimeSteps: RuntimeTraceStep[];
  observations: ChoiceObservation[];
}

interface SelectionCoverage {
  choiceSelections: Map<string, number>;
  passageVisits: Map<string, number>;
  routeSamples: Map<string, number>;
}

function runtimeResult(
  kind: RuntimeResult["kind"],
  passageId: string,
  endingId: string | null = null,
  eligible: boolean | null = null,
): RuntimeResult {
  return { kind, passageId, endingId, eligible };
}

function samplePolicy(policy: PlaytestPolicy): CompactPlaytestTrace["policy"] {
  return {
    version: policy.version,
    maxStepsPerSample: policy.maxStepsPerSample,
    maxVisitsPerPassage: policy.maxVisitsPerPassage,
    maxTraceBytesPerSample: policy.maxTraceBytesPerSample,
  };
}

function finalizeTrace(input: Omit<CompactPlaytestTrace, "fingerprint">): CompactPlaytestTrace {
  return { ...input, fingerprint: stableFingerprint(input) };
}

function traceFallback(
  runtime: CompiledRuntime,
  inputFingerprint: string,
  sampleSeed: string,
  sampleIndex: number,
  policy: PlaytestPolicy,
  initialState: RuntimeState,
): CompactPlaytestTrace {
  return finalizeTrace({
    schemaVersion: 1,
    simulationInputFingerprint: inputFingerprint,
    compiledRuntimeFingerprint: runtime.fingerprint,
    sampleSeed,
    sampleIndex,
    policy: samplePolicy(policy),
    visitedPassageIds: [initialState.currentPassageId],
    selectedChoiceIds: [],
    steps: [],
    finalState: initialState,
    result: runtimeResult("trace-limit-reached", initialState.currentPassageId),
    runtimeFindings: [],
    hardFailureCodes: ["runtime.trace-limit-reached"],
  });
}

function conditionKeys(condition: RuntimeCondition | null): string[] {
  if (!condition) return [];
  if (condition.kind === "compare") return [condition.mechanicKey];
  if (condition.kind === "visit-count") return [];
  if (condition.kind === "not") return conditionKeys(condition.item);
  return [...new Set(condition.items.flatMap(conditionKeys))].sort();
}

function choiceReadKeys(runtime: CompiledRuntime, choiceId: string): string[] {
  const choice = runtime.choices[choiceId];
  return choice ? [...new Set([
    ...conditionKeys(choice.condition),
    ...choice.routeGateConditions.flatMap(conditionKeys),
  ])].sort() : [];
}

function endingReadKeys(runtime: CompiledRuntime, endingId: string | null): string[] {
  const ending = endingId ? runtime.endings[endingId] : undefined;
  return ending ? [...new Set(ending.gateConditions.flatMap(conditionKeys))].sort() : [];
}

function selectCoverageAwareChoice(
  runtime: CompiledRuntime,
  enabledChoiceIds: string[],
  prng: DeterministicPlaytestPrng,
  coverage: SelectionCoverage,
): string {
  const ranked = enabledChoiceIds.map((choiceId) => {
    const choice = runtime.choices[choiceId]!;
    const destination = runtime.passages[choice.destinationPassageId];
    const routeCoverage = destination?.routeIds.reduce((sum, routeId) => sum + (coverage.routeSamples.get(routeId) ?? 0), 0) ?? 0;
    return {
      choiceId,
      rank: [
        coverage.choiceSelections.get(choiceId) ?? 0,
        routeCoverage,
        coverage.passageVisits.get(choice.destinationPassageId) ?? 0,
      ] as const,
    };
  }).sort((left, right) => left.choiceId.localeCompare(right.choiceId));
  const best = ranked.reduce((value, item) => compareRank(item.rank, value.rank) < 0 ? item : value, ranked[0]!);
  const tied = ranked.filter((item) => compareRank(item.rank, best.rank) === 0);
  return tied[prng.nextIndex(tied.length)]!.choiceId;
}

function compareRank(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return 0;
}

function executeSample(
  runtime: CompiledRuntime,
  inputFingerprint: string,
  sampleSeed: string,
  sampleIndex: number,
  policy: PlaytestPolicy,
  coverage: SelectionCoverage,
  exactChoiceIds?: string[],
): ExecutedSample {
  let state = initializeRuntimeState(runtime);
  const initialState = state;
  const steps: CompactPlaytestStep[] = [];
  const runtimeSteps: RuntimeTraceStep[] = [];
  const observations: ChoiceObservation[] = [];
  const visitedPassageIds = [state.currentPassageId];
  const selectedChoiceIds: string[] = [];
  const runtimeFindings: RuntimeFinding[] = [];
  const hardFailureCodes: string[] = [];
  const prng = new DeterministicPlaytestPrng(sampleSeed);
  let result: RuntimeResult | null = null;
  let exactIndex = 0;
  let conservativeBytes = serializedBytes({
    inputFingerprint, runtimeFingerprint: runtime.fingerprint, sampleSeed, sampleIndex,
    policy: samplePolicy(policy), initialState,
  }) + 1_024;

  while (!result) {
    const terminal = resolveRuntimeTerminal(runtime, state).result;
    if (terminal) {
      result = terminal;
      if (terminal.kind === "ending-ineligible") hardFailureCodes.push("runtime.ending-ineligible");
      if (exactChoiceIds && exactIndex < exactChoiceIds.length) {
        const transition = applyRuntimeChoice(runtime, inputFingerprint, state, exactChoiceIds[exactIndex]!, steps.length);
        if (!transition.ok) runtimeFindings.push(transition.finding);
        hardFailureCodes.push("runtime.path-after-terminal");
        result = runtimeResult("blocked", state.currentPassageId, terminal.endingId);
      }
      break;
    }
    if (steps.length >= policy.maxStepsPerSample) {
      hardFailureCodes.push("runtime.step-limit-reached");
      result = runtimeResult("step-limit-reached", state.currentPassageId);
      break;
    }
    let enabledChoiceIds: string[];
    try {
      enabledChoiceIds = listRuntimeChoices(runtime, state).filter((item) => item.enabled).map((item) => item.choiceId);
    } catch {
      hardFailureCodes.push("runtime.condition-invalid");
      result = runtimeResult("blocked", state.currentPassageId);
      break;
    }
    observations.push({
      stepIndex: steps.length,
      passageId: state.currentPassageId,
      enabledChoiceIds: [...enabledChoiceIds].sort(),
      authoredChoiceCount: runtime.passages[state.currentPassageId]?.choiceIds.length ?? 0,
    });
    if (!enabledChoiceIds.length) {
      hardFailureCodes.push("playtest.no-enabled-choice");
      result = runtimeResult("blocked", state.currentPassageId);
      break;
    }
    let choiceId: string;
    if (exactChoiceIds) {
      if (exactIndex >= exactChoiceIds.length) {
        result = runtimeResult("path-exhausted", state.currentPassageId);
        break;
      }
      choiceId = exactChoiceIds[exactIndex++]!;
    } else {
      choiceId = selectCoverageAwareChoice(runtime, enabledChoiceIds, prng, coverage);
    }
    const transition = applyRuntimeChoice(runtime, inputFingerprint, state, choiceId, steps.length);
    if (!transition.ok) {
      runtimeFindings.push(transition.finding);
      hardFailureCodes.push(transition.finding.code);
      result = transition.result;
      break;
    }
    const compactStep: CompactPlaytestStep = {
      stepIndex: steps.length,
      passageId: state.currentPassageId,
      selectedChoiceId: choiceId,
      nextPassageId: transition.state.currentPassageId,
      enabledChoiceIds: [...enabledChoiceIds].sort(),
      stateDelta: transition.step.stateDelta,
    };
    const projectedBytes = conservativeBytes + serializedBytes(compactStep)
      + serializedBytes(choiceId) + serializedBytes(transition.state.currentPassageId) + 256;
    if (projectedBytes > policy.maxTraceBytesPerSample) {
      hardFailureCodes.push("runtime.trace-limit-reached");
      result = runtimeResult("trace-limit-reached", state.currentPassageId);
      break;
    }
    conservativeBytes = projectedBytes;
    steps.push(compactStep);
    runtimeSteps.push(transition.step);
    selectedChoiceIds.push(choiceId);
    state = transition.state;
    visitedPassageIds.push(state.currentPassageId);
    if ((state.visitCounts[state.currentPassageId] ?? 0) > policy.maxVisitsPerPassage) {
      hardFailureCodes.push("runtime.cycle-guard-reached");
      result = runtimeResult("cycle-guard-reached", state.currentPassageId);
    }
  }

  const trace = finalizeTrace({
    schemaVersion: 1,
    simulationInputFingerprint: inputFingerprint,
    compiledRuntimeFingerprint: runtime.fingerprint,
    sampleSeed,
    sampleIndex,
    policy: samplePolicy(policy),
    visitedPassageIds,
    selectedChoiceIds,
    steps,
    finalState: state,
    result: result ?? runtimeResult("path-exhausted", state.currentPassageId),
    runtimeFindings,
    hardFailureCodes: [...new Set(hardFailureCodes)].sort(),
  });
  if (serializedBytes(trace) <= policy.maxTraceBytesPerSample) return { trace, runtimeSteps, observations };
  const fallback = traceFallback(runtime, inputFingerprint, sampleSeed, sampleIndex, policy, initialState);
  if (serializedBytes(fallback) > policy.maxTraceBytesPerSample) {
    throw new PlaytestPolicyError("playtest_trace_header_too_large", "The immutable runtime state cannot fit inside the requested sample trace bound");
  }
  return { trace: fallback, runtimeSteps: [], observations: [] };
}

interface MechanicAccumulator {
  definition: RuntimeMechanicDefinition;
  writes: number;
  minimum: number | null;
  maximum: number | null;
  changedSamples: Set<number>;
  choices: Set<string>;
  consequenceSamples: Set<number>;
  finalDistribution: Map<string, number>;
  routeDistributions: Map<string, Map<string, number>>;
  endingDistributions: Map<string, Map<string, number>>;
}

interface ThreadAccumulator {
  setupSamples: Set<number>;
  payoffSamples: Set<number>;
  payoffWithoutSetupSamples: Set<number>;
  setupWithoutPayoffSamples: Set<number>;
  routeSamples: Map<string, Set<number>>;
}

interface CampaignAccumulator {
  passageVisits: Map<string, number>;
  passageSamples: Map<string, Set<number>>;
  choiceSelections: Map<string, number>;
  choiceSelectedSamples: Map<string, Set<number>>;
  choiceEnabled: Map<string, number>;
  choiceEnabledSamples: Map<string, Set<number>>;
  routeSamples: Map<string, Set<number>>;
  routeAssociatedSamples: Map<string, Set<number>>;
  routeDecisions: Map<string, Set<string>>;
  endingCompleted: Map<string, number>;
  endingIneligible: Map<string, number>;
  mechanics: Map<string, MechanicAccumulator>;
  threads: Map<string, ThreadAccumulator>;
  finalFactSamples: Map<string, Set<number>>;
  routeFactSamples: Map<string, Map<string, Set<number>>>;
  actWords: Map<string, number>;
  sequenceWords: Map<string, number>;
  longLinearStretches: number;
  denseChoiceRegions: number;
  enabledPerPassage: Map<string, number>;
  authoredPerPassage: Map<string, number>;
  findings: PlaytestFinding[];
}

function createAccumulator(runtime: CompiledRuntime, source: PlaytestAnalysisSource): CampaignAccumulator {
  return {
    passageVisits: new Map(Object.keys(runtime.passages).map((id) => [id, 0])),
    passageSamples: new Map(Object.keys(runtime.passages).map((id) => [id, new Set<number>()])),
    choiceSelections: new Map(Object.keys(runtime.choices).map((id) => [id, 0])),
    choiceSelectedSamples: new Map(Object.keys(runtime.choices).map((id) => [id, new Set<number>()])),
    choiceEnabled: new Map(Object.keys(runtime.choices).map((id) => [id, 0])),
    choiceEnabledSamples: new Map(Object.keys(runtime.choices).map((id) => [id, new Set<number>()])),
    routeSamples: new Map(runtime.routeIds.map((id) => [id, new Set<number>()])),
    routeAssociatedSamples: new Map(runtime.routeIds.map((id) => [id, new Set<number>()])),
    routeDecisions: new Map(runtime.routeIds.map((id) => [id, new Set<string>()])),
    endingCompleted: new Map(Object.keys(runtime.endings).map((id) => [id, 0])),
    endingIneligible: new Map(Object.keys(runtime.endings).map((id) => [id, 0])),
    mechanics: new Map(Object.entries(runtime.mechanics).map(([key, definition]) => [key, {
      definition,
      writes: 0,
      minimum: typeof definition.initial === "number" ? definition.initial : null,
      maximum: typeof definition.initial === "number" ? definition.initial : null,
      changedSamples: new Set<number>(),
      choices: new Set<string>(),
      consequenceSamples: new Set<number>(),
      finalDistribution: new Map<string, number>(),
      routeDistributions: new Map<string, Map<string, number>>(),
      endingDistributions: new Map<string, Map<string, number>>(),
    }])),
    threads: new Map(Object.keys(source.threads).map((id) => [id, {
      setupSamples: new Set<number>(), payoffSamples: new Set<number>(),
      payoffWithoutSetupSamples: new Set<number>(), setupWithoutPayoffSamples: new Set<number>(),
      routeSamples: new Map<string, Set<number>>(),
    }])),
    finalFactSamples: new Map(),
    routeFactSamples: new Map(),
    actWords: new Map(), sequenceWords: new Map(),
    longLinearStretches: 0, denseChoiceRegions: 0,
    enabledPerPassage: new Map(), authoredPerPassage: new Map(), findings: [],
  };
}

interface FindingContext {
  campaignId: string;
  projectId: string;
  inputVersionId: string;
  inputFingerprint: string;
  seed: string;
}

function addFinding(
  accumulator: CampaignAccumulator,
  context: FindingContext,
  input: {
    category: PlaytestFindingCategory;
    code: string;
    evidenceLevel: PlaytestEvidenceLevel;
    message: string;
    sample?: PlaytestSampleSummary;
    passageIds?: string[];
    choiceIds?: string[];
    mechanicKeys?: string[];
    routeIds?: string[];
    endingIds?: string[];
    evidence?: Record<string, unknown>;
  },
): void {
  const core = {
    schemaVersion: 1 as const,
    campaignId: context.campaignId,
    projectId: context.projectId,
    simulationInputArtifactVersionId: context.inputVersionId,
    simulationInputFingerprint: context.inputFingerprint,
    policyVersion: PLAYTEST_POLICY_VERSION,
    campaignSeed: context.seed,
    sampleId: input.sample?.id ?? null,
    sampleIndex: input.sample?.index ?? null,
    traceFingerprint: input.sample?.traceFingerprint ?? null,
    category: input.category,
    code: input.code,
    evidenceLevel: input.evidenceLevel,
    message: input.message,
    passageIds: [...new Set(input.passageIds ?? [])].sort(),
    choiceIds: [...new Set(input.choiceIds ?? [])].sort(),
    mechanicKeys: [...new Set(input.mechanicKeys ?? [])].sort(),
    routeIds: [...new Set(input.routeIds ?? [])].sort(),
    endingIds: [...new Set(input.endingIds ?? [])].sort(),
    evidence: input.evidence ?? {},
  };
  const fingerprint = stableFingerprint(core);
  accumulator.findings.push({ ...core, fingerprint, id: `ptf_${fingerprint}` });
}

function finalMechanicValues(runtime: CompiledRuntime, state: RuntimeState): Record<string, RuntimeScalar> {
  const result: Record<string, RuntimeScalar> = {};
  for (const [key, definition] of Object.entries(runtime.mechanics)) {
    result[key] = definition.category === "stat" ? state.stats[key]!
      : definition.category === "relationship" ? state.relationships[key]!
        : definition.category === "flag" ? state.flags[key]!
          : state.resources[key]!;
  }
  return result;
}

function summarizeWords(source: PlaytestAnalysisSource, visitedPassageIds: string[]): PlaytestWordSummary {
  let total = 0;
  let acceptedWords = 0;
  let plannedWords = 0;
  let historicalStaleAcceptedWords = 0;
  for (const passageId of visitedPassageIds) {
    const passage = source.passages[passageId];
    if (!passage) continue;
    total += passage.wordCount;
    if (passage.wordBasis === "accepted-prose") acceptedWords += passage.wordCount;
    else if (passage.wordBasis === "historical-stale-accepted") historicalStaleAcceptedWords += passage.wordCount;
    else plannedWords += passage.wordCount;
  }
  const basis = historicalStaleAcceptedWords > 0 ? "historical-stale-accepted"
    : acceptedWords > 0 && plannedWords > 0 ? "mixed-accepted-and-planned"
      : acceptedWords > 0 ? "accepted-prose" : "planned-target";
  return { total, basis, acceptedWords, plannedWords, historicalStaleAcceptedWords };
}

function sampleSummary(
  runtime: CompiledRuntime,
  source: PlaytestAnalysisSource,
  executed: ExecutedSample,
): PlaytestSampleSummary {
  const trace = executed.trace;
  const identity = {
    index: trace.sampleIndex,
    seed: trace.sampleSeed,
    choiceIds: trace.selectedChoiceIds,
    visitedPassageIds: trace.visitedPassageIds,
    observedEnabledChoiceIds: [...new Set(executed.observations.flatMap((item) => item.enabledChoiceIds))].sort(),
    result: trace.result,
    hardFailure: trace.hardFailureCodes.length > 0,
    hardFailureCodes: trace.hardFailureCodes,
    stepCount: trace.steps.length,
    traceFingerprint: trace.fingerprint,
    finalStateFingerprint: stableFingerprint(trace.finalState),
    finalMechanicValues: finalMechanicValues(runtime, trace.finalState),
    routeIds: [...trace.finalState.routes].sort(),
    decisionIds: [...trace.finalState.decisions].sort(),
    endingId: trace.result.endingId,
    words: summarizeWords(source, trace.visitedPassageIds),
  };
  const fingerprint = stableFingerprint(identity);
  return { ...identity, id: `pts_${fingerprint}`, fingerprint };
}

function increment(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function incrementDistribution(map: Map<string, number>, value: RuntimeScalar): void {
  increment(map, JSON.stringify(value));
}

function routeDistribution(accumulator: MechanicAccumulator, routeId: string): Map<string, number> {
  const found = accumulator.routeDistributions.get(routeId) ?? new Map<string, number>();
  accumulator.routeDistributions.set(routeId, found);
  return found;
}

function endingDistribution(accumulator: MechanicAccumulator, endingId: string): Map<string, number> {
  const found = accumulator.endingDistributions.get(endingId) ?? new Map<string, number>();
  accumulator.endingDistributions.set(endingId, found);
  return found;
}

function analyzeContinuity(
  accumulator: CampaignAccumulator,
  source: PlaytestAnalysisSource,
  executed: ExecutedSample,
  sample: PlaytestSampleSummary,
  context: FindingContext,
): void {
  const seenFacts = new Set<string>();
  const seenSetups = new Set<string>();
  const seenPayoffs = new Set<string>();
  const visited = executed.trace.visitedPassageIds;
  for (let visitIndex = 0; visitIndex < visited.length; visitIndex += 1) {
    const passageId = visited[visitIndex]!;
    const passage = source.passages[passageId];
    if (!passage) continue;
    const missingFacts = passage.requiredFactIds.filter((factId) => !seenFacts.has(factId));
    if (missingFacts.length) addFinding(accumulator, context, {
      category: "continuity", code: "playtest.fact-required-before-known", evidenceLevel: "warning",
      message: `Passage ${passageId} required structured facts before they were known in sample ${sample.index}.`,
      sample, passageIds: [passageId], routeIds: sample.routeIds,
      evidence: { visitIndex, traceStepIndex: Math.max(0, visitIndex - 1), missingFactIds: missingFacts },
    });
    for (const threadId of passage.setupThreadIds) {
      seenSetups.add(threadId);
      accumulator.threads.get(threadId)?.setupSamples.add(sample.index);
    }
    for (const threadId of passage.payoffThreadIds) {
      seenPayoffs.add(threadId);
      const thread = accumulator.threads.get(threadId);
      thread?.payoffSamples.add(sample.index);
      if (!seenSetups.has(threadId)) {
        thread?.payoffWithoutSetupSamples.add(sample.index);
        addFinding(accumulator, context, {
          category: "thread", code: "playtest.thread-payoff-before-setup", evidenceLevel: "warning",
          message: `Thread ${threadId} paid off before its setup was observed in sample ${sample.index}.`,
          sample, passageIds: [passageId], routeIds: sample.routeIds,
          evidence: { visitIndex, traceStepIndex: Math.max(0, visitIndex - 1), threadId },
        });
      }
    }
    for (const factId of passage.revealedFactIds) seenFacts.add(factId);
  }
  if (sample.result.kind === "completed-ending") {
    for (const threadId of [...seenSetups].sort()) if (!seenPayoffs.has(threadId)) {
      accumulator.threads.get(threadId)?.setupWithoutPayoffSamples.add(sample.index);
      addFinding(accumulator, context, {
        category: "thread", code: "playtest.thread-setup-without-payoff-in-completed-sample", evidenceLevel: "observation",
        message: `Thread ${threadId} was set up but not paid off in completed sample ${sample.index}.`,
        sample, routeIds: sample.routeIds,
        evidence: { traceStepIndex: Math.max(0, sample.stepCount - 1), threadId },
      });
    }
  }
  for (const factId of executed.trace.finalState.knownFacts) {
    const set = accumulator.finalFactSamples.get(factId) ?? new Set<number>();
    set.add(sample.index); accumulator.finalFactSamples.set(factId, set);
    for (const routeId of sample.routeIds) {
      const byFact = accumulator.routeFactSamples.get(routeId) ?? new Map<string, Set<number>>();
      const factSamples = byFact.get(factId) ?? new Set<number>();
      factSamples.add(sample.index); byFact.set(factId, factSamples); accumulator.routeFactSamples.set(routeId, byFact);
    }
  }
  for (const [threadId, thread] of accumulator.threads) if (seenSetups.has(threadId) || seenPayoffs.has(threadId)) {
    for (const routeId of sample.routeIds) {
      const samples = thread.routeSamples.get(routeId) ?? new Set<number>();
      samples.add(sample.index); thread.routeSamples.set(routeId, samples);
    }
  }
}

function analyzePacing(
  accumulator: CampaignAccumulator,
  source: PlaytestAnalysisSource,
  executed: ExecutedSample,
  sample: PlaytestSampleSummary,
  context: FindingContext,
  policy: PlaytestPolicy,
): void {
  for (const passageId of sample.visitedPassageIds) {
    const passage = source.passages[passageId];
    if (!passage) continue;
    if (passage.actId) increment(accumulator.actWords, passage.actId, passage.wordCount);
    increment(accumulator.sequenceWords, passage.sequenceId, passage.wordCount);
  }
  let linearStart = -1;
  const closeLinear = (endExclusive: number) => {
    if (linearStart < 0 || endExclusive - linearStart < policy.linearStretchThreshold) return;
    accumulator.longLinearStretches += 1;
    const observations = executed.observations.slice(linearStart, endExclusive);
    addFinding(accumulator, context, {
      category: "pacing", code: "playtest.long-linear-stretch-observed", evidenceLevel: "observation",
      message: `A ${observations.length}-passage linear stretch was observed in sample ${sample.index}.`,
      sample, passageIds: observations.map((item) => item.passageId), routeIds: sample.routeIds,
      evidence: { startStep: observations[0]?.stepIndex, length: observations.length, threshold: policy.linearStretchThreshold },
    });
  };
  for (let index = 0; index < executed.observations.length; index += 1) {
    const observation = executed.observations[index]!;
    increment(accumulator.enabledPerPassage, observation.passageId, observation.enabledChoiceIds.length);
    increment(accumulator.authoredPerPassage, observation.passageId, observation.authoredChoiceCount);
    if (observation.enabledChoiceIds.length === 1) {
      if (linearStart < 0) linearStart = index;
    } else {
      closeLinear(index); linearStart = -1;
    }
    if (observation.enabledChoiceIds.length >= policy.denseChoiceThreshold) {
      accumulator.denseChoiceRegions += 1;
      addFinding(accumulator, context, {
        category: "pacing", code: "playtest.dense-choice-region-observed", evidenceLevel: "observation",
        message: `${observation.enabledChoiceIds.length} enabled choices were observed at passage ${observation.passageId}.`,
        sample, passageIds: [observation.passageId], choiceIds: observation.enabledChoiceIds,
        routeIds: sample.routeIds,
        evidence: { stepIndex: observation.stepIndex, threshold: policy.denseChoiceThreshold },
      });
    }
  }
  closeLinear(executed.observations.length);
}

function analyzeMechanics(
  accumulator: CampaignAccumulator,
  runtime: CompiledRuntime,
  executed: ExecutedSample,
  sample: PlaytestSampleSummary,
): void {
  for (const step of executed.runtimeSteps) {
    for (const delta of step.stateDelta) {
      const match = /^(?:stat|stats|relationship|relationships|flag|flags|resource|resources)\.(.+)$/.exec(delta.path);
      if (!match) continue;
      const key = match[1]!;
      const item = accumulator.mechanics.get(key);
      if (!item || delta.before === delta.after) continue;
      item.writes += 1;
      item.changedSamples.add(sample.index);
      item.choices.add(step.selectedChoiceId);
      if (typeof delta.before === "number") item.minimum = item.minimum === null ? delta.before : Math.min(item.minimum, delta.before);
      if (typeof delta.after === "number") {
        item.minimum = item.minimum === null ? delta.after : Math.min(item.minimum, delta.after);
        item.maximum = item.maximum === null ? delta.after : Math.max(item.maximum, delta.after);
      }
      const later = executed.runtimeSteps.slice(step.stepIndex + 1).some((candidate) => (
        choiceReadKeys(runtime, candidate.selectedChoiceId).includes(key)
        || executed.observations[candidate.stepIndex]?.enabledChoiceIds.some((id) => choiceReadKeys(runtime, id).includes(key))
      ));
      if (later || endingReadKeys(runtime, sample.endingId).includes(key)) item.consequenceSamples.add(sample.index);
    }
  }
  for (const [key, item] of accumulator.mechanics) {
    const value = sample.finalMechanicValues[key]!;
    incrementDistribution(item.finalDistribution, value);
    for (const routeId of sample.routeIds) incrementDistribution(routeDistribution(item, routeId), value);
    if (sample.endingId) incrementDistribution(endingDistribution(item, sample.endingId), value);
  }
}

function accumulateSample(
  accumulator: CampaignAccumulator,
  runtime: CompiledRuntime,
  source: PlaytestAnalysisSource,
  executed: ExecutedSample,
  sample: PlaytestSampleSummary,
  context: FindingContext,
  policy: PlaytestPolicy,
): void {
  for (const passageId of sample.visitedPassageIds) {
    increment(accumulator.passageVisits, passageId);
    accumulator.passageSamples.get(passageId)?.add(sample.index);
    for (const routeId of source.passages[passageId]?.routeIds ?? []) {
      accumulator.routeAssociatedSamples.get(routeId)?.add(sample.index);
    }
  }
  for (const choiceId of sample.choiceIds) {
    increment(accumulator.choiceSelections, choiceId);
    accumulator.choiceSelectedSamples.get(choiceId)?.add(sample.index);
  }
  for (const observation of executed.observations) for (const choiceId of observation.enabledChoiceIds) {
    increment(accumulator.choiceEnabled, choiceId);
    accumulator.choiceEnabledSamples.get(choiceId)?.add(sample.index);
  }
  for (const routeId of sample.routeIds) {
    accumulator.routeSamples.get(routeId)?.add(sample.index);
    for (const decisionId of sample.decisionIds) accumulator.routeDecisions.get(routeId)?.add(decisionId);
  }
  if (sample.endingId && sample.result.kind === "completed-ending") increment(accumulator.endingCompleted, sample.endingId);
  if (sample.endingId && sample.result.kind === "ending-ineligible") increment(accumulator.endingIneligible, sample.endingId);
  if (sample.hardFailure) addFinding(accumulator, context, {
    category: "runtime-hard-failure", code: "playtest.runtime-hard-failure", evidenceLevel: "hard-error",
    message: `Sample ${sample.index} ended with hard runtime evidence: ${sample.hardFailureCodes.join(", ")}.`,
    sample, passageIds: [executed.trace.finalState.currentPassageId], endingIds: sample.endingId ? [sample.endingId] : [],
    routeIds: sample.routeIds,
    evidence: { traceStepIndex: Math.max(0, sample.stepCount - 1), result: sample.result, codes: sample.hardFailureCodes },
  });
  analyzeMechanics(accumulator, runtime, executed, sample);
  analyzeContinuity(accumulator, source, executed, sample, context);
  analyzePacing(accumulator, source, executed, sample, context, policy);
}

function mapDistribution(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function nestedDistributions(map: Map<string, Map<string, number>>): Record<string, Record<string, number>> {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, mapDistribution(value)]));
}

function mechanicReports(
  accumulator: CampaignAccumulator,
  runtime: CompiledRuntime,
  source: PlaytestAnalysisSource,
): MechanicTrajectoryReport[] {
  return [...accumulator.mechanics.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => ({
    mechanicKey: key,
    label: source.mechanicLabels[key] ?? key,
    category: item.definition.category,
    initialValue: item.definition.initial,
    observedWriteCount: item.writes,
    observedMinimum: item.minimum,
    observedMaximum: item.maximum,
    samplesChanged: item.changedSamples.size,
    choiceIdsCausingChanges: [...item.choices].sort(),
    downstreamReadChoiceIds: Object.keys(runtime.choices).filter((choiceId) => choiceReadKeys(runtime, choiceId).includes(key)).sort(),
    downstreamEndingIds: Object.keys(runtime.endings).filter((endingId) => endingReadKeys(runtime, endingId).includes(key)).sort(),
    samplesWithObservedDownstreamConsequence: item.consequenceSamples.size,
    finalDistribution: mapDistribution(item.finalDistribution),
    routeFinalDistributions: nestedDistributions(item.routeDistributions),
    endingFinalDistributions: nestedDistributions(item.endingDistributions),
  }));
}

function representativeIds(samples: PlaytestSampleSummary[]) {
  const completed = samples.filter((sample) => sample.result.kind === "completed-ending")
    .sort((left, right) => left.stepCount - right.stepCount || left.index - right.index);
  const byWords = [...completed].sort((left, right) => left.words.total - right.words.total || left.index - right.index);
  return {
    shortestCompletedSampleId: completed[0]?.id ?? null,
    medianCompletedSampleId: completed.length ? completed[Math.floor((completed.length - 1) / 2)]!.id : null,
    longestCompletedSampleId: completed.at(-1)?.id ?? null,
    minimumWordSampleId: byWords[0]?.id ?? null,
    maximumWordSampleId: byWords.at(-1)?.id ?? null,
  };
}

function continuityReport(accumulator: CampaignAccumulator, source: PlaytestAnalysisSource): ContinuityReport {
  const count = (code: string) => accumulator.findings.filter((finding) => finding.code === code).length;
  return {
    requiredBeforeKnownCount: count("playtest.fact-required-before-known"),
    payoffBeforeSetupCount: count("playtest.thread-payoff-before-setup"),
    setupWithoutPayoffCompletedCount: count("playtest.thread-setup-without-payoff-in-completed-sample"),
    finalKnownFactCounts: Object.fromEntries([...accumulator.finalFactSamples.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([id, samples]) => [id, samples.size])),
    routeKnownFactCounts: Object.fromEntries([...accumulator.routeFactSamples.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([routeId, facts]) => [routeId, Object.fromEntries([...facts.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([factId, samples]) => [factId, samples.size]))])),
    threadObservations: Object.values(source.threads).sort((a, b) => a.id.localeCompare(b.id)).map((thread) => {
      const item = accumulator.threads.get(thread.id)!;
      return {
        threadId: thread.id,
        setupSampleCount: item.setupSamples.size,
        payoffSampleCount: item.payoffSamples.size,
        payoffWithoutSetupSampleCount: item.payoffWithoutSetupSamples.size,
        setupWithoutPayoffCompletedSampleCount: item.setupWithoutPayoffSamples.size,
        routeSampleCounts: Object.fromEntries([...item.routeSamples.entries()].sort(([a], [b]) => a.localeCompare(b))
          .map(([id, samples]) => [id, samples.size])),
      };
    }),
  };
}

function pacingReport(accumulator: CampaignAccumulator, samples: PlaytestSampleSummary[]): PacingReport {
  const completed = samples.filter((sample) => sample.result.kind === "completed-ending");
  const words = completed.map((sample) => sample.words.total).sort((a, b) => a - b);
  const basisCounts: PacingReport["basisCounts"] = {
    "accepted-prose": 0,
    "planned-target": 0,
    "mixed-accepted-and-planned": 0,
    "historical-stale-accepted": 0,
  };
  for (const sample of samples) basisCounts[sample.words.basis] += 1;
  return {
    minimumWords: words[0] ?? null,
    medianWords: words.length ? words[Math.floor((words.length - 1) / 2)]! : null,
    maximumWords: words.at(-1) ?? null,
    averageWords: words.length ? Math.round(words.reduce((sum, value) => sum + value, 0) / words.length) : null,
    basisCounts,
    actWordTotals: Object.fromEntries([...accumulator.actWords.entries()].sort(([a], [b]) => a.localeCompare(b))),
    sequenceWordTotals: Object.fromEntries([...accumulator.sequenceWords.entries()].sort(([a], [b]) => a.localeCompare(b))),
    longLinearStretchCount: accumulator.longLinearStretches,
    denseChoiceRegionCount: accumulator.denseChoiceRegions,
    enabledChoicesPerVisitedPassage: Object.fromEntries([...accumulator.enabledPerPassage.entries()].sort(([a], [b]) => a.localeCompare(b))),
    authoredChoicesPerVisitedPassage: Object.fromEntries([...accumulator.authoredPerPassage.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function routeExclusiveReport(
  source: PlaytestAnalysisSource,
  accumulator: CampaignAccumulator,
  routeIds: string[],
): RouteExclusiveReportItem[] {
  return [...routeIds].sort().map((routeId) => {
    const passages = Object.values(source.passages).filter((passage) => passage.routeIds.length === 1 && passage.routeIds[0] === routeId)
      .sort((left, right) => left.id.localeCompare(right.id));
    const observed = passages.filter((passage) => (accumulator.passageVisits.get(passage.id) ?? 0) > 0);
    return {
      routeId,
      authoredPassageIds: passages.map((passage) => passage.id),
      observedPassageIds: observed.map((passage) => passage.id),
      authoredWords: passages.reduce((sum, passage) => sum + passage.wordCount, 0),
      observedWords: observed.reduce((sum, passage) => sum + passage.wordCount, 0),
      acceptedWordVolume: passages.filter((passage) => passage.wordBasis === "accepted-prose")
        .reduce((sum, passage) => sum + passage.wordCount, 0),
      plannedWordVolume: passages.filter((passage) => passage.wordBasis === "planned-target")
        .reduce((sum, passage) => sum + passage.wordCount, 0),
    };
  });
}

function addCampaignFindings(
  accumulator: CampaignAccumulator,
  context: FindingContext,
  runtime: CompiledRuntime,
  source: PlaytestAnalysisSource,
  samples: PlaytestSampleSummary[],
): void {
  for (const passageId of Object.keys(runtime.passages).sort()) if ((accumulator.passageVisits.get(passageId) ?? 0) === 0) addFinding(accumulator, context, {
    category: "coverage", code: "playtest.passage-not-observed", evidenceLevel: "coverage-gap",
    message: `Passage ${passageId} was not observed in ${samples.length} deterministic samples; this does not prove it is unreachable.`,
    passageIds: [passageId], evidence: { sampleCount: samples.length },
  });
  for (const choiceId of Object.keys(runtime.choices).sort()) {
    if ((accumulator.choiceSelections.get(choiceId) ?? 0) === 0) addFinding(accumulator, context, {
      category: "coverage", code: "playtest.choice-not-selected", evidenceLevel: "coverage-gap",
      message: `Choice ${choiceId} was not selected in ${samples.length} deterministic samples.`,
      choiceIds: [choiceId], evidence: { sampleCount: samples.length, observedEnabledCount: accumulator.choiceEnabled.get(choiceId) ?? 0 },
    });
    if ((accumulator.choiceEnabled.get(choiceId) ?? 0) === 0) addFinding(accumulator, context, {
      category: "coverage", code: "playtest.choice-not-observed-enabled", evidenceLevel: "coverage-gap",
      message: `Choice ${choiceId} was never observed enabled in ${samples.length} deterministic samples; this does not prove it is impossible.`,
      choiceIds: [choiceId], evidence: { sampleCount: samples.length },
    });
  }
  for (const endingId of Object.keys(runtime.endings).sort()) {
    const observed = (accumulator.endingCompleted.get(endingId) ?? 0) + (accumulator.endingIneligible.get(endingId) ?? 0);
    if (!observed) addFinding(accumulator, context, {
      category: "coverage", code: "playtest.ending-not-observed", evidenceLevel: "coverage-gap",
      message: `Ending ${endingId} was not observed in ${samples.length} deterministic samples; this does not prove it is unreachable.`,
      endingIds: [endingId], evidence: { sampleCount: samples.length },
    });
  }
  for (const report of mechanicReports(accumulator, runtime, source)) {
    if (report.observedWriteCount > 0 && report.samplesWithObservedDownstreamConsequence === 0) addFinding(accumulator, context, {
      category: report.category === "relationship" ? "relationship" : "mechanic",
      code: "playtest.mechanic-changed-without-observed-consequence", evidenceLevel: "observation",
      message: `Mechanic ${report.mechanicKey} changed, but no later structured read or outcome consequence was observed in this bounded campaign.`,
      mechanicKeys: [report.mechanicKey], choiceIds: report.choiceIdsCausingChanges,
      evidence: { observedWriteCount: report.observedWriteCount, samplesChanged: report.samplesChanged },
    });
    if (report.category === "relationship" && report.observedWriteCount === 0) addFinding(accumulator, context, {
      category: "relationship", code: "playtest.relationship-trajectory-flat", evidenceLevel: "observation",
      message: `Relationship ${report.mechanicKey} remained flat in this bounded campaign.`,
      mechanicKeys: [report.mechanicKey], evidence: { sampleCount: samples.length, initialValue: report.initialValue },
    });
  }
  for (const item of routeExclusiveReport(source, accumulator, runtime.routeIds)) {
    const missing = item.authoredPassageIds.filter((id) => !item.observedPassageIds.includes(id));
    if (missing.length) addFinding(accumulator, context, {
      category: "route-exclusive", code: "playtest.route-exclusive-coverage-gap", evidenceLevel: "coverage-gap",
      message: `${missing.length} route-exclusive passages for ${item.routeId} were not observed in this bounded campaign.`,
      routeIds: [item.routeId], passageIds: missing,
      evidence: { authoredExclusiveCount: item.authoredPassageIds.length, observedExclusiveCount: item.observedPassageIds.length },
    });
  }
}

function buildReport(
  accumulator: CampaignAccumulator,
  runtime: CompiledRuntime,
  source: PlaytestAnalysisSource,
  samples: PlaytestSampleSummary[],
): PlaytestAggregateReport {
  const passageItems: PassageCoverageItem[] = Object.keys(runtime.passages).sort().map((passageId) => {
    const indexes = [...(accumulator.passageSamples.get(passageId) ?? [])].sort((a, b) => a - b);
    return {
      passageId,
      visitCount: accumulator.passageVisits.get(passageId) ?? 0,
      sampleCount: indexes.length,
      firstSampleIndex: indexes[0] ?? null,
      lastSampleIndex: indexes.at(-1) ?? null,
    };
  });
  const choiceItems: ChoiceCoverageItem[] = Object.keys(runtime.choices).sort().map((choiceId) => ({
    choiceId,
    selectionCount: accumulator.choiceSelections.get(choiceId) ?? 0,
    selectedSampleCount: accumulator.choiceSelectedSamples.get(choiceId)?.size ?? 0,
    observedEnabledCount: accumulator.choiceEnabled.get(choiceId) ?? 0,
    observedEnabledSampleCount: accumulator.choiceEnabledSamples.get(choiceId)?.size ?? 0,
  }));
  const routeItems: RouteCoverageItem[] = [...runtime.routeIds].sort().map((routeId) => ({
    routeId,
    label: source.routeLabels[routeId] ?? routeId,
    sampleCount: accumulator.routeSamples.get(routeId)?.size ?? 0,
    frequency: samples.length ? (accumulator.routeSamples.get(routeId)?.size ?? 0) / samples.length : 0,
    associatedPassageSampleCount: accumulator.routeAssociatedSamples.get(routeId)?.size ?? 0,
    decisionIds: [...(accumulator.routeDecisions.get(routeId) ?? [])].sort(),
  }));
  const endingItems: EndingCoverageItem[] = Object.keys(runtime.endings).sort().map((endingId) => {
    const completedCount = accumulator.endingCompleted.get(endingId) ?? 0;
    const ineligibleCount = accumulator.endingIneligible.get(endingId) ?? 0;
    return {
      endingId,
      label: source.endingLabels[endingId] ?? endingId,
      completedCount,
      ineligibleCount,
      observedCount: completedCount + ineligibleCount,
      frequency: samples.length ? (completedCount + ineligibleCount) / samples.length : 0,
    };
  });
  const mechanics = mechanicReports(accumulator, runtime, source);
  const core = {
    schemaVersion: 1 as const,
    sampleCount: samples.length,
    completedSampleCount: samples.filter((sample) => sample.result.kind === "completed-ending").length,
    hardFailureSampleCount: samples.filter((sample) => sample.hardFailure).length,
    totalSampledSteps: samples.reduce((sum, sample) => sum + sample.stepCount, 0),
    passageCoverage: {
      total: passageItems.length,
      visited: passageItems.filter((item) => item.visitCount > 0).length,
      unvisited: passageItems.filter((item) => item.visitCount === 0).length,
      percentage: passageItems.length ? (passageItems.filter((item) => item.visitCount > 0).length / passageItems.length) * 100 : 0,
      items: passageItems,
    },
    choiceCoverage: {
      total: choiceItems.length,
      selected: choiceItems.filter((item) => item.selectionCount > 0).length,
      neverSelected: choiceItems.filter((item) => item.selectionCount === 0).length,
      neverObservedEnabled: choiceItems.filter((item) => item.observedEnabledCount === 0).length,
      items: choiceItems,
    },
    routeCoverage: routeItems,
    endingCoverage: endingItems,
    mechanics,
    relationships: mechanics.filter((item) => item.category === "relationship"),
    continuity: continuityReport(accumulator, source),
    pacing: pacingReport(accumulator, samples),
    routeExclusiveContent: routeExclusiveReport(source, accumulator, runtime.routeIds),
    representatives: representativeIds(samples),
  };
  return { ...core, fingerprint: stableFingerprint(core) };
}

function deterministicFindingOrder(left: PlaytestFinding, right: PlaytestFinding): number {
  return left.evidenceLevel.localeCompare(right.evidenceLevel)
    || left.code.localeCompare(right.code)
    || (left.sampleIndex ?? Number.MAX_SAFE_INTEGER) - (right.sampleIndex ?? Number.MAX_SAFE_INTEGER)
    || left.id.localeCompare(right.id);
}

function boundedFindings(findings: PlaytestFinding[], policy: PlaytestPolicy): PlaytestFinding[] {
  const result: PlaytestFinding[] = [];
  let bytes = 2;
  for (const finding of [...findings].sort(deterministicFindingOrder)) {
    const nextBytes = bytes + serializedBytes(finding) + 1;
    if (result.length >= policy.maxFindings || nextBytes > policy.maxFindingBytes) break;
    result.push(finding); bytes = nextBytes;
  }
  return result;
}

function retainedTraceIds(report: PlaytestAggregateReport, samples: PlaytestSampleSummary[], policy: PlaytestPolicy): Set<string> {
  const ids = new Set<string>();
  for (const sample of samples.filter((item) => item.hardFailure).sort((a, b) => a.index - b.index)) {
    if (ids.size >= policy.maxRetainedFullTraces) break;
    ids.add(sample.id);
  }
  for (const id of Object.values(report.representatives)) {
    if (id && ids.size < policy.maxRetainedFullTraces) ids.add(id);
  }
  for (const sample of samples) {
    if (ids.size >= policy.maxRetainedFullTraces) break;
    ids.add(sample.id);
  }
  return ids;
}

export function runPlaytestCampaign(input: RunPlaytestCampaignInput): PlaytestCampaignRecord {
  if (input.identity.compiledRuntimeFingerprint !== input.runtime.fingerprint
    || input.identity.snapshotId !== input.runtime.sourceSnapshotId) {
    throw new PlaytestIntegrityError("Playtest campaign runtime lineage does not match its immutable simulation input");
  }
  const seedBytes = new TextEncoder().encode(input.identity.seed).byteLength;
  if (!input.identity.seed.length || seedBytes > PLAYTEST_BACKEND_LIMITS.maxSeedBytes) {
    throw new PlaytestPolicyError("playtest_seed_invalid", `Seed must contain 1-${PLAYTEST_BACKEND_LIMITS.maxSeedBytes} UTF-8 bytes`);
  }
  if (input.policy.sampleCount * input.policy.maxStepsPerSample > input.policy.maxTotalSampledSteps) {
    throw new PlaytestPolicyError("playtest_total_work_too_large", "Campaign exceeds its total sampled-step bound");
  }
  const campaignIdentity = { ...input.identity, policy: input.policy };
  const campaignFingerprint = stableFingerprint(campaignIdentity);
  const campaignId = `ptc_${campaignFingerprint}`;
  const context: FindingContext = {
    campaignId,
    projectId: input.identity.projectId,
    inputVersionId: input.identity.simulationInputArtifactVersionId,
    inputFingerprint: input.identity.simulationInputFingerprint,
    seed: input.identity.seed,
  };
  const accumulator = createAccumulator(input.runtime, input.source);
  const summaries: PlaytestSampleSummary[] = [];
  const traces = new Map<string, CompactPlaytestTrace>();
  let totalSteps = 0;
  let totalChoiceIds = 0;
  for (let index = 0; index < input.policy.sampleCount; index += 1) {
    const derivedSeed = stableFingerprint({
      algorithm: PLAYTEST_PRNG_VERSION,
      campaignSeed: input.identity.seed,
      simulationInputFingerprint: input.identity.simulationInputFingerprint,
      policyFingerprint: stableFingerprint(input.policy),
      sampleIndex: index,
    });
    const selectionCoverage: SelectionCoverage = {
      choiceSelections: accumulator.choiceSelections,
      passageVisits: accumulator.passageVisits,
      routeSamples: new Map([...accumulator.routeSamples].map(([id, samples]) => [id, samples.size])),
    };
    const executed = executeSample(
      input.runtime, input.identity.simulationInputFingerprint, derivedSeed, index, input.policy, selectionCoverage,
    );
    const summary = sampleSummary(input.runtime, input.source, executed);
    totalSteps += summary.stepCount;
    totalChoiceIds += summary.choiceIds.length;
    if (totalSteps > input.policy.maxTotalSampledSteps || totalChoiceIds > input.policy.maxChoiceIdsPerCampaign) {
      throw new PlaytestPolicyError("playtest_total_work_too_large", "Campaign exceeded its total persisted-work bound");
    }
    summaries.push(summary);
    traces.set(summary.id, executed.trace);
    accumulateSample(accumulator, input.runtime, input.source, executed, summary, context, input.policy);
  }
  addCampaignFindings(accumulator, context, input.runtime, input.source, summaries);
  const report = buildReport(accumulator, input.runtime, input.source, summaries);
  const findings = boundedFindings(accumulator.findings, input.policy);
  const retain = retainedTraceIds(report, summaries, input.policy);
  const retainedTraces = summaries.filter((sample) => retain.has(sample.id)).map((sample) => traces.get(sample.id)!);
  const contentWithoutFingerprint = {
    schemaVersion: 1 as const,
    id: campaignId,
    ...campaignIdentity,
    status: "completed" as const,
    requestedSampleCount: input.policy.sampleCount,
    actualSampleCount: summaries.length,
    samples: summaries,
    retainedTraces,
    report,
    findings,
  };
  const campaign: PlaytestCampaignRecord = {
    ...contentWithoutFingerprint,
    fingerprint: stableFingerprint(contentWithoutFingerprint),
  };
  const campaignBytes = serializedBytes(campaign);
  if (campaignBytes > input.policy.maxCampaignBytes) {
    throw new PlaytestPolicyError(
      "playtest_campaign_too_large",
      `Campaign evidence requires ${campaignBytes} bytes; maximum is ${input.policy.maxCampaignBytes}`,
    );
  }
  return campaign;
}

function assertSampleIdentity(sample: PlaytestSampleSummary): void {
  const { id: _id, fingerprint: _fingerprint, ...identity } = sample;
  const fingerprint = stableFingerprint(identity);
  if (fingerprint !== sample.fingerprint || sample.id !== `pts_${fingerprint}`) {
    throw new PlaytestIntegrityError("Stored playtest sample identity does not match its evidence");
  }
}

export function replayPlaytestSample(
  campaign: PlaytestCampaignRecord,
  sample: PlaytestSampleSummary,
  runtime: CompiledRuntime,
): ReplayPlaytestSampleResult {
  assertSampleIdentity(sample);
  if (runtime.fingerprint !== campaign.compiledRuntimeFingerprint) {
    throw new PlaytestIntegrityError("Stored playtest sample runtime lineage does not match the campaign");
  }
  const coverage: SelectionCoverage = { choiceSelections: new Map(), passageVisits: new Map(), routeSamples: new Map() };
  const executed = executeSample(
    runtime,
    campaign.simulationInputFingerprint,
    sample.seed,
    sample.index,
    campaign.policy,
    coverage,
    sample.choiceIds,
  );
  if (executed.trace.fingerprint !== sample.traceFingerprint) {
    throw new PlaytestIntegrityError("Replayed trace fingerprint differs from the stored sample evidence");
  }
  return { sample, trace: executed.trace, verified: true };
}

export function assertPlaytestCampaignIdentity(campaign: PlaytestCampaignRecord): void {
  const { fingerprint: _fingerprint, ...content } = campaign;
  if (stableFingerprint(content) !== campaign.fingerprint) {
    throw new PlaytestIntegrityError("Stored playtest campaign fingerprint is invalid");
  }
  const identity = {
    projectId: campaign.projectId,
    simulationInputArtifactVersionId: campaign.simulationInputArtifactVersionId,
    simulationInputFingerprint: campaign.simulationInputFingerprint,
    compiledRuntimeFingerprint: campaign.compiledRuntimeFingerprint,
    snapshotId: campaign.snapshotId,
    seed: campaign.seed,
    policy: campaign.policy,
  };
  if (campaign.id !== `ptc_${stableFingerprint(identity)}`) {
    throw new PlaytestIntegrityError("Stored playtest campaign identity is invalid");
  }
  for (const sample of campaign.samples) assertSampleIdentity(sample);
}
