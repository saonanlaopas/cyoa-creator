import { describe, expect, it } from "vitest";
import { createNativePlayerSave, loadNativePlayerSave, mandatoryEventStatus, presentCharacters, previewChapterTransition, progressionEventAvailability } from "../src/index.js";
import { peopleFixture } from "./people-fixture.js";

describe("W3 independent review regressions", () => {
  it.each([10, 30])("finishes a confirmed required encounter before arbitrating a newly eligible priority %s encounter", (priority) => {
    const f = peopleFixture();
    f.world.initialMinutes = 0;
    f.people.schedules = []; f.people.overrides = [];
    f.progression.events[1]!.prerequisites = []; f.progression.events[1]!.minutes = 10;
    f.progression.events[2]!.prerequisites = [{ kind: "time", from: 5, until: null }];
    f.people.events.forEach((r) => { r.characterIds = []; });
    f.people.events[2]!.priority = priority;
    const initial = f.refresh(), before = structuredClone(initial);
    expect(mandatoryEventStatus(f.world, initial.state).eventId).toBe("urgent");
    expect(() => f.act(initial, { kind: "wait", minutes: 5 })).toThrow("pending");
    const finished = f.act(initial, { kind: "event", id: "urgent" });
    expect(finished.state.world!.minutes).toBe(10); expect(finished.state.turn).toBe(1);
    expect(finished.state.world!.progression!.events.urgent?.count).toBe(1);
    expect(mandatoryEventStatus(f.world, finished.state).eventId).toBe("second");
    const resumed = loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, finished));
    const next = f.act(resumed, { kind: "event", id: "second" });
    expect(mandatoryEventStatus(f.world, next.state).eventId).toBeNull();
    expect(f.act(f.act(initial, { kind: "event", id: "urgent" }), { kind: "event", id: "second" })).toEqual(next);
    expect(initial).toEqual(before);
  });

  it.each(["event", "chapter-transition"] as const)("observes %s completion only after effects hide a scheduled person and encounter", (kind) => {
    const f = peopleFixture();
    f.people.events.forEach((r) => { r.mandatory = false; });
    f.people.schedules = [{ id: "endpoint", characterId: "mara", locationId: "home", days: [0], from: 1435, until: 1440 }];
    f.people.overrides = [{ id: "completion-absence", characterId: "mara", locationId: null, priority: 10, prerequisites: kind === "event"
      ? [{ kind: "milestone", milestoneId: "clue", achieved: true }] : [{ kind: "chapter", chapterId: "second", current: true }] }];
    f.progression.events[1]!.prerequisites = []; f.progression.events[1]!.minutes = 5; f.people.events[1]!.characterIds = [];
    const transition = f.progression.transitions[0]!; transition.prerequisites = []; transition.passageId = null; transition.minutes = 5;
    const initial = f.refresh(), before = structuredClone(initial);
    expect(initial.state.world!.people!.knownCharacterIds).not.toContain("mara");
    expect(progressionEventAvailability(f.world, initial.state, "hello").visible).toBe(false);
    const command = kind === "event" ? { kind, id: "urgent" } : { kind, id: "next", previewFingerprint: previewChapterTransition(f.world, initial.state, "next").fingerprint };
    const finished = f.act(initial, command);
    expect(finished.state.world!.minutes).toBe(1435);
    expect(presentCharacters(f.world, finished.state)).toEqual([]);
    expect(finished.state.world!.people!.knownCharacterIds).not.toContain("mara");
    expect(finished.state.world!.progression!.knownEventIds).not.toContain("hello");
    expect(progressionEventAvailability(f.world, finished.state, "hello").visible).toBe(false);
    const resumed = loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, finished));
    expect(resumed).toEqual(finished); expect(f.act(initial, command)).toEqual(finished); expect(initial).toEqual(before);
  });

  it.each(["action", "event", "chapter-transition"] as const)("still discovers an actually present person at %s completion", (kind) => {
    const f = peopleFixture();
    f.people.events.forEach((r) => { r.mandatory = false; });
    f.people.schedules = [{ id: "endpoint", characterId: "mara", locationId: "home", days: [0], from: 1435, until: 1440 }];
    f.progression.events[1]!.prerequisites = []; f.progression.events[1]!.minutes = 5; f.people.events[1]!.characterIds = [];
    f.world.actions[0]!.minutes = 5;
    const transition = f.progression.transitions[0]!; transition.prerequisites = []; transition.passageId = null; transition.minutes = 5;
    const initial = f.refresh();
    const command = kind === "chapter-transition" ? { kind, id: "next", previewFingerprint: previewChapterTransition(f.world, initial.state, "next").fingerprint } : { kind, id: kind === "event" ? "urgent" : "long-task" };
    const next = f.act(initial, command);
    expect(presentCharacters(f.world, next.state)).toEqual([{ id: "mara", name: "Mara" }]);
    expect(next.state.world!.people!.knownCharacterIds).toContain("mara");
    expect(next.state.world!.progression!.knownEventIds).toContain("hello");
  });

  it("does not call temporary mandatory blocking a transition loss, and the opportunity returns after the required event", () => {
    const f = peopleFixture(); f.people.schedules = []; f.people.events.forEach((r) => { r.characterIds = []; });
    f.progression.events[1]!.prerequisites = [{ kind: "chapter", chapterId: "second", current: true }];
    f.progression.events[2]!.prerequisites = [{ kind: "time", from: 5000, until: null }];
    const transition = f.progression.transitions[0]!; transition.prerequisites = []; transition.passageId = null; transition.minutes = 0;
    const initial = f.refresh(), before = structuredClone(initial), preview = previewChapterTransition(f.world, initial.state, "next");
    expect(progressionEventAvailability(f.world, initial.state, "hello").enabled).toBe(true);
    expect(preview.lostOpportunities.some((e) => e.id === "hello")).toBe(false);
    expect(initial).toEqual(before);
    const next = f.act(initial, { kind: "chapter-transition", id: "next", previewFingerprint: preview.fingerprint });
    expect(progressionEventAvailability(f.world, next.state, "hello")).toMatchObject({ enabled: false, reason: "Complete the required encounter first" });
    const finished = f.act(next, { kind: "event", id: "urgent" });
    expect(progressionEventAvailability(f.world, finished.state, "hello").enabled).toBe(true);
  });
});
