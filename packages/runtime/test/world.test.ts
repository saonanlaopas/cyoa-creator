import { describe, expect, it } from "vitest";
import { actNativePlayerWorld, chooseNativePlayerSession, createNativePlayerConfig, createNativePlayerSave, createNativePlayerSession, loadNativePlayerSave,
  nativeBundleFingerprint, nativePlayerView, rewindNativePlayerSession, restartNativePlayerSession, stableFingerprint, validateNativeGameBundle, worldClock, worldLocationOpen, type NativeWorld } from "../src/index.js";
import { playerFixture } from "./native-player-fixture.js";

function fixture() {
  const bundle = playerFixture(5);
  const world: NativeWorld = { schemaId: "cyoa.native-world", schemaVersion: 1, startLocationId: "home", initialMinutes: 1430, waitMinutes: [15, 60, 1440],
    locations: [
      { id: "town", name: "Town", parentId: null, passageId: null, mapImage: null, marker: null, hours: null },
      ...["home", "cafe", "station"].map((id, i) => ({ id, name: id, parentId: "town", passageId: `passage-${i}`, mapImage: null, marker: { x: i * 50, y: 50 }, hours: id === "cafe" ? { opens: 1320, closes: 120 } : null })),
    ], connections: [{ id: "to-cafe", from: "home", to: "cafe", minutes: 15 }, { id: "to-station", from: "cafe", to: "station", minutes: 10 }, { id: "to-home", from: "station", to: "home", minutes: 20 }],
    actions: [{ id: "board", locationId: "station", label: "Read board", minutes: 5, result: "Train at dawn." }], assets: [],
  };
  bundle.world = world; bundle.initialState.world = { schemaVersion: 1, locationId: "home", minutes: 1430 }; bundle.bundleFingerprint = nativeBundleFingerprint(bundle);
  const config = createNativePlayerConfig({ gameId: bundle.gameId, rewindPolicy: { kind: "bounded-last-n", steps: 20 } }, bundle);
  const initial = createNativePlayerSession(bundle, config);
  const act = (session: typeof initial, command: Parameters<typeof actNativePlayerWorld>[3]) => actNativePlayerWorld(bundle, config, session, command).session;
  return { bundle, config, initial, act };
}
describe("W1 deterministic world runtime", () => {
  it("travels home/cafe/station across midnight, saves/reloads, acts, waits, rewinds and restarts with exact state", () => {
    const f = fixture(), before = structuredClone(f.initial);
    let session = f.act(f.initial, { kind: "travel", id: "to-cafe" });
    expect(session.state.world).toEqual({ schemaVersion: 1, locationId: "cafe", minutes: 1445 });
    expect(worldClock(1445)).toBe("Day 2 · 00:05");
    const saved = createNativePlayerSave(f.bundle, f.config, session);
    session = loadNativePlayerSave(f.bundle, f.config, saved);
    session = f.act(session, { kind: "travel", id: "to-station" });
    session = f.act(session, { kind: "action", id: "board" });
    expect(session.state.world?.minutes).toBe(1460);
    expect(session.state.turn).toBe(3);
    expect(session.state.visitCounts["passage-2"]).toBe(1);
    session = f.act(session, { kind: "wait", minutes: 1440 });
    expect(session.state.world?.minutes).toBe(2900);
    expect(session.state.visitCounts["passage-2"]).toBe(1);
    session = rewindNativePlayerSession(f.bundle, f.config, session);
    expect(session.state.world?.minutes).toBe(1460);
    expect(restartNativePlayerSession(f.bundle, f.config).state).toEqual(before.state);
    expect(f.initial).toEqual(before);
    expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, session)).state).toEqual(session.state);
  });
  it("reads freely, retains existing choice effects and moves mapped locations without charging implicit reading time", () => {
    const f = fixture(); const copy = structuredClone(f.initial);
    for (let i = 0; i < 20; i++) nativePlayerView(f.bundle, f.config, f.initial);
    expect(f.initial).toEqual(copy);
    const next = chooseNativePlayerSession(f.bundle, f.config, f.initial, "choice-0").session;
    expect(next.state.world).toEqual({ schemaVersion: 1, locationId: "cafe", minutes: 1430 });
    expect(next.state.stats.resolve).toBe(1);
  });
  it.each([1319, 1320, 1439, 1440, 1559, 1560])("evaluates overnight hours at %i", (minute) => {
    expect(worldLocationOpen(fixture().bundle.world!, "cafe", minute)).toBe(minute >= 1320 && minute < 1560);
  });
  it("evaluates closing at arrival and inherited area hours, preserving state on failure", () => {
    const f = fixture(); f.bundle.world!.initialMinutes = 1545; f.bundle.initialState.world!.minutes = 1545;
    f.bundle.bundleFingerprint = nativeBundleFingerprint(f.bundle);
    const session = createNativePlayerSession(f.bundle, f.config), copy = structuredClone(session);
    expect(() => f.act(session, { kind: "travel", id: "to-cafe" })).toThrow("closed_at_arrival");
    expect(session).toEqual(copy);
    f.bundle.world!.locations[0]!.hours = { opens: 480, closes: 1200 };
    expect(worldLocationOpen(f.bundle.world!, "cafe", 1430)).toBe(false);
    f.bundle.world!.locations[0]!.hours = { opens: 0, closes: 1439 };
    expect(worldLocationOpen(f.bundle.world!, "home", 500)).toBe(true);
  });
  it.each([{ kind: "travel", id: "to-station" }, { kind: "action", id: "board" }, { kind: "wait", minutes: 14 }, { kind: "wait", minutes: -1 }, { kind: "wait", minutes: 1.5 } ] as const)("rejects unavailable command %j atomically", (command) => {
    const f = fixture(), copy = structuredClone(f.initial);
    expect(() => f.act(f.initial, command)).toThrow(); expect(f.initial).toEqual(copy);
  });
  it("bounds time without overflow and permits the authored zero-cost action", () => {
    const f = fixture(); f.bundle.world!.initialMinutes = 52_560_000; f.bundle.initialState.world!.minutes = 52_560_000;
    f.bundle.world!.actions.push({ id: "look", locationId: "home", label: "Look", minutes: 0, result: "A quiet room." });
    f.bundle.bundleFingerprint = nativeBundleFingerprint(f.bundle);
    const session = createNativePlayerSession(f.bundle, f.config);
    expect(() => f.act(session, { kind: "wait", minutes: 15 })).toThrow("time_limit");
    expect(f.act(session, { kind: "action", id: "look" }).state.world?.minutes).toBe(52_560_000);
  });
  it.each(["fractional-time", "unknown-location", "location-passage", "missing-world", "old-time"])("rejects resealed %s saves", (attack) => {
    const f = fixture(), save = createNativePlayerSave(f.bundle, f.config, f.initial);
    if (attack === "fractional-time") save.state.world!.minutes = 1430.5;
    if (attack === "unknown-location") save.state.world!.locationId = "missing";
    if (attack === "location-passage") save.state.world!.locationId = "station";
    if (attack === "missing-world") delete save.state.world;
    if (attack === "old-time") save.state.world!.minutes = 1429;
    const { saveFingerprint: _fp, ...identity } = save; save.saveFingerprint = stableFingerprint(identity);
    expect(() => loadNativePlayerSave(f.bundle, f.config, save)).toThrow();
  });
  it.each(["cycle", "missing-endpoint", "duplicate-passage", "wrong-start", "missing-passage", "bad-duration", "bad-version", "orphan-map"])("rejects malformed native %s", (attack) => {
    const f = fixture(), world = f.bundle.world!;
    if (attack === "cycle") world.locations[0]!.parentId = "home";
    if (attack === "missing-endpoint") world.connections[0]!.to = "missing";
    if (attack === "duplicate-passage") world.locations[2]!.passageId = "passage-0";
    if (attack === "wrong-start") world.startLocationId = "cafe";
    if (attack === "missing-passage") world.locations[3]!.passageId = "missing";
    if (attack === "bad-duration") world.connections[0]!.minutes = -1;
    if (attack === "bad-version") (world as any).schemaVersion = 2;
    if (attack === "orphan-map") world.locations[0]!.mapImage = "missing";
    f.bundle.bundleFingerprint = nativeBundleFingerprint(f.bundle);
    expect(() => validateNativeGameBundle(f.bundle)).toThrow();
  });
  it("retains text-game/save support and refuses world-state injection into a text save", () => {
    const bundle = playerFixture(), config = createNativePlayerConfig({ gameId: bundle.gameId }, bundle);
    const session = createNativePlayerSession(bundle, config), save = createNativePlayerSave(bundle, config, session);
    expect(loadNativePlayerSave(bundle, config, save).state).not.toHaveProperty("world");
    save.state.world = { schemaVersion: 1, locationId: "home", minutes: 0 };
    const { saveFingerprint: _fp, ...identity } = save; save.saveFingerprint = stableFingerprint(identity);
    expect(() => loadNativePlayerSave(bundle, config, save)).toThrow();
  });
});
