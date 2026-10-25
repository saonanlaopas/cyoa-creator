import { describe, it, expect } from "vitest";
import { NativeProgressionSchema, NativeWorldSchema, actNativePlayerWorld, chooseNativePlayerSession, createNativePlayerSave, loadNativePlayerSave,
  nativeBundleFingerprint, prerequisitesMet, previewChapterTransition, progressionDiagnostics, progressionEventAvailability, restartNativePlayerSession,
  rewindNativePlayerSession, stableFingerprint, validateNativeGameBundle } from "../src/index.js";
import { progressionFixture } from "./progression-fixture.js";

describe("W2 deterministic chapters and events", () => {
  it.each(["toString", "valueOf", "hasOwnProperty", "__defineGetter__"])("executes valid inherited-name transition %s, saves it and increments its own ledger on repeat", (id) => {
    const f = progressionFixture(), transition = f.progression.transitions[0]!;
    transition.id = id; f.progression.chapters[1]!.final = false;
    f.progression.transitions.push({ ...transition, id: "back", fromChapterId: "second", toChapterId: "first", passageId: "passage-0", expireEventIds: [], minutes: 0 });
    expect(NativeProgressionSchema.safeParse(f.progression).success).toBe(true);
    const noticed = f.act(f.refresh(), { kind: "event", id: "notice" }), before = structuredClone(noticed);
    let next = f.act(noticed, { kind: "chapter-transition", id, previewFingerprint: previewChapterTransition(f.world, noticed.state, id).fingerprint });
    expect(next.state.world!.progression!.transitions[id]).toBe(1);
    expect(Object.hasOwn(next.state.world!.progression!.transitions, id)).toBe(true);
    expect(noticed).toEqual(before);
    next = loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, next));
    next = f.act(next, { kind: "chapter-transition", id: "back", previewFingerprint: previewChapterTransition(f.world, next.state, "back").fingerprint });
    next = f.act(next, { kind: "chapter-transition", id, previewFingerprint: previewChapterTransition(f.world, next.state, id).fingerprint });
    expect(next.state.world!.progression!.transitions[id]).toBe(2);
    expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, next)).state).toEqual(next.state);
  });
  it("previews losses without mutation, then atomically carries/clears/expires and enters the authored passage across midnight", () => {
    const f = progressionFixture(), initialCopy = structuredClone(f.initial);
    expect(() => previewChapterTransition(f.world, f.initial.state, "next")).toThrow("unavailable");
    const noticed = f.act(f.initial, { kind: "event", id: "notice" }), copy = structuredClone(noticed);
    const preview = previewChapterTransition(f.world, noticed.state, "next");
    expect(preview.expiredMilestones.map((m) => m.id)).toEqual(["temporary"]);
    expect(preview.carriedMilestones.map((m) => m.id)).toEqual(["clue"]);
    expect(preview.lostOpportunities).toContainEqual({ id: "conversation", label: "A last conversation", permanent: true, reason: "Authored expiry at this transition" });
    expect(preview.lostOpportunities.some((e) => e.id === "crossing")).toBe(false);
    expect(noticed).toEqual(copy);
    const next = f.act(noticed, { kind: "chapter-transition", id: "next", previewFingerprint: preview.fingerprint });
    expect(next.state.world).toMatchObject({ locationId: "station", minutes: 1440, stationaryTurns: 1,
      progression: { chapterId: "second", milestones: ["clue"], expiredEventIds: ["conversation"], transitions: { next: 1 } } });
    expect(next.state.currentPassageId).toBe("passage-2"); expect(next.state.visitCounts["passage-2"]).toBe(1);
    expect(next.state.turn).toBe(2); expect(f.initial).toEqual(initialCopy); expect(noticed).toEqual(copy);
    expect(progressionEventAvailability(f.world, next.state, "conversation")).toMatchObject({ enabled: false, reason: "Expired" });
    expect(progressionEventAvailability(f.world, next.state, "crossing")).toMatchObject({ visible: true, enabled: true });
    expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, next)).state).toEqual(next.state);
    expect(rewindNativePlayerSession(f.bundle, f.config, next).state).toEqual(noticed.state);
    expect(restartNativePlayerSession(f.bundle, f.config).state).toEqual(initialCopy.state);
  });
  it("rejects stale previews and once-only repeats with no time, milestones, history or visit changes", () => {
    const f = progressionFixture(), noticed = f.act(f.initial, { kind: "event", id: "notice" });
    const preview = previewChapterTransition(f.world, noticed.state, "next"), waited = f.act(noticed, { kind: "wait", minutes: 5 }), copy = structuredClone(waited);
    expect(() => f.act(waited, { kind: "chapter-transition", id: "next", previewFingerprint: preview.fingerprint })).toThrow("preview_stale");
    expect(() => f.act(waited, { kind: "event", id: "notice" })).toThrow("unavailable");
    expect(waited).toEqual(copy);
  });
  it("evaluates inclusive/exclusive game-time boundaries, negation and location without wall-clock time", () => {
    const f = progressionFixture();
    expect(prerequisitesMet([{ kind: "time", from: 1430, until: 1431 }], f.initial.state)).toBe(true);
    expect(prerequisitesMet([{ kind: "time", from: 0, until: 1430 }], f.initial.state)).toBe(false);
    expect(prerequisitesMet([{ kind: "chapter", chapterId: "second", current: false }, { kind: "milestone", milestoneId: "clue", achieved: false }, { kind: "location", locationId: "station", present: false }], f.initial.state)).toBe(true);
    const away = f.act(f.initial, { kind: "travel", id: "home-cafe" });
    expect(() => f.act(away, { kind: "event", id: "notice" })).toThrow("unavailable");
  });
  it("supports cooldown and once-per-day across midnight, counting stationary turns without fabricated visits", () => {
    const f = progressionFixture(); let next = f.act(f.initial, { kind: "event", id: "rest" });
    expect(() => f.act(next, { kind: "event", id: "rest" })).toThrow("unavailable");
    next = f.act(next, { kind: "event", id: "bell" });
    expect(() => f.act(next, { kind: "event", id: "bell" })).toThrow("unavailable");
    next = f.act(next, { kind: "wait", minutes: 15 });
    next = f.act(next, { kind: "event", id: "bell" }); next = f.act(next, { kind: "event", id: "rest" });
    expect(next.state.world!.progression!.events.bell!.count).toBe(2);
    expect(next.state.visitCounts).toEqual(f.initial.state.visitCounts); expect(next.state.turn).toBe(5);
    expect(next.state.world!.stationaryTurns).toBe(5);
  });
  it("enforces once-per-chapter even when a chapter is revisited", () => {
    const f = progressionFixture(); f.progression.chapters[1]!.final = false;
    f.progression.transitions.push({ ...f.progression.transitions[0]!, id: "back", fromChapterId: "second", toChapterId: "first", passageId: "passage-0", expireEventIds: [], minutes: 0 });
    let next = f.act(f.refresh(), { kind: "event", id: "check-in" });
    next = f.act(next, { kind: "event", id: "notice" });
    next = f.act(next, { kind: "chapter-transition", id: "next", previewFingerprint: previewChapterTransition(f.world, next.state, "next").fingerprint });
    expect(previewChapterTransition(f.world, next.state, "back").lostOpportunities).toContainEqual(expect.objectContaining({ id: "check-in", permanent: false, reason: "Repeat rule prevents replay in the destination chapter" }));
    next = f.act(next, { kind: "event", id: "check-in" });
    next = f.act(next, { kind: "chapter-transition", id: "back", previewFingerprint: previewChapterTransition(f.world, next.state, "back").fingerprint });
    expect(() => f.act(next, { kind: "event", id: "check-in" })).toThrow("unavailable");
    expect(next.state.world!.progression!.events["check-in"]!.count).toBe(2);
  });
  it("supports chapter-free events, preserves progression through story choices, and re-enters authored event passages correctly", () => {
    const f = progressionFixture(); f.progression.chapters = []; f.progression.initialChapterId = null; f.progression.transitions = [];
    f.progression.events = f.progression.events.filter((e) => e.repeat.kind !== "once-per-chapter").map((e) => ({ ...e, prerequisites: e.prerequisites.filter((c) => c.kind !== "chapter") }));
    f.progression.events[0]!.passageId = "passage-1";
    const next = f.act(f.refresh(), { kind: "event", id: "notice" });
    expect(next.state.world!.progression!.chapterId).toBeNull(); expect(next.state.world!.locationId).toBe("cafe");
    expect(next.state.visitCounts["passage-1"]).toBe(1); expect(next.state.world!.stationaryTurns).toBeUndefined();
    const chosen = chooseNativePlayerSession(f.bundle, f.config, next, "choice-1").session;
    expect(chosen.state.world!.progression).toEqual(next.state.world!.progression);
    expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, chosen)).state).toEqual(chosen.state);
  });
  it("rejects time overflow atomically on zero-prerequisite events", () => {
    const f = progressionFixture(); f.world.initialMinutes = 52_560_000; f.progression.events.find((e) => e.id === "check-in")!.minutes = 1;
    const initial = f.refresh(), copy = structuredClone(initial);
    expect(() => f.act(initial, { kind: "event", id: "check-in" })).toThrow("time_limit"); expect(initial).toEqual(copy);
  });
  it.each(["chapter", "milestone", "location", "time", "from-chapter"])("rejects contradictory %s prerequisites", (kind) => {
    const p = structuredClone(progressionFixture().progression);
    if (kind === "chapter") p.events[0]!.prerequisites = [{ kind: "chapter", chapterId: "first", current: true }, { kind: "chapter", chapterId: "second", current: true }];
    if (kind === "milestone") p.events[0]!.prerequisites = [{ kind: "milestone", milestoneId: "clue", achieved: true }, { kind: "milestone", milestoneId: "clue", achieved: false }];
    if (kind === "location") p.events[0]!.prerequisites = [{ kind: "location", locationId: "home", present: true }, { kind: "location", locationId: "station", present: true }];
    if (kind === "time") p.events[0]!.prerequisites = [{ kind: "time", from: 10, until: 20 }, { kind: "time", from: 20, until: 30 }];
    if (kind === "from-chapter") p.transitions[0]!.prerequisites = [{ kind: "chapter", chapterId: "second", current: true }];
    expect(() => NativeProgressionSchema.parse(p)).toThrow("contradictory");
  });
  it("reports potential traps and milestone cycles without claiming exhaustive reachability", () => {
    const f = progressionFixture(); f.progression.events[0]!.prerequisites.push({ kind: "milestone", milestoneId: "clue", achieved: true });
    const findings = progressionDiagnostics(f.progression, f.world.initialMinutes);
    expect(findings.map((f) => f.code)).toEqual(expect.arrayContaining(["progression.potential-progression-trap", "progression.milestone-may-be-unobtainable", "progression.chapter-may-be-unreachable"]));
    expect(NativeProgressionSchema.safeParse(f.progression).success).toBe(true);
  });
  it.each(["missing-progression", "unknown-milestone", "unearned-milestone", "unknown-event", "bad-count", "unknown-chapter", "fake-expiry", "fake-transition", "bad-time", "bad-version"])("rejects resealed %s save data", (attack) => {
    const f = progressionFixture(), save = createNativePlayerSave(f.bundle, f.config, f.initial), state = save.state.world!.progression!;
    if (attack === "missing-progression") delete save.state.world!.progression;
    if (attack === "unknown-milestone") state.milestones.push("invented");
    if (attack === "unearned-milestone") state.milestones.push("clue");
    if (attack === "unknown-event") state.events.missing = { count: 1, lastMinutes: 1430, chapterIds: [] };
    if (attack === "bad-count") state.events.notice = { count: -1, lastMinutes: 1430, chapterIds: [] };
    if (attack === "unknown-chapter") state.chapterId = "missing";
    if (attack === "fake-expiry") state.expiredEventIds.push("conversation");
    if (attack === "fake-transition") state.transitions.next = 1;
    if (attack === "bad-time") state.events.notice = { count: 1, lastMinutes: 1431, chapterIds: [] };
    if (attack === "bad-version") (state as any).schemaVersion = 2;
    const { saveFingerprint: _fp, ...identity } = save; save.saveFingerprint = stableFingerprint(identity);
    expect(() => loadNativePlayerSave(f.bundle, f.config, save)).toThrow();
  });
  it("rejects invalid external references, unknown passage destinations and unsupported contracts", () => {
    const f = progressionFixture(); f.progression.events[0]!.prerequisites.push({ kind: "location", locationId: "unknown", present: false });
    expect(() => NativeWorldSchema.parse(f.world)).toThrow(); f.progression.events[0]!.prerequisites.pop();
    f.progression.events[0]!.passageId = "unknown"; f.bundle.bundleFingerprint = nativeBundleFingerprint(f.bundle);
    expect(() => validateNativeGameBundle(f.bundle)).toThrow("World locations");
  });
});

it("rejects excluding every chapter/location while allowing a meaningful negative prerequisite", () => {
  const f = progressionFixture(); f.progression.events[0]!.prerequisites = [{ kind: "chapter", chapterId: "first", current: false }];
  expect(NativeProgressionSchema.safeParse(f.progression).success).toBe(true);
  f.progression.events[0]!.prerequisites.push({ kind: "chapter", chapterId: "second", current: false });
  expect(() => NativeProgressionSchema.parse(f.progression)).toThrow("contradictory_chapter");
  f.progression.events[0]!.prerequisites = f.world.locations.map((location) => ({ kind: "location", locationId: location.id, present: false }));
  expect(() => NativeWorldSchema.parse(f.world)).toThrow("contradictory_location");
});
it("rejects a resealed chapter-history cycle disconnected from the initial chapter", () => {
  const f = progressionFixture(); f.progression.chapters.push({ id: "third", name: "Third", final: false }, { id: "fourth", name: "Fourth", final: false });
  const base = f.progression.transitions[0]!;
  f.progression.transitions.push({ ...base, id: "hidden-out", fromChapterId: "third", toChapterId: "fourth", prerequisites: [], carryMilestoneIds: [], expireEventIds: [], passageId: null }, { ...base, id: "hidden-back", fromChapterId: "fourth", toChapterId: "third", prerequisites: [], carryMilestoneIds: [], expireEventIds: [], passageId: null });
  const save = createNativePlayerSave(f.bundle, f.config, f.refresh());
  save.state.turn = 2; save.sequence = 2; save.state.world!.stationaryTurns = 2; save.state.world!.progression!.transitions = { "hidden-out": 1, "hidden-back": 1 };
  const { saveFingerprint: _fp, ...identity } = save; save.saveFingerprint = stableFingerprint(identity);
  expect(() => loadNativePlayerSave(f.bundle, f.config, save)).toThrow("progression_chapter_history_invalid");
});
it("remembers an encountered opportunity after travel and previews its chapter loss without revealing unknown future events", () => {
  const f = progressionFixture();
  f.progression.events.push({ ...f.progression.events[1]!, id: "known-home", label: "A home lead", visibility: "when-available", prerequisites: [{ kind: "chapter", chapterId: "first", current: true }, { kind: "location", locationId: "home", present: true }] });
  let next = f.act(f.refresh(), { kind: "event", id: "notice" });
  expect(next.state.world!.progression!.knownEventIds).toContain("known-home");
  next = f.act(next, { kind: "travel", id: "home-cafe" });
  expect(progressionEventAvailability(f.world, next.state, "known-home")).toMatchObject({ visible: true, enabled: false });
  const preview = previewChapterTransition(f.world, next.state, "next");
  expect(preview.lostOpportunities).toContainEqual(expect.objectContaining({ id: "known-home", permanent: false }));
  expect(preview.lostOpportunities.some((event) => event.id === "crossing")).toBe(false);
  expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, next)).state.world!.progression!.knownEventIds).toContain("known-home");
});
it("discovers travel/time opportunities on the new state without changing earlier checkpoints", () => {
  const f = progressionFixture();
  f.progression.events.push({ ...f.progression.events[1]!, id: "cafe-lead", visibility: "when-available", prerequisites: [{ kind: "location", locationId: "cafe", present: true }] },
    { ...f.progression.events[1]!, id: "late-lead", visibility: "when-available", prerequisites: [{ kind: "time", from: 1445, until: null }] });
  const initial = f.refresh(), before = structuredClone(initial);
  const away = f.act(initial, { kind: "travel", id: "home-cafe" }), awayCopy = structuredClone(away);
  expect(away.state.world!.progression!.knownEventIds).toContain("cafe-lead");
  expect(initial).toEqual(before);
  const later = f.act(away, { kind: "wait", minutes: 15 });
  expect(later.state.world!.progression!.knownEventIds).toContain("late-lead");
  expect(away).toEqual(awayCopy);
  expect(rewindNativePlayerSession(f.bundle, f.config, later).state).toEqual(awayCopy.state);
});
