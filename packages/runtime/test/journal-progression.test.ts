import { describe, expect, it } from "vitest";
import { journalFixture } from "./journal-fixture.js";
import { createNativePlayerSave, inspectWorldJournal, loadNativePlayerSave, previewChapterTransition, type WorldCommand } from "../src/index.js";

function fixture(kind: "event" | "chapter-transition", destination: "none" | "same" | "other") {
  const f = journalFixture();
  delete f.world.people; delete f.world.economy;
  f.progression.events[0]!.prerequisites = [];
  f.progression.events[0]!.milestoneIds = ["clue"];
  const action = kind === "event" ? f.progression.events[0]! : f.progression.transitions[0]!;
  action.prerequisites = []; action.minutes = 15;
  action.passageId = destination === "none" ? null : destination === "same" ? "passage-0" : "passage-2";
  f.journal.locations = []; f.journal.character = [];
  f.journal.entries = [{ id: "window", title: "Brief signal", text: "Recorded during the action.", when: [{ kind: "time", from: 1432, until: 1434 }, { kind: "chapter", chapterId: "first", current: true }] },
    { id: "premature", title: "Pre-effect state", text: "Must stay hidden.", when: [{ kind: "time", from: 1445, until: null }, kind === "event" ? { kind: "milestone", milestoneId: "clue", achieved: false } : { kind: "chapter", chapterId: "first", current: true }] },
    { id: "arrival", title: "Arrival", text: "Discovered at completion.", when: [{ kind: "time", from: 1445, until: null }, { kind: "location", locationId: destination === "other" ? "station" : "home", present: true }] }];
  f.journal.objectives = [{ id: "window", title: "Observe the signal", description: "A short opportunity.", when: [{ kind: "time", from: 1432, until: 1434 }], completeWhen: [{ kind: "time", from: 1433, until: 1434 }] }];
  const initial = f.refresh();
  const run = (s = initial) => {
    const command: WorldCommand = kind === "event" ? { kind, id: "hello" } : { kind, id: "next", previewFingerprint: previewChapterTransition(f.world, s.state, "next").fingerprint };
    return f.act(s, command);
  };
  return { ...f, initial, run };
}

describe("journal-only progression time boundaries", () => {
  it.each(["event", "chapter-transition"] as const)("records a short window during a 15-minute stationary %s, saves and replays", (kind) => {
    for (const destination of ["none", "same"] as const) {
      const f = fixture(kind, destination), before = structuredClone(f.initial), result = f.run();
      expect(f.world.people).toBeUndefined(); expect(f.world.economy).toBeUndefined();
      expect(result.state.world!.minutes).toBe(1445); expect(result.state.world!.locationId).toBe("home");
      expect(result.state.world!.journal!.entryIds).toEqual(["arrival", "window"]);
      expect(result.state.world!.journal!.revealedObjectiveIds).toEqual(["window"]);
      expect(result.state.world!.journal!.completedObjectiveIds).toEqual(["window"]);
      expect(inspectWorldJournal(f.world, result.state).completedObjectives).toEqual([{ id: "window", title: "Observe the signal" }]);
      expect(f.initial).toEqual(before); expect(f.run()).toEqual(result);
      const loadedInitial = loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, f.initial));
      expect(f.run(loadedInitial)).toEqual(result);
      expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, result))).toEqual(result);
    }
  });
  it.each(["event", "chapter-transition"] as const)("keeps a %s journey destination-only and completion discovery after effects", (kind) => {
    const f = fixture(kind, "other"), result = f.run();
    expect(result.state.world!.minutes).toBe(1445); expect(result.state.world!.locationId).toBe("station");
    expect(result.state.world!.journal!.entryIds).toEqual(["arrival"]);
    expect(result.state.world!.journal!.revealedObjectiveIds).toEqual([]);
    expect(result.state.world!.journal!.completedObjectiveIds).toEqual([]);
    expect(f.run()).toEqual(result);
    expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, result))).toEqual(result);
  });
  it.each(["event", "chapter-transition"] as const)("preserves legacy %s state with all three extensions absent", (kind) => {
    const f = fixture(kind, "none"); delete f.world.journal;
    const initial = f.refresh(), result = f.run(initial);
    expect(result.state.world!.minutes).toBe(1445); expect(result.state.world).not.toHaveProperty("journal");
    expect(result.state.world).not.toHaveProperty("people"); expect(result.state.world).not.toHaveProperty("economy");
    expect(loadNativePlayerSave(f.bundle, f.config, createNativePlayerSave(f.bundle, f.config, result))).toEqual(result);
  });
});
