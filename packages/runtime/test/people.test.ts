import { describe, expect, it } from "vitest";
import { NativeWorldSchema, peopleDiagnostics, peopleTimeBoundaries, assertPeopleState, characterLocation, createNativePlayerSave, loadNativePlayerSave, mandatoryEventStatus, nativeBundleFingerprint, presentCharacters,
  previewChapterTransition, progressionEventAvailability, rewindNativePlayerSession, restartNativePlayerSession, chooseNativePlayerSession, chooseNativeGameChoice, evaluateNativeGameChoice, loadNativeGame, transitionWorld, stableFingerprint, validateNativeGameBundle } from "../src/index.js";
import { peopleFixture } from "./people-fixture.js";
import { progressionFixture } from "./progression-fixture.js";

describe("W3 authored people and deterministic encounter boundaries", () => {
  it("preserves known-choice lookup outside the current passage and gates current required-world choices", () => {
    const old = progressionFixture(), view = evaluateNativeGameChoice(loadNativeGame(old.bundle), old.initial.state, "choice-1");
    expect(view.choice.id).toBe("choice-1"); expect(view.availability.enabled).toBe(true);
    const f = peopleFixture(), pending = f.act(f.initial, { kind: "wait", minutes: 60 });
    expect(evaluateNativeGameChoice(loadNativeGame(f.bundle), pending.state, "choice-0").availability.enabled).toBe(false);
  });
  it("keeps future schedules out of player projections and discovers people/encounters only at their actual location", () => {
    const f = peopleFixture();
    expect(presentCharacters(f.world, f.initial.state)).toEqual([]);
    expect(progressionEventAvailability(f.world, f.initial.state, "hello").visible).toBe(false);
    const before = structuredClone(f.initial), waited = f.act(f.initial, { kind: "wait", minutes: 5 });
    expect(waited.state.world!.minutes).toBe(1435); expect(presentCharacters(f.world, waited.state)).toEqual([{ id: "mara", name: "Mara" }]);
    expect(waited.state.world!.people!.knownCharacterIds).toEqual(["ivo", "mara"]);
    expect(progressionEventAvailability(f.world, waited.state, "hello")).toMatchObject({ visible: true, enabled: true });
    expect(JSON.stringify(presentCharacters(f.world, waited.state))).not.toMatch(/station|1435|until|days|override/);
    expect(f.initial).toEqual(before);
  });
  it("uses inclusive starts/exclusive ends, daily overnight slots, weekly wrap and the day1 anchor", () => {
    const f = peopleFixture(), at = (minute: number) => ({ ...f.initial.state, world: { ...f.initial.state.world!, minutes: minute } });
    expect(characterLocation(f.world, at(1434), "mara")).toBeNull();
    expect(characterLocation(f.world, at(1435), "mara")).toBe("home");
    expect(characterLocation(f.world, at(1440), "mara")).toBe("home");
    expect(characterLocation(f.world, at(1450), "mara")).toBe("station");
    expect(characterLocation(f.world, at(1500), "mara")).toBeNull();
    f.people.schedules = [{ id: "weekly", characterId: "mara", locationId: "home", days: [6], from: 1380, until: 60 }];
    expect(characterLocation(f.world, at(30), "mara")).toBe("home");
    expect(characterLocation(f.world, at(60), "mara")).toBeNull();
    expect(characterLocation(f.world, at(10080 + 30), "mara")).toBe("home");
    expect(characterLocation(f.world, at(1440 + 30), "mara")).toBeNull();
  });
  it("stops a long wait at midnight, requires the highest-priority encounter first, and replays/saves exactly", () => {
    const f = peopleFixture(), before = structuredClone(f.initial);
    let next = f.act(f.initial, { kind: "wait", minutes: 60 });
    expect(next.state.world!.minutes).toBe(1440); expect(next.state.turn).toBe(1);
    expect(mandatoryEventStatus(f.world, next.state)).toEqual({ eventId: "urgent", conflict: false });
    const pending = structuredClone(next);
    for (const command of [{ kind: "wait", minutes: 5 }, { kind: "travel", id: "home-station" }, { kind: "action", id: "long-task" }, { kind: "event", id: "second" }] as const) expect(() => f.act(next, command)).toThrow(/pending/);
    expect(() => chooseNativePlayerSession(f.bundle, f.config, next, "choice-0")).toThrow(/pending/);
    expect(next).toEqual(pending);
    next = f.act(next, { kind: "event", id: "urgent" });
    expect(mandatoryEventStatus(f.world, next.state).eventId).toBe("second");
    next = loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, next));
    next = f.act(next, { kind: "event", id: "second" });
    expect(mandatoryEventStatus(f.world, next.state).eventId).toBeNull();
    next = f.act(next, { kind: "wait", minutes: 15 });
    expect(next.state.world!.minutes).toBe(1455); expect(presentCharacters(f.world, next.state)).toEqual([]);
    expect(progressionEventAvailability(f.world, next.state, "hello")).toMatchObject({ visible: true, enabled: false, reason: "Encounter unavailable" });
    const replay = f.act(f.act(f.act(f.act(f.initial, { kind: "wait", minutes: 60 }), { kind: "event", id: "urgent" }), { kind: "event", id: "second" }), { kind: "wait", minutes: 15 });
    expect(replay).toEqual(next); expect(f.initial).toEqual(before);
    expect(rewindNativePlayerSession(f.bundle, f.config, next).state.world!.minutes).toBe(1440);
    expect(restartNativePlayerSession(f.bundle, f.config).state).toEqual(before.state);
  });
  it("evaluates travel at arrival without discovering people passed during transit", () => {
    const f = peopleFixture(), next = f.act(f.initial, { kind: "travel", id: "home-station" });
    expect(next.state.world).toMatchObject({ locationId: "station", minutes: 1450, people: { knownCharacterIds: ["mara"] } });
    expect(presentCharacters(f.world, next.state)).toEqual([{ id: "mara", name: "Mara" }]);
    expect(next.state.world!.people!.knownCharacterIds).not.toContain("ivo");
    expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, next)).state).toEqual(next.state);
  });
  it("evaluates presence after narrative-choice arrival and records discovery in the choice trace", () => {
    const f = peopleFixture();
    f.people.overrides = [{ id: "arrival", characterId: "mara", locationId: "cafe", priority: 10, prerequisites: [{ kind: "location", locationId: "cafe", present: true }] }];
    const initial = f.refresh(), before = structuredClone(initial), choice = chooseNativeGameChoice(loadNativeGame(f.bundle), initial.state, "choice-0");
    expect(choice.ok).toBe(true);
    if (!choice.ok) throw new Error("Expected accepted arrival");
    expect(choice.step.stateDelta).toContainEqual({ path: "world.people.knownCharacterIds.mara", before: false, after: true });
    expect(choice.state.world!.people!.knownCharacterIds).toEqual(["mara"]);
    const next = chooseNativePlayerSession(f.bundle, f.config, initial, "choice-0").session;
    expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, next)).state).toEqual(choice.state);
    expect(initial).toEqual(before);
  });
  it("rejects a stationary authored cost that would skip a newly required encounter, without partial effects or discoveries", () => {
    const f = peopleFixture(), before = structuredClone(f.initial);
    expect(() => f.act(f.initial, { kind: "action", id: "long-task" })).toThrow("boundary_use_wait");
    expect(f.initial).toEqual(before);
  });
  it("observes a transient optional encounter even when a wait ends after its window", () => {
    const f = peopleFixture(); f.people.events.forEach((r) => { r.mandatory = false; });
    f.progression.events[0]!.prerequisites = [{ kind: "time", from: 1432, until: 1434 }]; f.people.events[0]!.characterIds = ["ivo"];
    const next = f.act(f.refresh(), { kind: "wait", minutes: 60 });
    expect(next.state.world!.minutes).toBe(1490);
    expect(next.state.world!.progression!.knownEventIds).toContain("hello");
    expect(next.state.world!.people!.knownCharacterIds).toContain("ivo");
    expect(progressionEventAvailability(f.world, next.state, "hello")).toMatchObject({ visible: true, enabled: false });
  });
  it("applies story override precedence/absence at action completion and expires it after chapter carry policies", () => {
    const f = peopleFixture(); f.people.events.forEach((r) => { r.mandatory = false; });
    f.people.overrides = [{ id: "story", characterId: "mara", locationId: "home", priority: 10, prerequisites: [{ kind: "milestone", milestoneId: "clue", achieved: true }] }, { id: "absence", characterId: "mara", locationId: null, priority: 20, prerequisites: [{ kind: "chapter", chapterId: "second", current: true }] }];
    f.progression.events[0]!.prerequisites = []; f.people.events[0]!.characterIds = []; f.progression.events[0]!.milestoneIds = ["clue"];
    let next = f.act(f.refresh(), { kind: "event", id: "hello" });
    expect(presentCharacters(f.world, next.state)).toEqual([{ id: "mara", name: "Mara" }]);
    const preview = previewChapterTransition(f.world, next.state, "next"), copy = structuredClone(next);
    next = f.act(next, { kind: "chapter-transition", id: "next", previewFingerprint: preview.fingerprint });
    expect(characterLocation(f.world, next.state, "mara")).toBeNull(); expect(copy.state.world!.people!.knownCharacterIds).toContain("mara");
    expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, next)).state).toEqual(next.state);
  });
  it.each(["overlap", "overnight-overlap", "override-tie", "mandatory-tie", "missing-person", "missing-location", "missing-event", "repeat-gap", "bad-condition", "unknown-version"])("rejects invalid %s definitions", (kind) => {
    const f = peopleFixture();
    if (kind === "overlap") f.people.schedules.push({ ...f.people.schedules[0]!, id: "copy" });
    if (kind === "overnight-overlap") f.people.schedules.push({ id: "copy", characterId: "mara", locationId: "home", days: [1], from: 0, until: 5 });
    if (kind === "override-tie") f.people.overrides = ["a", "b"].map((id) => ({ id, characterId: "mara", locationId: "home", priority: 1, prerequisites: [] }));
    if (kind === "mandatory-tie") f.people.events[2]!.priority = 20;
    if (kind === "missing-person") f.people.events[0]!.characterIds = ["missing"];
    if (kind === "missing-location") f.people.schedules[0]!.locationId = "missing";
    if (kind === "missing-event") f.people.events.pop();
    if (kind === "repeat-gap") f.progression.events[1]!.repeat = { kind: "repeatable", cooldownMinutes: 0 };
    if (kind === "bad-condition") f.people.overrides = [{ id: "bad", characterId: "mara", locationId: null, priority: 1, prerequisites: [{ kind: "milestone", milestoneId: "missing", achieved: false }] }];
    if (kind === "unknown-version") (f.people as any).schemaVersion = 2;
    expect(NativeWorldSchema.safeParse(f.world).success).toBe(false);
  });
  it("allows equal-priority required events with provably exclusive prerequisites and optional ties", () => {
    const f = peopleFixture(); f.people.events[2]!.priority = 20;
    f.progression.events[1]!.prerequisites = [{ kind: "chapter", chapterId: "first", current: true }]; f.progression.events[2]!.prerequisites = [{ kind: "chapter", chapterId: "second", current: true }];
    expect(NativeWorldSchema.safeParse(f.world).success).toBe(true);
    f.people.events[1]!.mandatory = false; f.people.events[2]!.mandatory = false; f.progression.events[2]!.prerequisites = [];
    expect(NativeWorldSchema.safeParse(f.world).success).toBe(true);
  });
  it("defensively rejects runtime conflicts independent of event storage order and leaves state unchanged", () => {
    const f = peopleFixture(); const state = structuredClone(f.initial.state); state.world!.minutes = 1440; state.world!.people!.knownCharacterIds = ["mara"]; state.world!.progression!.knownEventIds = f.progression.events.map((e) => e.id);
    f.people.events[2]!.priority = 20; const before = structuredClone(state);
    expect(mandatoryEventStatus(f.world, state)).toEqual({ eventId: null, conflict: true });
    expect(() => transitionWorld(f.world, state, { kind: "event", id: "urgent" })).toThrow("priority_conflict");
    f.people.events.reverse(); f.progression.events.reverse();
    expect(mandatoryEventStatus(f.world, state)).toEqual({ eventId: null, conflict: true });
    expect(() => transitionWorld(f.world, state, { kind: "wait", minutes: 5 })).toThrow("priority_conflict"); expect(state).toEqual(before);
  });
  it("selects the same unique required priority after reversing authored event storage order", () => {
    const f = peopleFixture(), first = f.act(f.initial, { kind: "wait", minutes: 60 });
    f.people.events.reverse(); f.progression.events.reverse();
    const reordered = f.act(f.refresh(), { kind: "wait", minutes: 60 });
    expect(mandatoryEventStatus(f.world, reordered.state).eventId).toBe("urgent");
    expect(reordered.state).toEqual(first.state);
  });
  it("includes cooldown expiry as a relevant required-encounter boundary", () => {
    const f = peopleFixture(); f.people.events[0]!.mandatory = true; f.people.events[0]!.priority = 30;
    f.progression.events[0]!.repeat = { kind: "repeatable", cooldownMinutes: 5 };
    let next = f.act(f.refresh(), { kind: "wait", minutes: 15 }); expect(next.state.world!.minutes).toBe(1435);
    next = f.act(next, { kind: "event", id: "hello" }); next = f.act(next, { kind: "wait", minutes: 15 });
    expect(next.state.world!.minutes).toBe(1440); expect(mandatoryEventStatus(f.world, next.state).eventId).toBe("hello");
  });
  it("does not partially apply a stationary event or chapter transition across a required boundary", () => {
    const f = peopleFixture(); f.people.events[0]!.characterIds = []; f.progression.events[0]!.minutes = 60;
    f.progression.initialMilestoneIds = ["clue"]; f.progression.transitions[0]!.passageId = null; f.progression.transitions[0]!.minutes = 15;
    const initial = f.refresh(), before = structuredClone(initial);
    expect(() => f.act(initial, { kind: "event", id: "hello" })).toThrow("boundary_use_wait");
    expect(() => f.act(initial, { kind: "chapter-transition", id: "next", previewFingerprint: previewChapterTransition(f.world, initial.state, "next").fingerprint })).toThrow("boundary_use_wait");
    expect(initial).toEqual(before);
  });
  it.each(["missing", "unknown-person", "duplicate", "unknown-version", "missing-current"])("rejects resealed %s people saves", (kind) => {
    const f = peopleFixture(), next = f.act(f.initial, { kind: "wait", minutes: 5 }), save = createNativePlayerSave(f.bundle, f.config, next);
    if (kind === "missing") delete save.state.world!.people;
    if (kind === "unknown-person") save.state.world!.people!.knownCharacterIds.push("unknown");
    if (kind === "duplicate") save.state.world!.people!.knownCharacterIds.push("mara");
    if (kind === "unknown-version") (save.state.world!.people as any).schemaVersion = 2;
    if (kind === "missing-current") save.state.world!.people!.knownCharacterIds = [];
    const { saveFingerprint: _fp, ...identity } = save; save.saveFingerprint = stableFingerprint(identity);
    expect(() => loadNativePlayerSave(f.bundle, f.config, save)).toThrow();
  });
  it("rejects invalid time ranges and missing discovery state at pure runtime boundaries", () => {
    const f = peopleFixture();
    for (const end of [Infinity, NaN, 1429, 1430.5, 52_560_001, 3000]) expect(() => peopleTimeBoundaries(f.world, f.initial.state, end)).toThrow("time_range_invalid");
    const state = structuredClone(f.initial.state); delete state.world!.people;
    expect(() => transitionWorld(f.world, state, { kind: "wait", minutes: 5 })).toThrow("people_state_presence_invalid");
  });
  it.each(["cooldown", "day"])("warns about a possible immediate mandatory repeat (%s) without claiming exhaustive proof", (kind) => {
    const f = peopleFixture(); f.progression.events[1]!.minutes = kind === "day" ? 1440 : 10;
    f.progression.events[1]!.repeat = kind === "day" ? { kind: "once-per-day" } : { kind: "repeatable", cooldownMinutes: 5 };
    expect(NativeWorldSchema.safeParse(f.world).success).toBe(true);
    expect(peopleDiagnostics(f.people, f.progression)).toContainEqual(expect.objectContaining({ code: "people.mandatory-may-repeat-immediately", severity: "warning", entityId: "urgent", message: expect.stringContaining("not exhaustive") }));
  });
  it("supports people without chapters/events and retains the absent-extension W1/W2 shape", () => {
    const f = peopleFixture(); delete f.world.progression; f.people.events = []; f.progression.events = [];
    const next = f.act(f.refresh(), { kind: "wait", minutes: 15 }); expect(next.state.world!.people!.knownCharacterIds).toContain("mara"); expect(next.state.world!.progression).toBeUndefined();
    const old = progressionFixture(); expect(old.bundle.world).not.toHaveProperty("people"); expect(old.initial.state.world).not.toHaveProperty("people");
    const bad = structuredClone(old.bundle); (bad.initialState.world as any).people = { schemaVersion: 1, knownCharacterIds: [] }; bad.bundleFingerprint = nativeBundleFingerprint(bad);
    expect(() => validateNativeGameBundle(bad)).toThrow();
    expect(() => assertPeopleState(old.world, next.state)).toThrow();
  });
});
