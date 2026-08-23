import { z } from "zod";
import { canonical, serializedBytes, stableFingerprint } from "./canonical.js";
import {
  NATIVE_BUNDLE_LIMITS,
  NATIVE_GAME_BUNDLE_SCHEMA_ID,
  NATIVE_GAME_BUNDLE_SCHEMA_VERSION,
  NATIVE_RUNTIME_CONTRACT_VERSION,
  NativeGameBundleSchema,
  NativeRuntimeStateSchema,
  chooseNativeGameChoice,
  currentNativePassage,
  listNativeGameChoices,
  loadNativeGame,
  nativeGameTerminal,
  type LoadedNativeGame,
  type NativeGameBundle,
  type NativeGamePassage,
  type NativeChoiceView,
} from "./native-bundle.js";
import { cloneRuntimeState } from "./semantics.js";
import type { RuntimeResult, RuntimeState, RuntimeStateDelta } from "./types.js";

export const NATIVE_PLAYER_CONFIG_SCHEMA_ID = "cyoa.native-player-config" as const;
export const NATIVE_PLAYER_CONFIG_SCHEMA_VERSION = 1 as const;
export const NATIVE_PLAYER_SESSION_SCHEMA_ID = "cyoa.native-player-session" as const;
export const NATIVE_PLAYER_SESSION_SCHEMA_VERSION = 1 as const;
export const NATIVE_PLAYER_SAVE_SCHEMA_ID = "cyoa.native-player-save" as const;
export const NATIVE_PLAYER_SAVE_SCHEMA_VERSION = 1 as const;
export const NATIVE_PLAYER_INSTALLATION_SCHEMA_ID = "cyoa.native-player-installation" as const;
export const NATIVE_PLAYER_INSTALLATION_SCHEMA_VERSION = 1 as const;
export const NATIVE_PLAYER_MANUAL_SLOT_SCHEMA_ID = "cyoa.native-player-manual-slot" as const;
export const NATIVE_PLAYER_MANUAL_SLOT_SCHEMA_VERSION = 1 as const;

export const NATIVE_PLAYER_LIMITS = Object.freeze({
  maximumManualSlots: 20,
  maximumSlotLabelCharacters: 80,
  maximumRewindLastN: 100,
  maximumDesignatedCheckpointPassages: 100,
  maximumHistoryEntries: 200,
  maximumStateBytes: 1_000_000,
  maximumHistoryBytes: 1_500_000,
  maximumSaveBytes: 2 * 1024 * 1024,
  maximumTurn: 1_000_000,
  maximumVisitCount: 1_000_001,
});

const StableId = z.string().min(1).max(200);
const Fingerprint = z.string().regex(/^[0-9a-f]{32}$/);
const Label = z.string().max(NATIVE_PLAYER_LIMITS.maximumSlotLabelCharacters);
export const NativePlayerRewindPolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disabled") }).strict(),
  z.object({ kind: z.literal("previous-step") }).strict(),
  z.object({
    kind: z.literal("bounded-last-n"),
    steps: z.number().int().min(1).max(NATIVE_PLAYER_LIMITS.maximumRewindLastN),
  }).strict(),
  z.object({
    kind: z.literal("designated-checkpoints"),
    passageIds: z.array(StableId).max(NATIVE_PLAYER_LIMITS.maximumDesignatedCheckpointPassages),
    maximumCheckpoints: z.number().int().min(1).max(NATIVE_PLAYER_LIMITS.maximumHistoryEntries),
  }).strict(),
]);
const VisibleMechanicSchema = z.object({
  key: StableId,
  category: z.enum(["stat", "relationship", "resource"]),
  label: z.string().min(1).max(200),
}).strict();

const PlayerConfigIdentitySchema = z.object({
  schemaId: z.literal(NATIVE_PLAYER_CONFIG_SCHEMA_ID),
  schemaVersion: z.literal(NATIVE_PLAYER_CONFIG_SCHEMA_VERSION),
  gameId: StableId,
  rewindPolicy: NativePlayerRewindPolicySchema,
  autosaveEnabled: z.boolean(),
  manualSlotLimit: z.number().int().min(1).max(NATIVE_PLAYER_LIMITS.maximumManualSlots),
  visibleMechanics: z.array(VisibleMechanicSchema).max(500),
}).strict();
export const NativePlayerConfigSchema = PlayerConfigIdentitySchema.extend({ configFingerprint: Fingerprint }).strict();
export const NativePlayerAuthorConfigInputSchema = z.object({
  rewindPolicy: NativePlayerRewindPolicySchema,
  autosaveEnabled: z.boolean(),
  manualSlotLimit: z.number().int().min(1).max(NATIVE_PLAYER_LIMITS.maximumManualSlots),
  visibleMechanicKeys: z.array(StableId).max(500),
}).strict();

const CheckpointSchema = z.object({
  sequence: z.number().int().min(0).max(NATIVE_PLAYER_LIMITS.maximumTurn),
  passageId: StableId,
  reason: z.enum(["transition", "designated-checkpoint"]),
  originatingChoiceId: StableId.nullable(),
  state: NativeRuntimeStateSchema,
  stateFingerprint: Fingerprint,
}).strict();

const RuntimeContractSchema = z.object({
  schemaVersion: z.number().int().min(1).max(1_000),
  version: z.string().min(1).max(200),
}).strict();
const BundleContractSchema = z.object({
  schemaId: z.string().min(1).max(200),
  schemaVersion: z.number().int().min(1).max(1_000),
}).strict();
const SessionIdentitySchema = z.object({
  schemaId: z.literal(NATIVE_PLAYER_SESSION_SCHEMA_ID),
  schemaVersion: z.literal(NATIVE_PLAYER_SESSION_SCHEMA_VERSION),
  gameId: StableId,
  bundleFingerprint: Fingerprint,
  sourceInputFingerprint: Fingerprint,
  runtimeContract: RuntimeContractSchema,
  bundleContract: BundleContractSchema,
  playerConfigFingerprint: Fingerprint,
  sequence: z.number().int().min(0).max(NATIVE_PLAYER_LIMITS.maximumTurn),
  state: NativeRuntimeStateSchema,
  history: z.array(CheckpointSchema).max(NATIVE_PLAYER_LIMITS.maximumHistoryEntries),
}).strict();
export const NativePlayerSessionSchema = SessionIdentitySchema.extend({ sessionFingerprint: Fingerprint }).strict();

const SaveIdentitySchema = z.object({
  schemaId: z.literal(NATIVE_PLAYER_SAVE_SCHEMA_ID),
  schemaVersion: z.literal(NATIVE_PLAYER_SAVE_SCHEMA_VERSION),
  gameId: StableId,
  bundleFingerprint: Fingerprint,
  sourceInputFingerprint: Fingerprint,
  runtimeContract: RuntimeContractSchema,
  bundleContract: BundleContractSchema,
  playerConfigFingerprint: Fingerprint,
  sequence: z.number().int().min(0).max(NATIVE_PLAYER_LIMITS.maximumTurn),
  state: NativeRuntimeStateSchema,
  history: z.array(CheckpointSchema).max(NATIVE_PLAYER_LIMITS.maximumHistoryEntries),
}).strict();
export const NativePlayerSaveSchema = SaveIdentitySchema.extend({
  saveFingerprint: Fingerprint,
  metadata: z.object({ label: Label.optional(), savedAt: z.string().max(100).optional() }).strict().optional(),
}).strict();

export const NativePlayerInstallationSchema = z.object({
  schemaId: z.literal(NATIVE_PLAYER_INSTALLATION_SCHEMA_ID),
  schemaVersion: z.literal(NATIVE_PLAYER_INSTALLATION_SCHEMA_VERSION),
  gameId: StableId,
  bundleFingerprint: Fingerprint,
  bundle: NativeGameBundleSchema,
  config: NativePlayerConfigSchema,
  debugAuthorized: z.boolean(),
}).strict();

export const NativePlayerManualSlotSchema = z.object({
  schemaId: z.literal(NATIVE_PLAYER_MANUAL_SLOT_SCHEMA_ID),
  schemaVersion: z.literal(NATIVE_PLAYER_MANUAL_SLOT_SCHEMA_VERSION),
  slotId: StableId,
  gameId: StableId,
  bundleFingerprint: Fingerprint,
  label: Label,
  savedAt: z.string().max(100),
  save: NativePlayerSaveSchema,
}).strict();

export type NativePlayerConfig = z.infer<typeof NativePlayerConfigSchema>;
export type NativePlayerAuthorConfigInput = z.infer<typeof NativePlayerAuthorConfigInputSchema>;
export type NativePlayerRewindPolicy = z.infer<typeof NativePlayerRewindPolicySchema>;
export type NativePlayerVisibleMechanic = z.infer<typeof VisibleMechanicSchema>;
export type NativePlayerCheckpoint = z.infer<typeof CheckpointSchema>;
export type NativePlayerSession = z.infer<typeof NativePlayerSessionSchema>;
export type NativePlayerSave = z.infer<typeof NativePlayerSaveSchema>;
export type NativePlayerInstallation = z.infer<typeof NativePlayerInstallationSchema>;
export type NativePlayerManualSlot = z.infer<typeof NativePlayerManualSlotSchema>;

export type NativePlayerErrorCode =
  | "player_config_invalid"
  | "player_session_invalid"
  | "player_choice_rejected"
  | "player_rewind_unavailable"
  | "save_schema_unsupported"
  | "save_game_mismatch"
  | "save_bundle_incompatible"
  | "save_runtime_incompatible"
  | "save_bundle_schema_incompatible"
  | "save_fingerprint_invalid"
  | "save_state_invalid"
  | "save_history_invalid"
  | "save_too_large"
  | "installation_invalid"
  | "manual_slot_invalid"
  | "storage_unavailable"
  | "storage_quota_exceeded"
  | "storage_transaction_failed";

export class NativePlayerError extends Error {
  public constructor(public readonly code: NativePlayerErrorCode, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export interface NativePlayerConfigInput {
  gameId: string;
  rewindPolicy?: NativePlayerRewindPolicy;
  autosaveEnabled?: boolean;
  manualSlotLimit?: number;
  visibleMechanics?: NativePlayerVisibleMechanic[];
}

export interface NativePlayerView {
  passage: NativeGamePassage;
  choices: NativeChoiceView[];
  terminal: { result: RuntimeResult | null; conditionResults: boolean[] };
  visibleState: Array<{
    key: string;
    category: "stat" | "relationship" | "resource";
    label: string;
    value: number | string;
    bandLabel?: string;
  }>;
}

export interface NativePlayerTransitionResult {
  session: NativePlayerSession;
  stateDelta: RuntimeStateDelta[];
  choiceId: string;
}

export interface NativePlayerStorage {
  install(value: NativePlayerInstallation): Promise<void>;
  readInstallation(gameId: string, bundleFingerprint: string): Promise<unknown | null>;
  writeAutosave(gameId: string, bundleFingerprint: string, value: NativePlayerSave): Promise<void>;
  readAutosave(gameId: string, bundleFingerprint: string): Promise<unknown | null>;
  writeManualSlot(value: NativePlayerManualSlot): Promise<void>;
  listManualSlots(gameId: string): Promise<unknown[]>;
  deleteManualSlot(gameId: string, slotId: string, bundleFingerprint: string): Promise<void>;
}

export function createNativePlayerConfig(input: NativePlayerConfigInput, bundleValue?: unknown): NativePlayerConfig {
  const rewindPolicy = input.rewindPolicy?.kind === "designated-checkpoints"
    ? { ...input.rewindPolicy, passageIds: [...input.rewindPolicy.passageIds].sort() }
    : input.rewindPolicy ?? { kind: "previous-step" as const };
  const identity = PlayerConfigIdentitySchema.parse({
    schemaId: NATIVE_PLAYER_CONFIG_SCHEMA_ID,
    schemaVersion: NATIVE_PLAYER_CONFIG_SCHEMA_VERSION,
    gameId: input.gameId,
    rewindPolicy,
    autosaveEnabled: input.autosaveEnabled ?? true,
    manualSlotLimit: input.manualSlotLimit ?? NATIVE_PLAYER_LIMITS.maximumManualSlots,
    visibleMechanics: [...(input.visibleMechanics ?? [])].sort((left, right) => left.key.localeCompare(right.key)),
  });
  const config = NativePlayerConfigSchema.parse({ ...identity, configFingerprint: stableFingerprint(identity) });
  return bundleValue === undefined ? config : assertNativePlayerConfig(config, bundleValue);
}

export function assertNativePlayerConfig(value: unknown, bundleValue?: unknown): NativePlayerConfig {
  let config: NativePlayerConfig;
  try {
    config = NativePlayerConfigSchema.parse(value);
  } catch (error) {
    throw new NativePlayerError("player_config_invalid", `Player configuration is invalid: ${(error as Error).message}`);
  }
  const { configFingerprint: _fingerprint, ...identity } = config;
  if (stableFingerprint(identity) !== config.configFingerprint) {
    throw new NativePlayerError("player_config_invalid", "Player configuration fingerprint is invalid");
  }
  if (duplicateValues(config.visibleMechanics.map((item) => item.key)).length) {
    throw new NativePlayerError("player_config_invalid", "Player configuration contains duplicate visible mechanic keys");
  }
  if (config.rewindPolicy.kind === "designated-checkpoints"
    && (duplicateValues(config.rewindPolicy.passageIds).length
      || JSON.stringify(config.rewindPolicy.passageIds) !== JSON.stringify([...config.rewindPolicy.passageIds].sort()))) {
    throw new NativePlayerError("player_config_invalid", "Player configuration contains non-canonical checkpoint passages");
  }
  if (bundleValue !== undefined) {
    const game = loadNativeGame(bundleValue);
    if (config.gameId !== game.bundle.gameId) {
      throw new NativePlayerError("player_config_invalid", "Player configuration belongs to another game");
    }
    for (const item of config.visibleMechanics) {
      const definition = game.runtime.mechanics[item.key];
      if (!definition || definition.category !== item.category) {
        throw new NativePlayerError("player_config_invalid", `Visible mechanic ${item.key} does not match the game bundle`);
      }
    }
    if (config.rewindPolicy.kind === "designated-checkpoints") {
      for (const passageId of config.rewindPolicy.passageIds) if (!game.passages.has(passageId)) {
        throw new NativePlayerError("player_config_invalid", `Checkpoint passage ${passageId} does not exist`);
      }
    }
  }
  return config;
}

export function createNativePlayerSession(bundleValue: unknown, configValue: unknown): NativePlayerSession {
  const game = loadNativeGame(bundleValue);
  const config = assertNativePlayerConfig(configValue, game.bundle);
  return buildSession(game, config, game.bundle.initialState, [], 0);
}

export function assertNativeRuntimeState(game: LoadedNativeGame, value: unknown): RuntimeState {
  if (playerSerializedBytes(value, "save_state_invalid") > NATIVE_PLAYER_LIMITS.maximumStateBytes) {
    throw new NativePlayerError("save_state_invalid", "Runtime state exceeds its serialized byte limit");
  }
  const parsed = NativeRuntimeStateSchema.safeParse(value);
  if (!parsed.success || canonical(parsed.data) !== canonical(value)) {
    throw new NativePlayerError("save_state_invalid", "Runtime state has an invalid or unsupported shape");
  }
  const state = parsed.data;
  if (!game.passages.has(state.currentPassageId)) {
    throw new NativePlayerError("save_state_invalid", `Runtime state references missing passage ${state.currentPassageId}`);
  }
  if (state.turn > NATIVE_PLAYER_LIMITS.maximumTurn) {
    throw new NativePlayerError("save_state_invalid", "Runtime turn exceeds its bound");
  }
  const expected = {
    stats: mechanicKeys(game, "stat"),
    relationships: mechanicKeys(game, "relationship"),
    flags: mechanicKeys(game, "flag"),
    resources: mechanicKeys(game, "resource"),
  };
  for (const [category, keys] of Object.entries(expected) as Array<[keyof typeof expected, string[]]>) {
    const record = state[category];
    if (!sameSorted(Object.keys(record), keys)) {
      throw new NativePlayerError("save_state_invalid", `Runtime ${category} keys do not match the game bundle`);
    }
    for (const key of keys) {
      const definition = game.runtime.mechanics[key]!;
      const valueAtKey = record[key];
      if (definition.valueType === "number") {
        if (typeof valueAtKey !== "number" || !Number.isFinite(valueAtKey)
          || (definition.minimum !== undefined && valueAtKey < definition.minimum)
          || (definition.maximum !== undefined && valueAtKey > definition.maximum)) {
          throw new NativePlayerError("save_state_invalid", `Runtime mechanic ${key} has an invalid value`);
        }
      } else if (definition.valueType === "boolean" && typeof valueAtKey !== "boolean") {
        throw new NativePlayerError("save_state_invalid", `Runtime mechanic ${key} has an invalid value`);
      }
    }
  }
  validateStableSet(state.routes, new Set(game.bundle.routeIds), "route");
  validateStableSet(state.decisions, new Set(game.bundle.decisionIds), "decision");
  validateStableSet(state.knownFacts, new Set(game.bundle.factIds), "fact");
  let visitTotal = 0;
  for (const [passageId, count] of Object.entries(state.visitCounts)) {
    if (!game.passages.has(passageId) || count < 1 || count > NATIVE_PLAYER_LIMITS.maximumVisitCount) {
      throw new NativePlayerError("save_state_invalid", `Runtime visit record for ${passageId} is invalid`);
    }
    visitTotal += count;
  }
  if ((state.visitCounts[state.currentPassageId] ?? 0) < 1 || visitTotal !== state.turn + 1) {
    throw new NativePlayerError("save_state_invalid", "Runtime visit history is inconsistent with its turn and current passage");
  }
  return cloneRuntimeState(state);
}

export function assertNativePlayerSession(
  bundleValue: unknown,
  configValue: unknown,
  value: unknown,
): NativePlayerSession {
  const game = loadNativeGame(bundleValue);
  const config = assertNativePlayerConfig(configValue, game.bundle);
  let session: NativePlayerSession;
  try {
    session = NativePlayerSessionSchema.parse(value);
  } catch (error) {
    throw new NativePlayerError("player_session_invalid", `Player session is invalid: ${(error as Error).message}`);
  }
  const { sessionFingerprint: _fingerprint, ...identity } = session;
  if (stableFingerprint(identity) !== session.sessionFingerprint) {
    throw new NativePlayerError("player_session_invalid", "Player session fingerprint is invalid");
  }
  assertCompatibility(game, session, "player_session_invalid");
  if (session.playerConfigFingerprint !== config.configFingerprint || session.sequence !== session.state.turn) {
    throw new NativePlayerError("player_session_invalid", "Player session policy or sequence identity is invalid");
  }
  try {
    assertNativeRuntimeState(game, session.state);
    validateHistory(game, session.history, session.sequence);
  } catch (error) {
    throw new NativePlayerError("player_session_invalid", "Player session state or history is invalid", error);
  }
  if (canonical(applyCurrentHistoryPolicy(config, session.history)) !== canonical(session.history)) {
    throw new NativePlayerError("player_session_invalid", "Player session history is not canonical for the current policy");
  }
  return structuredClone(session);
}

export function canRewindNativePlayerSession(
  bundleValue: unknown,
  configValue: unknown,
  sessionValue: unknown,
): boolean {
  const game = loadNativeGame(bundleValue);
  const config = assertNativePlayerConfig(configValue, game.bundle);
  const session = assertNativePlayerSession(game.bundle, config, sessionValue);
  return config.rewindPolicy.kind !== "disabled" && earlierCheckpointIndex(session) >= 0;
}

export function nativePlayerView(
  bundleValue: unknown,
  configValue: unknown,
  sessionValue: unknown,
): NativePlayerView {
  const game = loadNativeGame(bundleValue);
  const config = assertNativePlayerConfig(configValue, game.bundle);
  const session = assertNativePlayerSession(game.bundle, config, sessionValue);
  return {
    passage: currentNativePassage(game, session.state),
    choices: listNativeGameChoices(game, session.state).filter((item) => item.availability.visible),
    terminal: nativeGameTerminal(game, session.state),
    visibleState: config.visibleMechanics.map((item) => {
      const definition = game.runtime.mechanics[item.key]!;
      const value = definition.category === "stat" ? session.state.stats[item.key]!
        : definition.category === "relationship" ? session.state.relationships[item.key]!
          : session.state.resources[item.key]!;
      const band = definition.category === "relationship"
        ? [...(definition.bands ?? [])].filter((candidate) => typeof value === "number" && value >= candidate.minimum).at(-1)
        : undefined;
      return { ...item, value, ...(band ? { bandLabel: band.label } : {}) };
    }),
  };
}

export function chooseNativePlayerSession(
  bundleValue: unknown,
  configValue: unknown,
  sessionValue: unknown,
  choiceId: string,
): NativePlayerTransitionResult {
  const game = loadNativeGame(bundleValue);
  const config = assertNativePlayerConfig(configValue, game.bundle);
  const session = assertNativePlayerSession(game.bundle, config, sessionValue);
  const transition = chooseNativeGameChoice(game, session.state, choiceId);
  if (!transition.ok) {
    throw new NativePlayerError("player_choice_rejected", transition.finding.message, transition.finding);
  }
  const nextState = assertNativeRuntimeState(game, transition.state);
  const nextSequence = nextState.turn;
  const history = historyAfterTransition(game, config, session, nextState, choiceId);
  return {
    session: buildSession(game, config, nextState, history, nextSequence),
    stateDelta: transition.step.stateDelta,
    choiceId,
  };
}

export function rewindNativePlayerSession(
  bundleValue: unknown,
  configValue: unknown,
  sessionValue: unknown,
): NativePlayerSession {
  const game = loadNativeGame(bundleValue);
  const config = assertNativePlayerConfig(configValue, game.bundle);
  const session = assertNativePlayerSession(game.bundle, config, sessionValue);
  if (config.rewindPolicy.kind === "disabled") {
    throw new NativePlayerError("player_rewind_unavailable", "No rewind checkpoint is available");
  }
  const index = earlierCheckpointIndex(session);
  if (index < 0) throw new NativePlayerError("player_rewind_unavailable", "No earlier rewind checkpoint is available");
  const checkpoint = session.history[index]!;
  const state = assertNativeRuntimeState(game, checkpoint.state);
  return buildSession(game, config, state, session.history.slice(0, index), checkpoint.sequence);
}

export function restartNativePlayerSession(bundleValue: unknown, configValue: unknown): NativePlayerSession {
  return createNativePlayerSession(bundleValue, configValue);
}

export function createNativePlayerSave(
  bundleValue: unknown,
  configValue: unknown,
  sessionValue: unknown,
  metadata?: { label?: string; savedAt?: string },
): NativePlayerSave {
  const game = loadNativeGame(bundleValue);
  const config = assertNativePlayerConfig(configValue, game.bundle);
  const session = assertNativePlayerSession(game.bundle, config, sessionValue);
  const identity = SaveIdentitySchema.parse({
    schemaId: NATIVE_PLAYER_SAVE_SCHEMA_ID,
    schemaVersion: NATIVE_PLAYER_SAVE_SCHEMA_VERSION,
    gameId: session.gameId,
    bundleFingerprint: session.bundleFingerprint,
    sourceInputFingerprint: session.sourceInputFingerprint,
    runtimeContract: session.runtimeContract,
    bundleContract: session.bundleContract,
    playerConfigFingerprint: session.playerConfigFingerprint,
    sequence: session.sequence,
    state: session.state,
    history: session.history,
  });
  const save = NativePlayerSaveSchema.parse({
    ...identity,
    saveFingerprint: stableFingerprint(identity),
    ...(metadata ? { metadata } : {}),
  });
  if (serializedBytes(save) > NATIVE_PLAYER_LIMITS.maximumSaveBytes) {
    throw new NativePlayerError("save_too_large", "Player save exceeds its serialized byte limit");
  }
  return save;
}

export function loadNativePlayerSave(
  bundleValue: unknown,
  configValue: unknown,
  value: unknown,
): NativePlayerSession {
  const game = loadNativeGame(bundleValue);
  const config = assertNativePlayerConfig(configValue, game.bundle);
  if (playerSerializedBytes(value, "save_state_invalid") > NATIVE_PLAYER_LIMITS.maximumSaveBytes) {
    throw new NativePlayerError("save_too_large", "Player save exceeds its serialized byte limit");
  }
  const envelope = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (envelope.schemaId !== NATIVE_PLAYER_SAVE_SCHEMA_ID || envelope.schemaVersion !== NATIVE_PLAYER_SAVE_SCHEMA_VERSION) {
    throw new NativePlayerError("save_schema_unsupported", "Player save schema is unsupported");
  }
  let save: NativePlayerSave;
  try {
    save = NativePlayerSaveSchema.parse(value);
  } catch (error) {
    const issues = error instanceof z.ZodError ? error.issues : [];
    const code = issues.length > 0 && issues.every((issue) => issue.path[0] === "history")
      ? "save_history_invalid" : "save_state_invalid";
    throw new NativePlayerError(code, `Player save is malformed: ${(error as Error).message}`);
  }
  if (save.gameId !== game.bundle.gameId) throw new NativePlayerError("save_game_mismatch", "Player save belongs to another game");
  if (save.bundleFingerprint !== game.bundle.bundleFingerprint) {
    throw new NativePlayerError("save_bundle_incompatible", "Player save requires a different gameplay bundle");
  }
  if (save.runtimeContract.version !== game.bundle.runtimeContract.version
    || save.runtimeContract.schemaVersion !== game.bundle.runtimeContract.schemaVersion) {
    throw new NativePlayerError("save_runtime_incompatible", "Player save requires an unsupported runtime contract");
  }
  if (save.bundleContract.schemaId !== game.bundle.schemaId
    || save.bundleContract.schemaVersion !== game.bundle.schemaVersion) {
    throw new NativePlayerError("save_bundle_schema_incompatible", "Player save requires an unsupported bundle schema");
  }
  const { saveFingerprint: _fingerprint, metadata: _metadata, ...identity } = save;
  if (stableFingerprint(identity) !== save.saveFingerprint) {
    throw new NativePlayerError("save_fingerprint_invalid", "Player save fingerprint is invalid");
  }
  const state = assertNativeRuntimeState(game, save.state);
  if (save.sequence !== state.turn) {
    throw new NativePlayerError("save_state_invalid", "Player save sequence does not match its runtime turn");
  }
  validateHistory(game, save.history, save.sequence);
  const history = applyCurrentHistoryPolicy(config, save.history);
  return buildSession(game, config, state, history, save.sequence);
}

export function createNativePlayerInstallation(
  bundleValue: unknown,
  configValue: unknown,
  debugAuthorized = false,
): NativePlayerInstallation {
  const game = loadNativeGame(bundleValue);
  const config = assertNativePlayerConfig(configValue, game.bundle);
  return NativePlayerInstallationSchema.parse({
    schemaId: NATIVE_PLAYER_INSTALLATION_SCHEMA_ID,
    schemaVersion: NATIVE_PLAYER_INSTALLATION_SCHEMA_VERSION,
    gameId: game.bundle.gameId,
    bundleFingerprint: game.bundle.bundleFingerprint,
    bundle: game.bundle,
    config,
    debugAuthorized,
  });
}

export function assertNativePlayerInstallation(value: unknown): NativePlayerInstallation {
  if (playerSerializedBytes(value, "installation_invalid")
    > NATIVE_BUNDLE_LIMITS.maximumSerializedBytes + NATIVE_PLAYER_LIMITS.maximumSaveBytes) {
    throw new NativePlayerError("installation_invalid", "Installed native game exceeds its byte limit");
  }
  let installation: NativePlayerInstallation;
  try {
    installation = NativePlayerInstallationSchema.parse(value);
  } catch (error) {
    throw new NativePlayerError("installation_invalid", `Installed native game is malformed: ${(error as Error).message}`);
  }
  const game = loadNativeGame(installation.bundle);
  assertNativePlayerConfig(installation.config, game.bundle);
  if (installation.gameId !== game.bundle.gameId
    || installation.bundleFingerprint !== game.bundle.bundleFingerprint) {
    throw new NativePlayerError("installation_invalid", "Installed native game identity is inconsistent");
  }
  return structuredClone(installation);
}

export function createNativePlayerManualSlot(
  bundleValue: unknown,
  configValue: unknown,
  sessionValue: unknown,
  slotId: string,
  label: string,
  savedAt: string,
): NativePlayerManualSlot {
  const save = createNativePlayerSave(bundleValue, configValue, sessionValue, { label, savedAt });
  return NativePlayerManualSlotSchema.parse({
    schemaId: NATIVE_PLAYER_MANUAL_SLOT_SCHEMA_ID,
    schemaVersion: NATIVE_PLAYER_MANUAL_SLOT_SCHEMA_VERSION,
    slotId,
    gameId: save.gameId,
    bundleFingerprint: save.bundleFingerprint,
    label,
    savedAt,
    save,
  });
}

export function assertNativePlayerManualSlot(value: unknown): NativePlayerManualSlot {
  let slot: NativePlayerManualSlot;
  try {
    slot = NativePlayerManualSlotSchema.parse(value);
  } catch (error) {
    throw new NativePlayerError("manual_slot_invalid", `Manual save slot is malformed: ${(error as Error).message}`);
  }
  if (slot.gameId !== slot.save.gameId || slot.bundleFingerprint !== slot.save.bundleFingerprint
    || slot.label !== (slot.save.metadata?.label ?? "") || slot.savedAt !== slot.save.metadata?.savedAt) {
    throw new NativePlayerError("manual_slot_invalid", "Manual save slot identity is inconsistent");
  }
  return structuredClone(slot);
}

export function nativePlayerSaveCompatibility(bundleValue: unknown, value: unknown): { compatible: boolean; code: NativePlayerErrorCode | null } {
  const game = loadNativeGame(bundleValue);
  try {
    if (playerSerializedBytes(value, "save_state_invalid") > NATIVE_PLAYER_LIMITS.maximumSaveBytes) {
      return { compatible: false, code: "save_too_large" };
    }
  } catch (error) {
    return { compatible: false, code: error instanceof NativePlayerError ? error.code : "save_state_invalid" };
  }
  const envelope = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (envelope.schemaId !== NATIVE_PLAYER_SAVE_SCHEMA_ID || envelope.schemaVersion !== NATIVE_PLAYER_SAVE_SCHEMA_VERSION) {
    return { compatible: false, code: "save_schema_unsupported" };
  }
  const parsed = NativePlayerSaveSchema.safeParse(value);
  if (!parsed.success) return { compatible: false, code: "save_state_invalid" };
  if (parsed.data.gameId !== game.bundle.gameId) return { compatible: false, code: "save_game_mismatch" };
  if (parsed.data.bundleFingerprint !== game.bundle.bundleFingerprint) return { compatible: false, code: "save_bundle_incompatible" };
  if (parsed.data.runtimeContract.version !== game.bundle.runtimeContract.version
    || parsed.data.runtimeContract.schemaVersion !== game.bundle.runtimeContract.schemaVersion) {
    return { compatible: false, code: "save_runtime_incompatible" };
  }
  if (parsed.data.bundleContract.schemaId !== game.bundle.schemaId
    || parsed.data.bundleContract.schemaVersion !== game.bundle.schemaVersion) {
    return { compatible: false, code: "save_bundle_schema_incompatible" };
  }
  const { saveFingerprint: _fingerprint, metadata: _metadata, ...identity } = parsed.data;
  if (stableFingerprint(identity) !== parsed.data.saveFingerprint) {
    return { compatible: false, code: "save_fingerprint_invalid" };
  }
  try {
    const state = assertNativeRuntimeState(game, parsed.data.state);
    if (parsed.data.sequence !== state.turn) return { compatible: false, code: "save_state_invalid" };
    validateHistory(game, parsed.data.history, parsed.data.sequence);
  } catch (error) {
    return {
      compatible: false,
      code: error instanceof NativePlayerError && error.code === "save_history_invalid"
        ? "save_history_invalid" : "save_state_invalid",
    };
  }
  return { compatible: true, code: null };
}

export class MemoryNativePlayerStorage implements NativePlayerStorage {
  private readonly installations = new Map<string, unknown>();
  private readonly autosaves = new Map<string, unknown>();
  private readonly manualSlots = new Map<string, unknown>();

  async install(value: NativePlayerInstallation): Promise<void> {
    const checked = assertNativePlayerInstallation(value);
    this.installations.set(namespace(checked.gameId, checked.bundleFingerprint), structuredClone(checked));
  }

  async readInstallation(gameId: string, bundleFingerprint: string): Promise<unknown | null> {
    return cloneUnknown(this.installations.get(namespace(gameId, bundleFingerprint)) ?? null);
  }

  async writeAutosave(gameId: string, bundleFingerprint: string, value: NativePlayerSave): Promise<void> {
    const checked = NativePlayerSaveSchema.safeParse(value);
    if (!checked.success || checked.data.gameId !== gameId || checked.data.bundleFingerprint !== bundleFingerprint) {
      throw new NativePlayerError("save_state_invalid", "Autosave identity is invalid");
    }
    this.autosaves.set(namespace(gameId, bundleFingerprint), structuredClone(checked.data));
  }

  async readAutosave(gameId: string, bundleFingerprint: string): Promise<unknown | null> {
    return cloneUnknown(this.autosaves.get(namespace(gameId, bundleFingerprint)) ?? null);
  }

  async writeManualSlot(value: NativePlayerManualSlot): Promise<void> {
    const checked = assertNativePlayerManualSlot(value);
    const existing = [...this.manualSlots.values()].map((item) => assertNativePlayerManualSlot(item))
      .filter((item) => item.gameId === checked.gameId);
    const key = manualNamespace(checked.gameId, checked.bundleFingerprint, checked.slotId);
    if (!this.manualSlots.has(key) && existing.length >= NATIVE_PLAYER_LIMITS.maximumManualSlots) {
      throw new NativePlayerError("storage_quota_exceeded", "Manual save-slot limit reached");
    }
    this.manualSlots.set(key, structuredClone(checked));
  }

  async listManualSlots(gameId: string): Promise<unknown[]> {
    return [...this.manualSlots.values()].map(cloneUnknown).filter((item) => (
      item && typeof item === "object" && (item as { gameId?: unknown }).gameId === gameId
    ));
  }

  async deleteManualSlot(gameId: string, slotId: string, bundleFingerprint: string): Promise<void> {
    this.manualSlots.delete(manualNamespace(gameId, bundleFingerprint, slotId));
  }

  unsafeSetAutosave(gameId: string, bundleFingerprint: string, value: unknown): void {
    this.autosaves.set(namespace(gameId, bundleFingerprint), cloneUnknown(value));
  }
}

function buildSession(
  game: LoadedNativeGame,
  config: NativePlayerConfig,
  state: RuntimeState,
  history: NativePlayerCheckpoint[],
  sequence: number,
): NativePlayerSession {
  const identity = SessionIdentitySchema.parse({
    schemaId: NATIVE_PLAYER_SESSION_SCHEMA_ID,
    schemaVersion: NATIVE_PLAYER_SESSION_SCHEMA_VERSION,
    gameId: game.bundle.gameId,
    bundleFingerprint: game.bundle.bundleFingerprint,
    sourceInputFingerprint: game.bundle.source.inputFingerprint,
    runtimeContract: game.bundle.runtimeContract,
    bundleContract: { schemaId: game.bundle.schemaId, schemaVersion: game.bundle.schemaVersion },
    playerConfigFingerprint: config.configFingerprint,
    sequence,
    state: assertNativeRuntimeState(game, state),
    history: applyCurrentHistoryPolicy(config, history),
  });
  if (identity.sequence !== identity.state.turn) {
    throw new NativePlayerError("player_session_invalid", "Player session sequence does not match its runtime turn");
  }
  return NativePlayerSessionSchema.parse({ ...identity, sessionFingerprint: stableFingerprint(identity) });
}

function historyAfterTransition(
  game: LoadedNativeGame,
  config: NativePlayerConfig,
  session: NativePlayerSession,
  nextState: RuntimeState,
  choiceId: string,
): NativePlayerCheckpoint[] {
  if (config.rewindPolicy.kind === "disabled") return [];
  const checkpointState = config.rewindPolicy.kind === "designated-checkpoints" ? nextState : session.state;
  if (config.rewindPolicy.kind === "designated-checkpoints"
    && !config.rewindPolicy.passageIds.includes(nextState.currentPassageId)) return session.history;
  const checkpoint = checkpointFor(
    game,
    checkpointState,
    config.rewindPolicy.kind === "designated-checkpoints" ? "designated-checkpoint" : "transition",
    choiceId,
  );
  return applyCurrentHistoryPolicy(config, [...session.history, checkpoint]);
}

function checkpointFor(
  game: LoadedNativeGame,
  stateValue: RuntimeState,
  reason: NativePlayerCheckpoint["reason"],
  choiceId: string | null,
): NativePlayerCheckpoint {
  const state = assertNativeRuntimeState(game, stateValue);
  return CheckpointSchema.parse({
    sequence: state.turn,
    passageId: state.currentPassageId,
    reason,
    originatingChoiceId: choiceId,
    state,
    stateFingerprint: stableFingerprint(state),
  });
}

function validateHistory(game: LoadedNativeGame, history: NativePlayerCheckpoint[], sequence: number): void {
  if (playerSerializedBytes(history, "save_history_invalid") > NATIVE_PLAYER_LIMITS.maximumHistoryBytes) {
    throw new NativePlayerError("save_history_invalid", "Player rewind history exceeds its byte limit");
  }
  let previousSequence = -1;
  for (const checkpoint of history) {
    if (checkpoint.sequence <= previousSequence || checkpoint.sequence > sequence
      || checkpoint.sequence !== checkpoint.state.turn || checkpoint.passageId !== checkpoint.state.currentPassageId) {
      throw new NativePlayerError("save_history_invalid", "Player rewind history has invalid sequence lineage");
    }
    let state: RuntimeState;
    try {
      state = assertNativeRuntimeState(game, checkpoint.state);
    } catch (error) {
      throw new NativePlayerError("save_history_invalid", "Player rewind checkpoint state is invalid", error);
    }
    if (stableFingerprint(state) !== checkpoint.stateFingerprint) {
      throw new NativePlayerError("save_history_invalid", "Player rewind checkpoint fingerprint is invalid");
    }
    if (checkpoint.originatingChoiceId) {
      const choice = game.choices.get(checkpoint.originatingChoiceId);
      const expectedPassageId = checkpoint.reason === "transition"
        ? choice?.sourcePassageId : choice?.destinationPassageId;
      if (!choice || expectedPassageId !== checkpoint.passageId) {
        throw new NativePlayerError("save_history_invalid", "Player rewind checkpoint choice lineage is invalid");
      }
    }
    previousSequence = checkpoint.sequence;
  }
}

function applyCurrentHistoryPolicy(config: NativePlayerConfig, history: NativePlayerCheckpoint[]): NativePlayerCheckpoint[] {
  let retained = [...history];
  if (config.rewindPolicy.kind === "disabled") retained = [];
  else if (config.rewindPolicy.kind === "previous-step") {
    retained = retained.filter((item) => item.reason === "transition").slice(-1);
  } else if (config.rewindPolicy.kind === "bounded-last-n") {
    retained = retained.filter((item) => item.reason === "transition").slice(-config.rewindPolicy.steps);
  }
  else {
    const policy = config.rewindPolicy;
    retained = retained.filter((item) => item.reason === "designated-checkpoint"
        && policy.passageIds.includes(item.passageId))
      .slice(-policy.maximumCheckpoints);
  }
  while (retained.length
    && playerSerializedBytes(retained, "save_history_invalid") > NATIVE_PLAYER_LIMITS.maximumHistoryBytes) retained.shift();
  return retained.slice(-NATIVE_PLAYER_LIMITS.maximumHistoryEntries).map((item) => structuredClone(item));
}

function earlierCheckpointIndex(session: NativePlayerSession): number {
  const currentStateFingerprint = stableFingerprint(session.state);
  let index = session.history.length - 1;
  while (index >= 0 && session.history[index]!.stateFingerprint === currentStateFingerprint) index -= 1;
  return index;
}

function assertCompatibility(
  game: LoadedNativeGame,
  value: Pick<NativePlayerSession, "gameId" | "bundleFingerprint" | "runtimeContract" | "bundleContract">,
  code: NativePlayerErrorCode,
): void {
  if (value.gameId !== game.bundle.gameId || value.bundleFingerprint !== game.bundle.bundleFingerprint
    || value.runtimeContract.version !== game.bundle.runtimeContract.version
    || value.runtimeContract.schemaVersion !== game.bundle.runtimeContract.schemaVersion
    || value.bundleContract.schemaId !== game.bundle.schemaId
    || value.bundleContract.schemaVersion !== game.bundle.schemaVersion) {
    throw new NativePlayerError(code, "Player session is incompatible with this game bundle");
  }
}

function validateStableSet(values: string[], allowed: Set<string>, label: string): void {
  if (duplicateValues(values).length
    || JSON.stringify(values) !== JSON.stringify([...values].sort())
    || values.some((item) => !allowed.has(item))) {
    throw new NativePlayerError("save_state_invalid", `Runtime ${label} references are invalid`);
  }
}

function mechanicKeys(game: LoadedNativeGame, category: "stat" | "relationship" | "flag" | "resource"): string[] {
  return Object.values(game.runtime.mechanics).filter((item) => item.category === category)
    .map((item) => item.key).sort();
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate];
}

function sameSorted(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function namespace(gameId: string, bundleFingerprint: string): string {
  return `${gameId}:${bundleFingerprint}`;
}

function manualNamespace(gameId: string, bundleFingerprint: string, slotId: string): string {
  return `${namespace(gameId, bundleFingerprint)}:${slotId}`;
}

function cloneUnknown<T>(value: T): T {
  return value === null || value === undefined ? value : structuredClone(value);
}

function playerSerializedBytes(value: unknown, code: NativePlayerErrorCode): number {
  try {
    return serializedBytes(value);
  } catch (error) {
    throw new NativePlayerError(code, "Player data cannot be serialized safely", error);
  }
}
