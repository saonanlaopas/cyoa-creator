import { describe, expect, it } from "vitest";
import { journalFixture } from "./journal-fixture.js";
import { actNativePlayerWorld, assertJournalState, chooseNativePlayerSession, cloneRuntimeState, createNativePlayerSave, inspectWorldJournal, loadNativePlayerSave, nativePlayerView, observeJournal, restartNativePlayerSession, rewindNativePlayerSession, validateJournalReferences, validateNativeGameBundle, nativeBundleFingerprint, initialWorldState, createNativePlayerSession, previewChapterTransition } from "../src/index.js";
const view = (f: ReturnType<typeof journalFixture>, s = f.initial) => inspectWorldJournal(f.world, s.state);
describe("W5 authored visibility and committed journal observations", () => {
  it("keeps hidden names, prose, values and objectives out of the player projection without mutating input", () => {
    const f = journalFixture(), before = structuredClone(f.initial);
    const v = view(f); expect(v.character.map((r) => r.key)).toEqual(["resolve"]); expect(v.locations.map((l) => l.id)).toEqual(["home", "cafe"]); expect(v.objectives.map((o) => o.id)).toEqual(["discuss"]); expect(v.entries).toEqual([]); expect(v.events).toEqual([]);
    expect(JSON.stringify(v)).not.toMatch(/Secret|Never disclosed|Future instruction|Trust with Mara|station|when|completeWhen|mechanics/);
    expect(nativePlayerView(f.bundle, f.visibleConfig, createNativePlayerSession(f.bundle, f.visibleConfig)).visibleState.map((r) => r.key)).toEqual(["resolve"]);
    expect(f.initial).toEqual(before);
  });
  it("records a transient interval during a long wait, remembers it after expiry, and prevents duplicates", () => {
    const f = journalFixture(), s = f.act(f.initial, { kind: "wait", minutes: 15 });
    expect(s.state.world!.minutes).toBe(1445); expect(view(f, s).entries.map((e) => e.id)).toEqual(["minute-note"]);
    const copy = cloneRuntimeState(s.state); observeJournal(f.world, copy); observeJournal(f.world, copy); expect(copy).toEqual(s.state);
    expect(f.initial.state.world!.journal!.entryIds).toEqual([]);
  });
  it("shows canonical relationship changes, completes objectives and records actual events after economic effects", () => {
    const f = journalFixture(); let s = f.act(f.initial, { kind: "purchase", id: "buy-tea" }); s = f.act(s, { kind: "gift", id: "gift-tea" });
    expect(view(f, s).character.find((r) => r.key === "trust")?.value).toBe(1); expect(view(f, s).entries.some((e) => e.id === "tea-note")).toBe(true);
    s = f.act(s, { kind: "purchase", id: "buy-tea" }); s = f.act(s, { kind: "event", id: "hello" });
    expect(view(f, s).objectives).toEqual([]); expect(view(f, s).completedObjectives).toEqual([{ id: "discuss", title: "Discuss the signal" }]);
    expect(view(f, s).events).toMatchObject([{ id: "hello", count: 1 }]); expect(view(f, s).locations.some((l) => l.id === "station")).toBe(true);
    expect(JSON.stringify(view(f, s))).not.toMatch(/Secret objective|Secret future/);
  });
  it("discovers narrative arrivals after choice effects and uses canonical stats for journal triggers", () => {
    const f = journalFixture(); f.journal.entries.push({ id: "resolve-note", title: "Resolve recorded", text: "You chose to continue.", when: [{ kind: "stat", key: "resolve", minimum: 1, maximum: null }] });
    const initial = f.refresh(), s = chooseNativePlayerSession(f.bundle, f.config, initial, "choice-0").session;
    expect(view(f, s).entries.some((e) => e.id === "resolve-note")).toBe(true); expect(s.state.stats.resolve).toBe(1); expect(s.state.world!.locationId).toBe("cafe");
  });
  it("does not reveal completion-time information which the committed effects hide", () => {
    const f = journalFixture(); f.journal.entries = [{ id: "not-yet", title: "Premature", text: "Must stay hidden.", when: [{ kind: "time", from: 1432, until: null }, { kind: "relationship", key: "trust", minimum: 0, maximum: 0 }] }];
    f.economy.items[0]!.initial = 1; f.economy.gifts[0]!.minutes = 2; const start = f.refresh(), s = f.act(start, { kind: "gift", id: "gift-tea" });
    expect(s.state.world!.minutes).toBe(1432); expect(view(f, s).entries).toEqual([]);
  });
  it("rejects failed actions and undiscovered travel atomically without recording observations", () => {
    const f = journalFixture(), before = structuredClone(f.initial);
    expect(() => f.act(f.initial, { kind: "travel", id: "home-station" })).toThrow(/undiscovered/);
    expect(() => f.act(f.initial, { kind: "purchase", id: "buy-ticket" })).toThrow(/Insufficient/);
    expect(f.initial).toEqual(before);
  });
  it("keeps entries remembered while character visibility re-evaluates current state", () => {
    const f = journalFixture(); f.economy.items[0]!.initial = 2; f.economy.uses[0]!.effects.relationships = [{ key: "trust", delta: -1 }]; const s = f.act(f.refresh(), { kind: "gift", id: "gift-tea" });
    const copied = f.act(s, { kind: "use", id: "drink-tea" }).state;
    expect(inspectWorldJournal(f.world, copied).character.map((r) => r.key)).toEqual(["resolve"]); expect(inspectWorldJournal(f.world, copied).entries.some((r) => r.id === "tea-note")).toBe(true);
  });
  it("round trips saves, replays deterministically, and restores discovery through rewind and restart", () => {
    const f = journalFixture(), commands = [{ kind: "purchase", id: "buy-tea" }, { kind: "gift", id: "gift-tea" }] as const;
    const run = () => commands.reduce((s, c) => f.act(s, c), f.initial), s = run(); expect(run()).toEqual(s);
    const saved = createNativePlayerSave(f.bundle, f.config, s), loaded = loadNativePlayerSave(f.bundle, f.config, saved); expect(loaded).toEqual(s);
    expect(rewindNativePlayerSession(f.bundle, f.config, s).state.world!.journal!.entryIds).not.toContain("tea-note");
    expect(restartNativePlayerSession(f.bundle, f.config)).toEqual(f.initial);
  });
  it.each(["entry", "location", "objective", "duplicate", "observation", "completed-hidden", "extra-stat", "world-location", "clock"])("rejects invalid journal save %s", (kind) => {
    const f = journalFixture(), s = cloneRuntimeState(f.initial.state), j = s.world!.journal!;
    if (kind === "entry") j.entryIds.push("missing"); if (kind === "location") j.knownLocationIds.push("missing"); if (kind === "objective") j.revealedObjectiveIds.push("missing"); if (kind === "duplicate") j.entryIds.push("minute-note", "minute-note"); if (kind === "observation") j.knownLocationIds = []; if (kind === "completed-hidden") j.completedObjectiveIds.push("secret-objective");
    if (kind === "extra-stat") s.stats.unknown = 0; if (kind === "world-location") s.world!.locationId = "cafe"; if (kind === "clock") s.world!.minutes = NaN;
    expect(() => assertJournalState(f.world, s)).toThrow(/journal_/);
  });
  it.each(["stat", "relationship", "event", "location", "item", "chapter", "milestone", "contradictory", "range"])("rejects invalid authored trigger %s", (kind) => {
    const f = journalFixture();
    const c: any = kind === "stat" || kind === "relationship" ? { kind, key: "missing", minimum: 0, maximum: null } : kind === "event" ? { kind, eventId: "missing", minimum: 1 } : kind === "location" ? { kind, locationId: "missing", present: true } : kind === "item" ? { kind, itemId: "missing", minimum: 0, maximum: null } : kind === "chapter" ? { kind, chapterId: "missing", current: true } : kind === "milestone" ? { kind, milestoneId: "missing", achieved: true } : { kind: "stat", key: "resolve", minimum: kind === "range" ? 6 : 3, maximum: kind === "range" ? null : 2 };
    f.journal.entries[0]!.when = [c]; expect(() => validateJournalReferences(f.world)).toThrow(/journal_/);
  });
  it("works without people/economy/progression and retains absent-extension shapes", () => {
    const f = journalFixture(); delete f.world.people; delete f.world.progression; delete f.world.economy; f.journal.locations = []; f.journal.objectives = []; f.journal.entries = [f.journal.entries[1]!]; f.journal.character = [{ category: "stat", key: "resolve", when: [] }];
    const s = f.act(f.refresh(), { kind: "wait", minutes: 15 }); expect(view(f, s).entries[0]!.id).toBe("minute-note");
    delete f.world.journal; f.bundle.initialState.world = initialWorldState(f.world); f.bundle.bundleFingerprint = nativeBundleFingerprint(f.bundle); expect(validateNativeGameBundle(f.bundle).initialState.world).not.toHaveProperty("journal");
  });
  it("rejects forged native canonical bounds and preserves initial discovery fingerprint checking", () => {
    const f = journalFixture(); f.journal.mechanics[0]!.maximum = 10; f.bundle.bundleFingerprint = nativeBundleFingerprint(f.bundle); expect(() => validateNativeGameBundle(f.bundle)).toThrow(/canonical/);
  });
  it("observes midnight inclusively and hides a conditional value at an exclusive upper boundary", () => {
    const f = journalFixture(); f.journal.character[1]!.when = [{ kind: "time", from: 1440, until: 1445 }]; f.journal.entries = [{ id: "midnight", title: "At midnight", text: "The midnight record.", when: [{ kind: "time", from: 1440, until: 1445 }] }];
    let s = f.refresh(); expect(view(f, s).entries).toEqual([]); s = f.act(s, { kind: "wait", minutes: 5 }); expect(view(f, s).entries).toEqual([]);
    s = f.act(s, { kind: "wait", minutes: 5 }); expect(view(f, s).entries[0]!.id).toBe("midnight"); expect(view(f, s).character.some((r) => r.key === "trust")).toBe(true);
    s = f.act(s, { kind: "wait", minutes: 5 }); expect(view(f, s).character.some((r) => r.key === "trust")).toBe(false); expect(view(f, s).entries[0]!.id).toBe("midnight");
  });
  it("remembers entries through chapter expiry, hides expired visibility and discovers an explicit transition arrival", () => {
    const f = journalFixture(); f.progression.initialMilestoneIds = ["clue", "temporary"]; f.journal.character[1]!.when = [{ kind: "milestone", milestoneId: "temporary", achieved: true }]; f.journal.entries = [{ id: "farewell", title: "A farewell", text: "Remember the farewell.", when: [{ kind: "milestone", milestoneId: "temporary", achieved: true }] }];
    const initial = f.refresh(), preview = previewChapterTransition(f.world, initial.state, "next"), next = f.act(initial, { kind: "chapter-transition", id: "next", previewFingerprint: preview.fingerprint });
    expect(view(f, next).character.some((r) => r.key === "trust")).toBe(false); expect(view(f, next).entries[0]!.id).toBe("farewell"); expect(view(f, initial).locations.some((l) => l.id === "station")).toBe(false); expect(view(f, next).locations.some((l) => l.id === "station")).toBe(true);
  });
  it("withholds a completed hidden objective until reveal, then records it once", () => {
    const f = journalFixture(); f.journal.objectives[1]!.when = [{ kind: "time", from: 1440, until: null }];
    let s = f.act(f.refresh(), { kind: "purchase", id: "buy-tea" }); s = f.act(s, { kind: "gift", id: "gift-tea" }); s = f.act(s, { kind: "purchase", id: "buy-tea" }); s = f.act(s, { kind: "event", id: "hello" });
    expect(view(f, s).completedObjectives.map((o) => o.id)).toEqual(["discuss"]); expect(JSON.stringify(view(f, s))).not.toMatch(/Secret objective/);
    s = f.act(s, { kind: "wait", minutes: 5 }); expect(view(f, s).completedObjectives.map((o) => o.id)).toEqual(["discuss", "secret-objective"]);
    s = f.act(s, { kind: "wait", minutes: 5 }); expect(s.state.world!.journal!.completedObjectiveIds.filter((id) => id === "secret-objective")).toHaveLength(1);
  });

  it("reuses the accepted event ledger for repeats without duplicate records or entries", () => {
    const f = journalFixture(); f.economy.items[0]!.initial = 3; f.progression.events[0]!.repeat = { kind: "repeatable", cooldownMinutes: 0 }; f.journal.entries.push({ id: "twice", title: "Two conversations", text: "Both conversations are recorded once.", when: [{ kind: "event", eventId: "hello", minimum: 2 }] });
    let s = f.act(f.refresh(), { kind: "gift", id: "gift-tea" }); s = f.act(s, { kind: "event", id: "hello" }); expect(view(f, s).entries.some((e) => e.id === "twice")).toBe(false);
    s = f.act(s, { kind: "event", id: "hello" }); expect(view(f, s).events).toMatchObject([{ id: "hello", count: 2 }]); expect(view(f, s).entries.filter((e) => e.id === "twice")).toHaveLength(1);
  });

});
