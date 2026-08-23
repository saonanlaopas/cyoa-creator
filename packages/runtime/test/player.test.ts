import { describe, expect, it } from "vitest";
import {
  MemoryNativePlayerStorage,
  NATIVE_PLAYER_LIMITS,
  NativePlayerError,
  assertNativePlayerManualSlot,
  assertNativePlayerSession,
  canRewindNativePlayerSession,
  chooseNativePlayerSession,
  createNativePlayerConfig,
  createNativePlayerInstallation,
  createNativePlayerManualSlot,
  createNativePlayerSave,
  createNativePlayerSession,
  loadNativePlayerSave,
  nativePlayerSaveCompatibility,
  nativePlayerView,
  restartNativePlayerSession,
  rewindNativePlayerSession,
  stableFingerprint,
  type NativeGameBundle,
  type NativePlayerConfig,
  type NativePlayerSave,
  type NativePlayerSession,
} from "../src/index.js";
import { playerConfigInput, playerFixture } from "./native-player-fixture.js";

function setup(passageCount = 4, policy?: NativePlayerConfig["rewindPolicy"]) {
  const bundle = playerFixture(passageCount);
  const base = playerConfigInput(bundle);
  const config = createNativePlayerConfig({ ...base, ...(policy ? { rewindPolicy: policy } : {}) }, bundle);
  return { bundle, config, session: createNativePlayerSession(bundle, config) };
}

function reseal(save: NativePlayerSave): NativePlayerSave {
  const { saveFingerprint: _fingerprint, metadata: _metadata, ...identity } = save;
  return { ...save, saveFingerprint: stableFingerprint(identity) };
}

function resealSession(session: NativePlayerSession): NativePlayerSession {
  const { sessionFingerprint: _fingerprint, ...identity } = session;
  return { ...session, sessionFingerprint: stableFingerprint(identity) };
}

function errorCode(action: () => unknown): string | undefined {
  try { action(); } catch (error) { return error instanceof NativePlayerError ? error.code : undefined; }
  return undefined;
}

describe("native player session", () => {
  it("renders only configured visible mechanics and advances through the exact runtime choice boundary", () => {
    const { bundle, config, session } = setup();
    const view = nativePlayerView(bundle, config, session);
    expect(view.passage.proseMarkdown).toBe("Exact prose 0.");
    expect(view.choices.map((item) => item.choice.id)).toEqual(["choice-0"]);
    expect(view.visibleState.map((item) => [item.key, item.value])).toEqual([
      ["resolve", 0], ["supplies", 4], ["trust", 0],
    ]);
    expect(view.visibleState.some((item) => item.key === "secret")).toBe(false);

    const transition = chooseNativePlayerSession(bundle, config, session, "choice-0");
    expect(transition.session.state).toMatchObject({
      currentPassageId: "passage-1", stats: { resolve: 1 }, relationships: { trust: 1 },
      resources: { supplies: 3 }, flags: { secret: true }, turn: 1,
    });
    expect(transition.stateDelta.length).toBeGreaterThan(0);
  });

  it.each(["unknown", "choice-2", "choice-blocked"])("rejects forged, wrong-passage, or unavailable choice %s without mutating the session", (choiceId) => {
    const { bundle, config, session } = setup();
    const before = structuredClone(session);
    expect(errorCode(() => chooseNativePlayerSession(bundle, config, session, choiceId))).toBe("player_choice_rejected");
    expect(session).toEqual(before);
  });

  it("preserves terminal state through exact save/load and restart", () => {
    const { bundle, config } = setup(3);
    let session = createNativePlayerSession(bundle, config);
    session = chooseNativePlayerSession(bundle, config, session, "choice-0").session;
    session = chooseNativePlayerSession(bundle, config, session, "choice-1").session;
    expect(nativePlayerView(bundle, config, session).terminal.result).toMatchObject({ kind: "completed-ending" });
    expect(nativePlayerView(bundle, config, session).choices).toEqual([]);
    expect(loadNativePlayerSave(bundle, config, createNativePlayerSave(bundle, config, session)).state).toEqual(session.state);
    expect(restartNativePlayerSession(bundle, config).state.currentPassageId).toBe("passage-0");
  });

  it.each([
    ["disabled", { kind: "disabled" } as const, 0, "player_rewind_unavailable"],
    ["previous", { kind: "previous-step" } as const, 1, null],
    ["last two", { kind: "bounded-last-n", steps: 2 } as const, 2, null],
    ["designated", { kind: "designated-checkpoints", passageIds: ["passage-1", "passage-2"], maximumCheckpoints: 2 } as const, 2, null],
  ])("enforces %s rewind policy", (_label, policy, expectedHistory, expectedError) => {
    const { bundle, config } = setup(4, policy);
    let session = createNativePlayerSession(bundle, config);
    session = chooseNativePlayerSession(bundle, config, session, "choice-0").session;
    session = chooseNativePlayerSession(bundle, config, session, "choice-1").session;
    session = chooseNativePlayerSession(bundle, config, session, "choice-2").session;
    expect(session.history).toHaveLength(expectedHistory);
    if (expectedError) expect(errorCode(() => rewindNativePlayerSession(bundle, config, session))).toBe(expectedError);
    else expect(rewindNativePlayerSession(bundle, config, session).state.currentPassageId).toBe("passage-2");
  });

  it("validates designated checkpoint IDs and duplicate visible mechanics against the bundle", () => {
    const bundle = playerFixture();
    expect(() => createNativePlayerConfig({ gameId: bundle.gameId, rewindPolicy: {
      kind: "designated-checkpoints", passageIds: ["missing"], maximumCheckpoints: 1,
    } }, bundle)).toThrow("does not exist");
    expect(() => createNativePlayerConfig({ gameId: bundle.gameId, visibleMechanics: [
      { key: "resolve", category: "stat", label: "Resolve" },
      { key: "resolve", category: "stat", label: "Again" },
    ] }, bundle)).toThrow("duplicate");
  });

  it("discards the old future after previous-step rewind and follows a deterministic alternate branch", () => {
    const { bundle, config } = setup(4, { kind: "previous-step" });
    let session = createNativePlayerSession(bundle, config);
    session = chooseNativePlayerSession(bundle, config, session, "choice-0").session;
    session = chooseNativePlayerSession(bundle, config, session, "choice-1").session;
    expect(session.state.currentPassageId).toBe("passage-2");
    session = rewindNativePlayerSession(bundle, config, session);
    expect(session.state.currentPassageId).toBe("passage-1");
    session = chooseNativePlayerSession(bundle, config, session, "choice-alternate").session;
    expect(session.state.currentPassageId).toBe("passage-3");
    expect(session.history).toHaveLength(1);
    expect(session.history[0]!.state.currentPassageId).toBe("passage-1");
  });

  it("rejects resealed session history that is noncanonical for the current policy", () => {
    const { bundle } = setup(5);
    const lastThree = createNativePlayerConfig({
      ...playerConfigInput(bundle), rewindPolicy: { kind: "bounded-last-n", steps: 3 },
    }, bundle);
    let source = createNativePlayerSession(bundle, lastThree);
    source = chooseNativePlayerSession(bundle, lastThree, source, "choice-0").session;
    source = chooseNativePlayerSession(bundle, lastThree, source, "choice-1").session;
    source = chooseNativePlayerSession(bundle, lastThree, source, "choice-2").session;
    expect(source.history).toHaveLength(3);

    const rejectedFor = (config: NativePlayerConfig, history: NativePlayerSession["history"]) => {
      const forged = resealSession({
        ...source,
        playerConfigFingerprint: config.configFingerprint,
        history: structuredClone(history),
      });
      expect(errorCode(() => assertNativePlayerSession(bundle, config, forged))).toBe("player_session_invalid");
      expect(errorCode(() => createNativePlayerSave(bundle, config, forged))).toBe("player_session_invalid");
    };

    rejectedFor(createNativePlayerConfig({
      ...playerConfigInput(bundle), rewindPolicy: { kind: "disabled" },
    }, bundle), source.history.slice(-1));
    rejectedFor(createNativePlayerConfig({
      ...playerConfigInput(bundle), rewindPolicy: { kind: "previous-step" },
    }, bundle), source.history.slice(-2));
    rejectedFor(createNativePlayerConfig({
      ...playerConfigInput(bundle), rewindPolicy: { kind: "bounded-last-n", steps: 2 },
    }, bundle), source.history);

    const designated = createNativePlayerConfig({
      ...playerConfigInput(bundle),
      rewindPolicy: { kind: "designated-checkpoints", passageIds: ["passage-1"], maximumCheckpoints: 2 },
    }, bundle);
    rejectedFor(designated, source.history.slice(0, 1));
    const wrongReason = structuredClone(source.history[1]!);
    wrongReason.reason = "transition";
    wrongReason.originatingChoiceId = "choice-1";
    rejectedFor(designated, [wrongReason]);

    expect(assertNativePlayerSession(bundle, lastThree, source)).toEqual(source);
  });

  it("derives rewind availability from the exact pure-session semantics", () => {
    const bundle = playerFixture(4);
    const disabled = createNativePlayerConfig({
      ...playerConfigInput(bundle), rewindPolicy: { kind: "disabled" },
    }, bundle);
    expect(canRewindNativePlayerSession(bundle, disabled, createNativePlayerSession(bundle, disabled))).toBe(false);

    const previous = createNativePlayerConfig({
      ...playerConfigInput(bundle), rewindPolicy: { kind: "previous-step" },
    }, bundle);
    let previousSession = createNativePlayerSession(bundle, previous);
    expect(canRewindNativePlayerSession(bundle, previous, previousSession)).toBe(false);
    previousSession = chooseNativePlayerSession(bundle, previous, previousSession, "choice-0").session;
    expect(canRewindNativePlayerSession(bundle, previous, previousSession)).toBe(true);

    const designated = createNativePlayerConfig({
      ...playerConfigInput(bundle), rewindPolicy: {
        kind: "designated-checkpoints", passageIds: ["passage-1", "passage-2"], maximumCheckpoints: 2,
      },
    }, bundle);
    let designatedSession = createNativePlayerSession(bundle, designated);
    designatedSession = chooseNativePlayerSession(bundle, designated, designatedSession, "choice-0").session;
    expect(designatedSession.history).toHaveLength(1);
    expect(canRewindNativePlayerSession(bundle, designated, designatedSession)).toBe(false);
    designatedSession = chooseNativePlayerSession(bundle, designated, designatedSession, "choice-1").session;
    expect(canRewindNativePlayerSession(bundle, designated, designatedSession)).toBe(true);

    previousSession = chooseNativePlayerSession(bundle, previous, previousSession, "choice-1").session;
    previousSession = chooseNativePlayerSession(bundle, previous, previousSession, "choice-2").session;
    expect(nativePlayerView(bundle, previous, previousSession).terminal.result).not.toBeNull();
    expect(canRewindNativePlayerSession(bundle, previous, previousSession)).toBe(true);

    const malformed = resealSession({ ...previousSession, history: [] });
    malformed.history = structuredClone(previousSession.history);
    malformed.history[0]!.stateFingerprint = "f".repeat(32);
    const resealedMalformed = resealSession(malformed);
    expect(errorCode(() => canRewindNativePlayerSession(bundle, previous, resealedMalformed)))
      .toBe("player_session_invalid");
  });
});

describe("native player saves", () => {
  it("treats gameplay fingerprint as compatibility identity and source fingerprint as provenance", () => {
    const { bundle, config, session } = setup();
    const progressed = chooseNativePlayerSession(bundle, config, session, "choice-0").session;
    const save = createNativePlayerSave(bundle, config, progressed);
    const provenanceOnly = structuredClone(bundle);
    provenanceOnly.source.inputFingerprint = "b".repeat(32);
    const recompiledConfig = createNativePlayerConfig(playerConfigInput(provenanceOnly), provenanceOnly);
    const loaded = loadNativePlayerSave(provenanceOnly, recompiledConfig, save);
    expect(loaded.state).toEqual(progressed.state);
    expect(loaded.sourceInputFingerprint).toBe("b".repeat(32));
  });

  it.each([
    ["schema", (save: any) => { save.schemaVersion = 2; }, "save_schema_unsupported"],
    ["game", (save: any) => { save.gameId = "another-game"; }, "save_game_mismatch"],
    ["bundle", (save: any) => { save.bundleFingerprint = "b".repeat(32); }, "save_bundle_incompatible"],
    ["runtime", (save: any) => { save.runtimeContract.version = "future-runtime"; }, "save_runtime_incompatible"],
    ["runtime schema", (save: any) => { save.runtimeContract.schemaVersion = 2; }, "save_runtime_incompatible"],
    ["bundle schema", (save: any) => { save.bundleContract.schemaVersion = 2; }, "save_bundle_schema_incompatible"],
    ["bundle schema id", (save: any) => { save.bundleContract.schemaId = "future-bundle"; }, "save_bundle_schema_incompatible"],
    ["fingerprint", (save: any) => { save.saveFingerprint = "f".repeat(32); }, "save_fingerprint_invalid"],
  ])("normalizes %s incompatibility", (_label, mutate, expected) => {
    const { bundle, config, session } = setup();
    let save = structuredClone(createNativePlayerSave(bundle, config, session));
    mutate(save);
    if (!['schema', 'fingerprint'].includes(_label)) save = reseal(save);
    expect(errorCode(() => loadNativePlayerSave(bundle, config, save))).toBe(expected);
  });

  it.each([
    ["unknown state field", (save: any) => { save.state.injected = true; }],
    ["missing mechanic", (save: any) => { delete save.state.stats.resolve; }],
    ["extra mechanic", (save: any) => { save.state.stats.extra = 1; }],
    ["wrong mechanic type", (save: any) => { save.state.stats.resolve = "bad"; }],
    ["out-of-range mechanic", (save: any) => { save.state.stats.resolve = 99; }],
    ["unknown passage", (save: any) => { save.state.currentPassageId = "missing"; }],
    ["unknown route", (save: any) => { save.state.routes = ["missing"]; }],
    ["unknown decision", (save: any) => { save.state.decisions = ["missing"]; }],
    ["unknown fact", (save: any) => { save.state.knownFacts = ["missing"]; }],
    ["unknown visit passage", (save: any) => { save.state.visitCounts.missing = 0; }],
    ["relationship type", (save: any) => { save.state.relationships.trust = "bad"; }],
    ["relationship range", (save: any) => { save.state.relationships.trust = 99; }],
    ["resource type", (save: any) => { save.state.resources.supplies = "bad"; }],
    ["resource range", (save: any) => { save.state.resources.supplies = -1; }],
    ["NaN mechanic", (save: any) => { save.state.stats.resolve = Number.NaN; }],
    ["infinite mechanic", (save: any) => { save.state.stats.resolve = Number.POSITIVE_INFINITY; }],
    ["bad visit lineage", (save: any) => { save.state.visitCounts["passage-0"] = 2; }],
    ["bad turn", (save: any) => { save.state.turn = 1; }],
    ["negative turn", (save: any) => { save.state.turn = -1; }],
    ["sequence mismatch", (save: any) => { save.sequence = 1; }],
  ])("rejects resealed state tampering: %s", (_label, mutate) => {
    const { bundle, config, session } = setup();
    const save = structuredClone(createNativePlayerSave(bundle, config, session));
    mutate(save);
    expect(errorCode(() => loadNativePlayerSave(bundle, config, reseal(save)))).toBe("save_state_invalid");
  });

  it("rejects malformed history independently and leaves the active session unchanged", () => {
    const { bundle, config, session } = setup();
    const progressed = chooseNativePlayerSession(bundle, config, session, "choice-0").session;
    const activeBefore = structuredClone(progressed);
    const save = structuredClone(createNativePlayerSave(bundle, config, progressed));
    save.history[0]!.stateFingerprint = "f".repeat(32);
    expect(errorCode(() => loadNativePlayerSave(bundle, config, reseal(save)))).toBe("save_history_invalid");
    expect(progressed).toEqual(activeBefore);
  });

  it("enforces save and history ceilings before accepting untrusted payloads", () => {
    const { bundle, config, session } = setup();
    const save = createNativePlayerSave(bundle, config, session);
    const oversized = { ...save, injected: "x".repeat(NATIVE_PLAYER_LIMITS.maximumSaveBytes + 1) };
    expect(errorCode(() => loadNativePlayerSave(bundle, config, oversized))).toBe("save_too_large");
    const tooMuchHistory = structuredClone(save) as any;
    tooMuchHistory.history = Array.from({ length: NATIVE_PLAYER_LIMITS.maximumHistoryEntries + 1 }, () => ({
      sequence: 0, passageId: "passage-0", reason: "transition", originatingChoiceId: null,
      state: session.state, stateFingerprint: stableFingerprint(session.state),
    }));
    expect(errorCode(() => loadNativePlayerSave(bundle, config, reseal(tooMuchHistory)))).toBe("save_history_invalid");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(errorCode(() => loadNativePlayerSave(bundle, config, cyclic))).toBe("save_state_invalid");
  });

  it("reports compatibility without treating a changed source fingerprint as incompatible", () => {
    const { bundle, config, session } = setup();
    const save = createNativePlayerSave(bundle, config, session);
    expect(nativePlayerSaveCompatibility(bundle, save)).toEqual({ compatible: true, code: null });
    const anotherBundle = playerFixture(5);
    expect(nativePlayerSaveCompatibility(anotherBundle, save)).toEqual({ compatible: false, code: "save_bundle_incompatible" });
  });

  it("loads the same gameplay save under current player policy and deterministically trims history", () => {
    const { bundle, config } = setup(5, { kind: "bounded-last-n", steps: 3 });
    let session = createNativePlayerSession(bundle, config);
    session = chooseNativePlayerSession(bundle, config, session, "choice-0").session;
    session = chooseNativePlayerSession(bundle, config, session, "choice-1").session;
    session = chooseNativePlayerSession(bundle, config, session, "choice-2").session;
    const save = createNativePlayerSave(bundle, config, session);
    const previous = createNativePlayerConfig({ ...playerConfigInput(bundle), rewindPolicy: { kind: "previous-step" } }, bundle);
    const previousLoaded = loadNativePlayerSave(bundle, previous, save);
    expect(previousLoaded.history).toHaveLength(1);
    expect(previousLoaded.playerConfigFingerprint).toBe(previous.configFingerprint);
    expect(assertNativePlayerSession(bundle, previous, previousLoaded)).toEqual(previousLoaded);
    const disabled = createNativePlayerConfig({ ...playerConfigInput(bundle), rewindPolicy: { kind: "disabled" } }, bundle);
    expect(loadNativePlayerSave(bundle, disabled, save).history).toEqual([]);
  });
});

describe("native player storage and scale", () => {
  it("round-trips an installation, autosave, and exact manual slot in memory", async () => {
    const { bundle, config, session } = setup();
    const storage = new MemoryNativePlayerStorage();
    const installation = createNativePlayerInstallation(bundle, config, true);
    await storage.install(installation);
    expect(await storage.readInstallation(bundle.gameId, bundle.bundleFingerprint)).toEqual(installation);
    const save = createNativePlayerSave(bundle, config, session);
    await storage.writeAutosave(bundle.gameId, bundle.bundleFingerprint, save);
    expect(await storage.readAutosave(bundle.gameId, bundle.bundleFingerprint)).toEqual(save);
    const slot = createNativePlayerManualSlot(bundle, config, session, "slot-1", "Before the gate", "2026-08-23T00:00:00.000Z");
    await storage.writeManualSlot(slot);
    expect(assertNativePlayerManualSlot((await storage.listManualSlots(bundle.gameId))[0])).toEqual(slot);
    await storage.deleteManualSlot(bundle.gameId, "slot-1", bundle.bundleFingerprint);
    expect(await storage.listManualSlots(bundle.gameId)).toEqual([]);
  });

  it("enforces the domain manual-slot ceiling without leaving a partial slot", async () => {
    const { bundle, config, session } = setup();
    const storage = new MemoryNativePlayerStorage();
    for (let index = 0; index < NATIVE_PLAYER_LIMITS.maximumManualSlots; index += 1) {
      await storage.writeManualSlot(createNativePlayerManualSlot(
        bundle, config, session, `slot-${index}`, `Slot ${index}`, `2026-08-23T00:00:${String(index).padStart(2, "0")}.000Z`,
      ));
    }
    await expect(storage.writeManualSlot(createNativePlayerManualSlot(
      bundle, config, session, "slot-overflow", "Overflow", "2026-08-23T00:01:00.000Z",
    ))).rejects.toMatchObject({ code: "storage_quota_exceeded" });
    expect(await storage.listManualSlots(bundle.gameId)).toHaveLength(NATIVE_PLAYER_LIMITS.maximumManualSlots);
  });

  it("loads a 300-passage bundle while exposing only the current passage in its player view", () => {
    const { bundle, config } = setup(300, { kind: "bounded-last-n", steps: 10 });
    let session: NativePlayerSession = createNativePlayerSession(bundle, config);
    const view = nativePlayerView(bundle, config, session);
    expect(bundle.passages).toHaveLength(300);
    expect(view.passage.id).toBe("passage-0");
    expect(view.choices).toHaveLength(1);
    session = chooseNativePlayerSession(bundle, config, session, "choice-0").session;
    expect(session.state.currentPassageId).toBe("passage-1");
    expect(session.history.length).toBeLessThanOrEqual(10);
    expect(NATIVE_PLAYER_LIMITS.maximumHistoryEntries).toBe(200);
  });
});
