import { z } from "zod";
import { canonical, serializedBytes, stableFingerprint } from "./canonical.js";
import { compiledRuntimeFingerprint } from "./compile.js";
import {
  applyRuntimeChoice,
  evaluateRuntimeChoice,
  initializeRuntimeState,
  listRuntimeChoices,
  resolveRuntimeTerminal,
  type RuntimeChoiceTransition,
} from "./engine.js";
import {
  cloneRuntimeState,
  conditionCompatible,
  effectCompatible,
} from "./semantics.js";
import type {
  CompiledRuntime,
  RuntimeChoiceAvailability,
  RuntimeCondition,
  RuntimeEffect,
  RuntimeState,
} from "./types.js";

export const NATIVE_GAME_BUNDLE_SCHEMA_ID = "cyoa.native-game-bundle" as const;
export const NATIVE_GAME_BUNDLE_SCHEMA_VERSION = 1 as const;
export const NATIVE_COMPILER_POLICY_ID = "foundation-7a-native-compiler" as const;
export const NATIVE_COMPILER_POLICY_VERSION = 1 as const;
export const NATIVE_COMPILER_VERSION = "foundation-7a-v1" as const;
export const NATIVE_RUNTIME_CONTRACT_VERSION = "foundation-5a-v1" as const;

export const NATIVE_BUNDLE_LIMITS = Object.freeze({
  maximumPassages: 10_000,
  maximumChoices: 30_000,
  maximumMechanics: 2_000,
  maximumRoutes: 500,
  maximumEndings: 2_000,
  maximumFacts: 20_000,
  maximumProseBytesPerPassage: 2_000_000,
  maximumTotalProseBytes: 50_000_000,
  maximumDebugBytes: 8_000_000,
  maximumSerializedBytes: 64_000_000,
});

const StableId = z.string().min(1).max(200);
const Fingerprint = z.string().regex(/^[0-9a-f]{32}$/);
const RuntimeScalarSchema = z.union([z.number().finite(), z.boolean(), z.string().max(500)]);
const RuntimeConditionSchema: z.ZodType<RuntimeCondition> = z.lazy(() => z.union([
  z.object({ kind: z.literal("all"), items: z.array(RuntimeConditionSchema).min(1).max(20) }).strict(),
  z.object({ kind: z.literal("any"), items: z.array(RuntimeConditionSchema).min(1).max(20) }).strict(),
  z.object({ kind: z.literal("not"), item: RuntimeConditionSchema }).strict(),
  z.object({
    kind: z.literal("compare"), mechanicKey: StableId,
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]), value: RuntimeScalarSchema,
  }).strict(),
  z.object({
    kind: z.literal("visit-count"), passageId: StableId,
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]), value: z.number().int().min(0),
  }).strict(),
]));
const RuntimeEffectSchema: z.ZodType<RuntimeEffect> = z.object({
  id: StableId,
  mechanicKey: StableId,
  operation: z.enum(["set", "add", "subtract", "clear"]),
  value: RuntimeScalarSchema.nullable(),
  feedback: z.string().max(1_000),
  visibility: z.enum(["visible", "hidden"]),
}).strict();

const NumberMechanicBase = {
  key: StableId,
  valueType: z.literal("number"),
  initial: z.number().finite(),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
};
const MechanicSchema = z.discriminatedUnion("category", [
  z.object({ ...NumberMechanicBase, category: z.literal("stat") }).strict(),
  z.object({
    ...NumberMechanicBase,
    category: z.literal("relationship"),
    bands: z.array(z.object({ minimum: z.number().finite(), label: z.string().min(1).max(200) }).strict()).max(50),
  }).strict(),
  z.object({
    key: StableId, category: z.literal("flag"), valueType: z.literal("boolean"), initial: z.boolean(),
  }).strict(),
  z.object({ ...NumberMechanicBase, category: z.literal("resource") }).strict(),
]);

const PassageSchema = z.object({
  id: StableId,
  proseMarkdown: z.string(),
  choiceIds: z.array(StableId).max(100),
  terminal: z.boolean(),
  endingId: StableId.nullable(),
  routeIds: z.array(StableId).max(30),
  requiredFactIds: z.array(StableId).max(100),
  revealedFactIds: z.array(StableId).max(100),
  presentation: z.object({ title: z.string().min(1).max(300) }).strict(),
  source: z.object({ passageVersionId: StableId, acceptedDraftVersionId: StableId }).strict(),
}).strict();

const ChoiceSchema = z.object({
  id: StableId,
  sourcePassageId: StableId,
  destinationPassageId: StableId,
  text: z.string().min(1).max(500),
  condition: RuntimeConditionSchema.nullable(),
  routeGateConditions: z.array(RuntimeConditionSchema).max(100),
  unavailableBehavior: z.enum(["hidden", "disabled"]),
  unavailableExplanation: z.string().max(20_000),
  effects: z.array(RuntimeEffectSchema).max(50),
  sourceDecisionIds: z.array(StableId).max(100),
  position: z.number().int().min(0),
  source: z.object({ choiceVersionId: StableId }).strict(),
}).strict();

const EndingSchema = z.object({
  id: StableId,
  routeId: StableId,
  gateConditions: z.array(RuntimeConditionSchema).max(100),
}).strict();

const RuntimeStateSchema = z.object({
  currentPassageId: StableId,
  stats: z.record(z.number().finite()),
  relationships: z.record(z.number().finite()),
  flags: z.record(z.boolean()),
  resources: z.record(z.union([z.number().finite(), z.string().max(500)])),
  decisions: z.array(StableId),
  routes: z.array(StableId),
  knownFacts: z.array(StableId),
  visitCounts: z.record(z.number().int().min(0)),
  turn: z.number().int().min(0),
}).strict();

export const NativeGameBundleSchema = z.object({
  schemaId: z.literal(NATIVE_GAME_BUNDLE_SCHEMA_ID),
  schemaVersion: z.literal(NATIVE_GAME_BUNDLE_SCHEMA_VERSION),
  gameId: StableId,
  projectId: StableId,
  source: z.object({
    inputFingerprint: Fingerprint,
    snapshotId: StableId,
    structureVersionId: StableId,
  }).strict(),
  bundleFingerprint: Fingerprint,
  runtimeFingerprint: Fingerprint,
  compiler: z.object({
    policyId: z.literal(NATIVE_COMPILER_POLICY_ID),
    policyVersion: z.literal(NATIVE_COMPILER_POLICY_VERSION),
    version: z.literal(NATIVE_COMPILER_VERSION),
  }).strict(),
  runtimeContract: z.object({
    schemaVersion: z.literal(1),
    version: z.literal(NATIVE_RUNTIME_CONTRACT_VERSION),
  }).strict(),
  startPassageId: StableId,
  initialState: RuntimeStateSchema,
  mechanics: z.array(MechanicSchema).max(NATIVE_BUNDLE_LIMITS.maximumMechanics),
  passages: z.array(PassageSchema).max(NATIVE_BUNDLE_LIMITS.maximumPassages),
  choices: z.array(ChoiceSchema).max(NATIVE_BUNDLE_LIMITS.maximumChoices),
  endings: z.array(EndingSchema).max(NATIVE_BUNDLE_LIMITS.maximumEndings),
  routeIds: z.array(StableId).max(NATIVE_BUNDLE_LIMITS.maximumRoutes),
  decisionIds: z.array(StableId).max(20_000),
  factIds: z.array(StableId).max(NATIVE_BUNDLE_LIMITS.maximumFacts),
  debug: z.object({
    upstreamVersions: z.record(StableId),
    threadVersionIds: z.array(StableId).max(5_000),
  }).strict().optional(),
}).strict();

export type NativeGameBundle = z.infer<typeof NativeGameBundleSchema>;
export type NativeGamePassage = NativeGameBundle["passages"][number];
export type NativeGameChoice = NativeGameBundle["choices"][number];

export interface NativeBundleFinding {
  code: string;
  message: string;
  path?: string;
  passageId?: string;
  choiceId?: string;
  mechanicKey?: string;
  endingId?: string;
}

export class NativeBundleValidationError extends Error {
  public constructor(public readonly findings: NativeBundleFinding[]) {
    super(findings[0]?.message ?? "Native game bundle validation failed");
  }
}

export interface LoadedNativeGame {
  bundle: NativeGameBundle;
  runtime: CompiledRuntime;
  passages: ReadonlyMap<string, NativeGamePassage>;
  choices: ReadonlyMap<string, NativeGameChoice>;
}

export interface NativeChoiceView {
  choice: NativeGameChoice;
  availability: RuntimeChoiceAvailability;
}

function gameplayPayload(bundle: NativeGameBundle): unknown {
  return {
    schemaId: bundle.schemaId,
    schemaVersion: bundle.schemaVersion,
    compiler: bundle.compiler,
    runtimeContract: bundle.runtimeContract,
    startPassageId: bundle.startPassageId,
    initialState: bundle.initialState,
    mechanics: bundle.mechanics,
    passages: bundle.passages.map(({ source: _source, ...passage }) => passage),
    choices: bundle.choices.map(({ source: _source, ...choice }) => choice),
    endings: bundle.endings,
    routeIds: bundle.routeIds,
    decisionIds: bundle.decisionIds,
    factIds: bundle.factIds,
  };
}

export function nativeBundleFingerprint(bundle: NativeGameBundle): string {
  return stableFingerprint(gameplayPayload(bundle));
}

function duplicateIds(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function runtimeFromBundle(bundle: NativeGameBundle): CompiledRuntime {
  return {
    schemaVersion: 1,
    simulationPolicyVersion: NATIVE_RUNTIME_CONTRACT_VERSION,
    sourceSnapshotId: bundle.source.snapshotId,
    sourceStructureVersionId: bundle.source.structureVersionId,
    fingerprint: bundle.runtimeFingerprint,
    startPassageId: bundle.startPassageId,
    mechanics: Object.fromEntries(bundle.mechanics.map((item) => [item.key, item])),
    passages: Object.fromEntries(bundle.passages.map((item) => [item.id, {
      id: item.id,
      choiceIds: item.choiceIds,
      terminal: item.terminal,
      endingId: item.endingId,
      routeIds: item.routeIds,
      requiredFactIds: item.requiredFactIds,
      revealedFactIds: item.revealedFactIds,
    }])),
    choices: Object.fromEntries(bundle.choices.map((item) => [item.id, {
      id: item.id,
      sourcePassageId: item.sourcePassageId,
      destinationPassageId: item.destinationPassageId,
      condition: item.condition,
      routeGateConditions: item.routeGateConditions,
      unavailableBehavior: item.unavailableBehavior,
      unavailableExplanation: item.unavailableExplanation,
      effects: item.effects,
      sourceDecisionIds: item.sourceDecisionIds,
      position: item.position,
    }])),
    endings: Object.fromEntries(bundle.endings.map((item) => [item.id, item])),
    routeIds: bundle.routeIds,
    decisionIds: bundle.decisionIds,
  };
}

function visitPassageReferences(condition: RuntimeCondition | null, target: string[] = []): string[] {
  if (!condition) return target;
  if (condition.kind === "visit-count") target.push(condition.passageId);
  else if (condition.kind === "not") visitPassageReferences(condition.item, target);
  else if (condition.kind === "all" || condition.kind === "any") {
    condition.items.forEach((item) => visitPassageReferences(item, target));
  }
  return target;
}

export function validateNativeGameBundle(value: unknown): NativeGameBundle {
  if (serializedBytes(value) > NATIVE_BUNDLE_LIMITS.maximumSerializedBytes) {
    throw new NativeBundleValidationError([{
      code: "native.bundle.too-large",
      message: `Native game bundle exceeds ${NATIVE_BUNDLE_LIMITS.maximumSerializedBytes} serialized bytes`,
    }]);
  }
  const parsed = NativeGameBundleSchema.safeParse(value);
  if (!parsed.success) {
    throw new NativeBundleValidationError(parsed.error.issues.map((issue) => ({
      code: "native.bundle.schema-invalid",
      message: issue.message,
      path: issue.path.join("."),
    })));
  }
  const bundle = parsed.data;
  const findings: NativeBundleFinding[] = [];
  const add = (finding: NativeBundleFinding): void => { findings.push(finding); };
  const passageIds = new Set(bundle.passages.map((item) => item.id));
  const choiceIds = new Set(bundle.choices.map((item) => item.id));
  const routeIds = new Set(bundle.routeIds);
  const decisionIds = new Set(bundle.decisionIds);
  const factIds = new Set(bundle.factIds);
  const endingIds = new Set(bundle.endings.map((item) => item.id));
  const mechanics = Object.fromEntries(bundle.mechanics.map((item) => [item.key, item]));

  for (const duplicate of duplicateIds(bundle.passages.map((item) => item.id))) add({
    code: "native.bundle.passage-duplicate", message: `Duplicate passage ID ${duplicate}`, passageId: duplicate,
  });
  for (const duplicate of duplicateIds(bundle.choices.map((item) => item.id))) add({
    code: "native.bundle.choice-duplicate", message: `Duplicate choice ID ${duplicate}`, choiceId: duplicate,
  });
  for (const duplicate of duplicateIds(bundle.endings.map((item) => item.id))) add({
    code: "native.bundle.ending-duplicate", message: `Duplicate ending ID ${duplicate}`, endingId: duplicate,
  });
  for (const duplicate of duplicateIds(bundle.mechanics.map((item) => item.key))) add({
    code: "native.bundle.mechanic-duplicate", message: `Duplicate mechanic key ${duplicate}`, mechanicKey: duplicate,
  });
  for (const [kind, values] of [["route", bundle.routeIds], ["decision", bundle.decisionIds], ["fact", bundle.factIds]] as const) {
    for (const duplicate of duplicateIds([...values])) add({
      code: `native.bundle.${kind}-duplicate`, message: `Duplicate ${kind} ID ${duplicate}`,
    });
  }
  if (!passageIds.has(bundle.startPassageId)) add({
    code: "native.bundle.start-missing", message: "Native game start passage does not exist", passageId: bundle.startPassageId,
  });

  let totalProseBytes = 0;
  for (const passage of bundle.passages) {
    const proseBytes = new TextEncoder().encode(passage.proseMarkdown).byteLength;
    totalProseBytes += proseBytes;
    if (!proseBytes) add({ code: "native.bundle.prose-missing", message: `Passage ${passage.id} has no player prose`, passageId: passage.id });
    if (proseBytes > NATIVE_BUNDLE_LIMITS.maximumProseBytesPerPassage) add({
      code: "native.bundle.prose-too-large", message: `Passage ${passage.id} prose exceeds its byte limit`, passageId: passage.id,
    });
    for (const duplicate of duplicateIds(passage.choiceIds)) add({
      code: "native.bundle.passage-choice-duplicate", message: `Passage ${passage.id} lists choice ${duplicate} more than once`, passageId: passage.id, choiceId: duplicate,
    });
    if (passage.terminal && passage.choiceIds.length) add({
      code: "native.bundle.terminal-outgoing", message: `Terminal passage ${passage.id} has outgoing choices`, passageId: passage.id,
    });
    if (passage.terminal && (!passage.endingId || !endingIds.has(passage.endingId))) add({
      code: "native.bundle.terminal-ending-invalid", message: `Terminal passage ${passage.id} has no valid ending`, passageId: passage.id,
    });
    if (!passage.terminal && passage.endingId !== null) add({
      code: "native.bundle.nonterminal-ending", message: `Nonterminal passage ${passage.id} references an ending`, passageId: passage.id,
    });
    if (!passage.terminal && !passage.choiceIds.length) add({
      code: "native.bundle.dead-end", message: `Nonterminal passage ${passage.id} has no choices`, passageId: passage.id,
    });
    passage.choiceIds.forEach((choiceId) => {
      const choice = bundle.choices.find((item) => item.id === choiceId);
      if (!choice || choice.sourcePassageId !== passage.id) add({
        code: "native.bundle.passage-choice-invalid", message: `Passage ${passage.id} has invalid choice ${choiceId}`, passageId: passage.id, choiceId,
      });
    });
    passage.routeIds.forEach((routeId) => {
      if (!routeIds.has(routeId)) add({ code: "native.bundle.route-missing", message: `Passage ${passage.id} references unknown route ${routeId}`, passageId: passage.id });
    });
    [...passage.requiredFactIds, ...passage.revealedFactIds].forEach((factId) => {
      if (!factIds.has(factId)) add({ code: "native.bundle.fact-missing", message: `Passage ${passage.id} references unknown fact ${factId}`, passageId: passage.id });
    });
  }
  if (totalProseBytes > NATIVE_BUNDLE_LIMITS.maximumTotalProseBytes) add({
    code: "native.bundle.prose-total-too-large", message: "Native game prose exceeds the total byte limit",
  });
  if (bundle.debug && serializedBytes(bundle.debug) > NATIVE_BUNDLE_LIMITS.maximumDebugBytes) add({
    code: "native.bundle.debug-too-large", message: "Native game debug provenance exceeds its byte limit",
  });

  for (const choice of bundle.choices) {
    if (!passageIds.has(choice.sourcePassageId)) add({ code: "native.bundle.choice-source-missing", message: `Choice ${choice.id} source is missing`, choiceId: choice.id });
    if (!passageIds.has(choice.destinationPassageId)) add({ code: "native.bundle.choice-destination-missing", message: `Choice ${choice.id} destination is missing`, choiceId: choice.id });
    if (!conditionCompatible(choice.condition, mechanics)) add({ code: "native.bundle.choice-condition-invalid", message: `Choice ${choice.id} condition is invalid`, choiceId: choice.id });
    for (const condition of choice.routeGateConditions) {
      if (!conditionCompatible(condition, mechanics)) add({ code: "native.bundle.route-gate-invalid", message: `Choice ${choice.id} route gate is invalid`, choiceId: choice.id });
    }
    for (const passageId of visitPassageReferences(choice.condition)) {
      if (!passageIds.has(passageId)) add({ code: "native.bundle.visit-reference-missing", message: `Choice ${choice.id} references unknown passage ${passageId}`, choiceId: choice.id });
    }
    for (const condition of choice.routeGateConditions) {
      for (const passageId of visitPassageReferences(condition)) if (!passageIds.has(passageId)) add({
        code: "native.bundle.visit-reference-missing", message: `Choice ${choice.id} gate references unknown passage ${passageId}`, choiceId: choice.id,
      });
    }
    for (const effect of choice.effects) if (!effectCompatible(effect, mechanics[effect.mechanicKey])) add({
      code: "native.bundle.choice-effect-invalid", message: `Choice ${choice.id} effect ${effect.id} is invalid`, choiceId: choice.id, mechanicKey: effect.mechanicKey,
    });
    choice.sourceDecisionIds.forEach((decisionId) => {
      if (!decisionIds.has(decisionId)) add({ code: "native.bundle.decision-missing", message: `Choice ${choice.id} references unknown decision ${decisionId}`, choiceId: choice.id });
    });
    const source = bundle.passages.find((item) => item.id === choice.sourcePassageId);
    if (source && !source.choiceIds.includes(choice.id)) add({
      code: "native.bundle.choice-unlisted", message: `Choice ${choice.id} is not listed by its source passage`, choiceId: choice.id, passageId: source.id,
    });
  }
  for (const ending of bundle.endings) {
    if (!routeIds.has(ending.routeId)) add({ code: "native.bundle.ending-route-missing", message: `Ending ${ending.id} references unknown route ${ending.routeId}`, endingId: ending.id });
    for (const condition of ending.gateConditions) {
      if (!conditionCompatible(condition, mechanics)) add({ code: "native.bundle.ending-gate-invalid", message: `Ending ${ending.id} gate is invalid`, endingId: ending.id });
    }
  }

  const runtime = runtimeFromBundle(bundle);
  if (compiledRuntimeFingerprint(runtime) !== bundle.runtimeFingerprint) add({
    code: "native.bundle.runtime-fingerprint-mismatch", message: "Native runtime fingerprint does not match its semantic payload",
  });
  if (nativeBundleFingerprint(bundle) !== bundle.bundleFingerprint) add({
    code: "native.bundle.fingerprint-mismatch", message: "Native bundle fingerprint does not match its semantic payload",
  });
  const expectedInitial = initializeRuntimeState(runtime);
  if (canonical(expectedInitial) !== canonical(bundle.initialState)) add({
    code: "native.bundle.initial-state-invalid", message: "Native bundle initial state does not match its mechanics and start passage",
  });
  findings.sort((left, right) => left.code.localeCompare(right.code)
    || (left.passageId ?? "").localeCompare(right.passageId ?? "")
    || (left.choiceId ?? "").localeCompare(right.choiceId ?? ""));
  if (findings.length) throw new NativeBundleValidationError(findings);
  return bundle;
}

export function loadNativeGame(value: unknown): LoadedNativeGame {
  const bundle = validateNativeGameBundle(value);
  const runtime = runtimeFromBundle(bundle);
  initializeRuntimeState(runtime);
  return {
    bundle,
    runtime,
    passages: new Map(bundle.passages.map((item) => [item.id, item])),
    choices: new Map(bundle.choices.map((item) => [item.id, item])),
  };
}

export function initializeNativeGame(game: LoadedNativeGame): RuntimeState {
  return cloneRuntimeState(game.bundle.initialState);
}

export function currentNativePassage(game: LoadedNativeGame, state: RuntimeState): NativeGamePassage {
  const passage = game.passages.get(state.currentPassageId);
  if (!passage) throw new NativeBundleValidationError([{
    code: "native.state.current-passage-missing", message: "Runtime state references an unknown current passage", passageId: state.currentPassageId,
  }]);
  return passage;
}

export function listNativeGameChoices(game: LoadedNativeGame, state: RuntimeState): NativeChoiceView[] {
  return listRuntimeChoices(game.runtime, state).map((availability) => ({
    choice: game.choices.get(availability.choiceId)!, availability,
  }));
}

export function evaluateNativeGameChoice(
  game: LoadedNativeGame,
  state: RuntimeState,
  choiceId: string,
): NativeChoiceView {
  const choice = game.choices.get(choiceId);
  if (!choice) throw new NativeBundleValidationError([{
    code: "native.choice.missing", message: `Native choice ${choiceId} does not exist`, choiceId,
  }]);
  return { choice, availability: evaluateRuntimeChoice(game.runtime, state, choiceId) };
}

export function chooseNativeGameChoice(
  game: LoadedNativeGame,
  state: RuntimeState,
  choiceId: string,
): RuntimeChoiceTransition {
  return applyRuntimeChoice(game.runtime, game.bundle.source.inputFingerprint, state, choiceId, state.turn);
}

export function nativeGameTerminal(game: LoadedNativeGame, state: RuntimeState) {
  return resolveRuntimeTerminal(game.runtime, state);
}
