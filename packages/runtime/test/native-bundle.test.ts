import { describe, expect, it } from "vitest";
import {
  NATIVE_COMPILER_POLICY_ID,
  NATIVE_COMPILER_POLICY_VERSION,
  NATIVE_COMPILER_VERSION,
  NATIVE_GAME_BUNDLE_SCHEMA_ID,
  NATIVE_GAME_BUNDLE_SCHEMA_VERSION,
  NATIVE_RUNTIME_CONTRACT_VERSION,
  chooseNativeGameChoice,
  compiledRuntimeFingerprint,
  currentNativePassage,
  initializeNativeGame,
  listNativeGameChoices,
  loadNativeGame,
  nativeBundleFingerprint,
  nativeGameTerminal,
  type CompiledRuntime,
  type NativeGameBundle,
} from "../src/index.js";

function fixture(): NativeGameBundle {
  const mechanics = [{
    key: "resolve", category: "stat" as const, valueType: "number" as const,
    initial: 0, minimum: 0, maximum: 10,
  }];
  const passages: NativeGameBundle["passages"] = [{
    id: "passage-start", proseMarkdown: "Exact opening prose.", choiceIds: ["choice-finish"],
    terminal: false, endingId: null, routeIds: ["route-main"], requiredFactIds: [],
    revealedFactIds: ["fact-seen"], presentation: { title: "Opening" },
    source: { passageVersionId: "passage-version-1", acceptedDraftVersionId: "draft-version-1" },
  }, {
    id: "passage-end", proseMarkdown: "Exact ending prose.", choiceIds: [], terminal: true,
    endingId: "ending-main", routeIds: ["route-main"], requiredFactIds: ["fact-seen"],
    revealedFactIds: [], presentation: { title: "Ending" },
    source: { passageVersionId: "passage-version-2", acceptedDraftVersionId: "draft-version-2" },
  }];
  const choices: NativeGameBundle["choices"] = [{
    id: "choice-finish", sourcePassageId: "passage-start", destinationPassageId: "passage-end",
    text: "Finish", condition: null, routeGateConditions: [], unavailableBehavior: "disabled",
    unavailableExplanation: "", effects: [{
      id: "effect-resolve", mechanicKey: "resolve", operation: "add", value: 1,
      feedback: "Resolve rises.", visibility: "visible",
    }], sourceDecisionIds: ["decision-main"], position: 0,
    source: { choiceVersionId: "choice-version-1" },
  }];
  const endings = [{ id: "ending-main", routeId: "route-main", gateConditions: [] }];
  const runtime: CompiledRuntime = {
    schemaVersion: 1,
    simulationPolicyVersion: NATIVE_RUNTIME_CONTRACT_VERSION,
    sourceSnapshotId: "snapshot-1",
    sourceStructureVersionId: "structure-1",
    fingerprint: "0".repeat(32),
    startPassageId: "passage-start",
    mechanics: { resolve: mechanics[0]! },
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
    endings: { "ending-main": endings[0]! },
    routeIds: ["route-main"],
    decisionIds: ["decision-main"],
  };
  runtime.fingerprint = compiledRuntimeFingerprint(runtime);
  const bundle: NativeGameBundle = {
    schemaId: NATIVE_GAME_BUNDLE_SCHEMA_ID,
    schemaVersion: NATIVE_GAME_BUNDLE_SCHEMA_VERSION,
    gameId: "game-1",
    projectId: "project-1",
    source: { inputFingerprint: "a".repeat(32), snapshotId: "snapshot-1", structureVersionId: "structure-1" },
    bundleFingerprint: "0".repeat(32),
    runtimeFingerprint: runtime.fingerprint,
    compiler: {
      policyId: NATIVE_COMPILER_POLICY_ID,
      policyVersion: NATIVE_COMPILER_POLICY_VERSION,
      version: NATIVE_COMPILER_VERSION,
    },
    runtimeContract: { schemaVersion: 1, version: NATIVE_RUNTIME_CONTRACT_VERSION },
    startPassageId: "passage-start",
    initialState: {
      currentPassageId: "passage-start", stats: { resolve: 0 }, relationships: {}, flags: {},
      resources: {}, decisions: [], routes: ["route-main"], knownFacts: ["fact-seen"],
      visitCounts: { "passage-start": 1 }, turn: 0,
    },
    mechanics,
    passages,
    choices,
    endings,
    routeIds: ["route-main"],
    decisionIds: ["decision-main"],
    factIds: ["fact-seen"],
    debug: { upstreamVersions: { brief: "brief-v1" }, threadVersionIds: [] },
  };
  bundle.bundleFingerprint = nativeBundleFingerprint(bundle);
  return bundle;
}

describe("native game bundle", () => {
  it("loads and plays through only the Foundation 5A runtime dependency boundary", () => {
    const game = loadNativeGame(fixture());
    const initial = initializeNativeGame(game);
    expect(currentNativePassage(game, initial).proseMarkdown).toBe("Exact opening prose.");
    expect(listNativeGameChoices(game, initial).map((item) => ({
      id: item.choice.id, text: item.choice.text, enabled: item.availability.enabled,
    }))).toEqual([{ id: "choice-finish", text: "Finish", enabled: true }]);
    const transition = chooseNativeGameChoice(game, initial, "choice-finish");
    expect(transition.ok).toBe(true);
    if (!transition.ok) throw new Error("Expected legal transition");
    expect(transition.state).toMatchObject({
      currentPassageId: "passage-end", stats: { resolve: 1 },
      decisions: ["decision-main"], routes: ["route-main"], knownFacts: ["fact-seen"], turn: 1,
    });
    expect(nativeGameTerminal(game, transition.state).result).toEqual({
      kind: "completed-ending", passageId: "passage-end", endingId: "ending-main", eligible: true,
    });
  });

  it("keeps gameplay identity deterministic and independent of bounded source/debug provenance", () => {
    const first = fixture();
    const reordered = structuredClone(first);
    reordered.source.inputFingerprint = "b".repeat(32);
    reordered.source.snapshotId = "snapshot-2";
    reordered.debug = { upstreamVersions: { mechanics: "mechanics-v2" }, threadVersionIds: ["thread-v2"] };
    expect(nativeBundleFingerprint(reordered)).toBe(first.bundleFingerprint);
    expect(loadNativeGame(first).bundle.bundleFingerprint).toBe(loadNativeGame(structuredClone(first)).bundle.bundleFingerprint);
  });

  it.each([
    ["start passage", (bundle: Record<string, any>) => { bundle.startPassageId = "missing"; }],
    ["choice source", (bundle: Record<string, any>) => { bundle.choices[0].sourcePassageId = "missing"; }],
    ["choice destination", (bundle: Record<string, any>) => { bundle.choices[0].destinationPassageId = "missing"; }],
    ["mechanic key", (bundle: Record<string, any>) => { bundle.choices[0].effects[0].mechanicKey = "missing"; }],
    ["initial value type", (bundle: Record<string, any>) => { bundle.initialState.stats.resolve = "wrong"; }],
    ["route ID", (bundle: Record<string, any>) => { bundle.passages[0].routeIds = ["missing"]; }],
    ["ending ID", (bundle: Record<string, any>) => { bundle.passages[1].endingId = "missing"; }],
    ["passage choice list", (bundle: Record<string, any>) => { bundle.passages[0].choiceIds = []; }],
    ["duplicate passage", (bundle: Record<string, any>) => { bundle.passages.push(structuredClone(bundle.passages[0])); }],
    ["prose type", (bundle: Record<string, any>) => { bundle.passages[0].proseMarkdown = 4; }],
    ["schema version", (bundle: Record<string, any>) => { bundle.schemaVersion = 2; }],
    ["bundle fingerprint", (bundle: Record<string, any>) => { bundle.bundleFingerprint = "f".repeat(32); }],
    ["runtime fingerprint", (bundle: Record<string, any>) => { bundle.runtimeFingerprint = "e".repeat(32); }],
  ])("rejects tampered %s data as untrusted input", (_label, mutate) => {
    const tampered = structuredClone(fixture()) as unknown as Record<string, any>;
    mutate(tampered);
    expect(() => loadNativeGame(tampered)).toThrow();
  });

  it("rejects unknown author-only or executable fields under the strict allowlist", () => {
    const leaked = { ...fixture(), openRouterApiKey: "secret", repairPlan: { prose: "author only" } };
    expect(() => loadNativeGame(leaked)).toThrow();
    const scripted = structuredClone(fixture()) as NativeGameBundle & { passages: Array<Record<string, unknown>> };
    scripted.passages[0]!.script = "alert(1)";
    expect(() => loadNativeGame(scripted)).toThrow();
  });

  it("rejects oversized required prose locally without truncation", () => {
    const oversized = fixture();
    oversized.passages[0]!.proseMarkdown = "🙂".repeat(600_000);
    oversized.bundleFingerprint = nativeBundleFingerprint(oversized);
    expect(() => loadNativeGame(oversized)).toThrow("prose exceeds its byte limit");
  });
});
