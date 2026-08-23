import {
  NATIVE_COMPILER_POLICY_ID,
  NATIVE_COMPILER_POLICY_VERSION,
  NATIVE_COMPILER_VERSION,
  NATIVE_GAME_BUNDLE_SCHEMA_ID,
  NATIVE_GAME_BUNDLE_SCHEMA_VERSION,
  NATIVE_RUNTIME_CONTRACT_VERSION,
  compiledRuntimeFingerprint,
  nativeBundleFingerprint,
  type CompiledRuntime,
  type NativeGameBundle,
  type NativePlayerConfig,
} from "../src/index.js";

export function playerFixture(passageCount = 4, blockedBehavior: "hidden" | "disabled" = "hidden"): NativeGameBundle {
  if (passageCount < 2) throw new Error("Player fixture needs at least two passages");
  const mechanics: NativeGameBundle["mechanics"] = [
    { key: "resolve", category: "stat", valueType: "number", initial: 0, minimum: 0, maximum: passageCount },
    {
      key: "trust", category: "relationship", valueType: "number", initial: 0,
      minimum: 0, maximum: passageCount, bands: [{ minimum: 0, label: "Wary" }, { minimum: 2, label: "Trusted" }],
    },
    { key: "supplies", category: "resource", valueType: "number", initial: passageCount, minimum: 0, maximum: passageCount },
    { key: "secret", category: "flag", valueType: "boolean", initial: false },
  ];
  const passages: NativeGameBundle["passages"] = Array.from({ length: passageCount }, (_, index) => ({
    id: `passage-${index}`,
    proseMarkdown: index === passageCount - 1 ? "Exact final prose.\n\nThe end." : `Exact prose ${index}.`,
    choiceIds: index === passageCount - 1 ? [] : [
      `choice-${index}`,
      ...(index === 0 && passageCount >= 3 ? ["choice-blocked"] : []),
      ...(index === 1 && passageCount >= 4 ? ["choice-alternate"] : []),
    ],
    terminal: index === passageCount - 1,
    endingId: index === passageCount - 1 ? "ending-main" : null,
    routeIds: ["route-main"], requiredFactIds: [], revealedFactIds: [],
    presentation: { title: index === passageCount - 1 ? "Ending" : `Passage ${index}` },
    source: { passageVersionId: `passage-version-${index}`, acceptedDraftVersionId: `draft-version-${index}` },
  }));
  const choices: NativeGameBundle["choices"] = Array.from({ length: passageCount - 1 }, (_, index) => ({
    id: `choice-${index}`, sourcePassageId: `passage-${index}`, destinationPassageId: `passage-${index + 1}`,
    text: `Continue ${index + 1}`, condition: null, routeGateConditions: [],
    unavailableBehavior: "disabled", unavailableExplanation: "",
    effects: [
      { id: `resolve-${index}`, mechanicKey: "resolve", operation: "add", value: 1, feedback: "Resolve rises.", visibility: "visible" },
      { id: `trust-${index}`, mechanicKey: "trust", operation: "add", value: 1, feedback: "Trust rises.", visibility: "visible" },
      { id: `supplies-${index}`, mechanicKey: "supplies", operation: "subtract", value: 1, feedback: "A supply is used.", visibility: "visible" },
      { id: `secret-${index}`, mechanicKey: "secret", operation: "set", value: true, feedback: "", visibility: "hidden" },
    ],
    sourceDecisionIds: [`decision-${index}`], position: 0,
    source: { choiceVersionId: `choice-version-${index}` },
  }));
  if (passageCount >= 3) choices.push({
    id: "choice-blocked", sourcePassageId: "passage-0", destinationPassageId: "passage-2",
    text: "Unavailable shortcut",
    condition: { kind: "visit-count", passageId: "passage-2", operator: "gte", value: 1 },
    routeGateConditions: [], unavailableBehavior: blockedBehavior, unavailableExplanation: "Not yet available.",
    effects: [], sourceDecisionIds: ["decision-blocked"], position: 1,
    source: { choiceVersionId: "choice-version-blocked" },
  });
  if (passageCount >= 4) choices.push({
    id: "choice-alternate", sourcePassageId: "passage-1", destinationPassageId: `passage-${passageCount - 1}`,
    text: "Take the alternate ending", condition: null, routeGateConditions: [],
    unavailableBehavior: "disabled", unavailableExplanation: "", effects: [],
    sourceDecisionIds: ["decision-alternate"], position: 1,
    source: { choiceVersionId: "choice-version-alternate" },
  });
  const endings: NativeGameBundle["endings"] = [{ id: "ending-main", routeId: "route-main", gateConditions: [] }];
  const runtime: CompiledRuntime = {
    schemaVersion: 1, simulationPolicyVersion: NATIVE_RUNTIME_CONTRACT_VERSION,
    sourceSnapshotId: "snapshot-1", sourceStructureVersionId: "structure-1", fingerprint: "0".repeat(32),
    startPassageId: "passage-0", mechanics: Object.fromEntries(mechanics.map((item) => [item.key, item])),
    passages: Object.fromEntries(passages.map((item) => [item.id, {
      id: item.id, choiceIds: item.choiceIds, terminal: item.terminal, endingId: item.endingId,
      routeIds: item.routeIds, requiredFactIds: item.requiredFactIds, revealedFactIds: item.revealedFactIds,
    }])),
    choices: Object.fromEntries(choices.map((item) => [item.id, {
      id: item.id, sourcePassageId: item.sourcePassageId, destinationPassageId: item.destinationPassageId,
      condition: item.condition, routeGateConditions: item.routeGateConditions,
      unavailableBehavior: item.unavailableBehavior, unavailableExplanation: item.unavailableExplanation,
      effects: item.effects, sourceDecisionIds: item.sourceDecisionIds, position: item.position,
    }])),
    endings: { "ending-main": endings[0]! }, routeIds: ["route-main"],
    decisionIds: choices.flatMap((item) => item.sourceDecisionIds),
  };
  runtime.fingerprint = compiledRuntimeFingerprint(runtime);
  const bundle: NativeGameBundle = {
    schemaId: NATIVE_GAME_BUNDLE_SCHEMA_ID, schemaVersion: NATIVE_GAME_BUNDLE_SCHEMA_VERSION,
    gameId: "game-player", projectId: "project-player",
    source: { inputFingerprint: "a".repeat(32), snapshotId: "snapshot-1", structureVersionId: "structure-1" },
    bundleFingerprint: "0".repeat(32), runtimeFingerprint: runtime.fingerprint,
    compiler: { policyId: NATIVE_COMPILER_POLICY_ID, policyVersion: NATIVE_COMPILER_POLICY_VERSION, version: NATIVE_COMPILER_VERSION },
    runtimeContract: { schemaVersion: 1, version: NATIVE_RUNTIME_CONTRACT_VERSION },
    startPassageId: "passage-0",
    initialState: {
      currentPassageId: "passage-0", stats: { resolve: 0 }, relationships: { trust: 0 },
      flags: { secret: false }, resources: { supplies: passageCount }, decisions: [], routes: ["route-main"],
      knownFacts: [], visitCounts: { "passage-0": 1 }, turn: 0,
    },
    mechanics, passages, choices, endings, routeIds: ["route-main"],
    decisionIds: choices.flatMap((item) => item.sourceDecisionIds), factIds: [],
    debug: { upstreamVersions: { brief: "brief-v1" }, threadVersionIds: [] },
  };
  bundle.bundleFingerprint = nativeBundleFingerprint(bundle);
  return bundle;
}

export function playerConfigInput(bundle: NativeGameBundle): Omit<NativePlayerConfig, "configFingerprint"> {
  return {
    schemaId: "cyoa.native-player-config", schemaVersion: 1, gameId: bundle.gameId,
    rewindPolicy: { kind: "previous-step" }, autosaveEnabled: true, manualSlotLimit: 20,
    visibleMechanics: [
      { key: "resolve", category: "stat", label: "Resolve" },
      { key: "supplies", category: "resource", label: "Supplies" },
      { key: "trust", category: "relationship", label: "Trust" },
    ],
  };
}
