import { progressionFixture } from "./progression-fixture.js";
import type { NativePeople } from "../src/people.js";
export function peopleFixture() {
  const f = progressionFixture();
  f.progression.events = [
    { ...f.progression.events[1]!, id: "hello", label: "Speak with Mara", prerequisites: [], visibility: "when-available", minutes: 0 },
    { ...f.progression.events[1]!, id: "urgent", label: "Hear the warning", prerequisites: [{ kind: "time", from: 1440, until: 1450 }], visibility: "when-available", minutes: 0, milestoneIds: ["clue"] },
    { ...f.progression.events[1]!, id: "second", label: "Answer the signal", prerequisites: [{ kind: "time", from: 1440, until: 1450 }], visibility: "when-available", minutes: 0 },
  ];
  f.progression.transitions[0]!.expireEventIds = [];
  const people: NativePeople = { schemaId: "cyoa.native-people", schemaVersion: 1,
    characters: [{ id: "mara", name: "Mara" }, { id: "ivo", name: "Ivo" }],
    schedules: [
      { id: "night", characterId: "mara", locationId: "home", days: [0, 1, 2, 3, 4, 5, 6], from: 1435, until: 10 },
      { id: "station", characterId: "mara", locationId: "station", days: [0, 1, 2, 3, 4, 5, 6], from: 10, until: 60 },
      { id: "fleeting", characterId: "ivo", locationId: "home", days: [0], from: 1432, until: 1434 },
    ], overrides: [], events: [
      { eventId: "hello", priority: 0, mandatory: false, characterIds: ["mara"] },
      { eventId: "urgent", priority: 20, mandatory: true, characterIds: ["mara"] },
      { eventId: "second", priority: 10, mandatory: true, characterIds: ["mara"] },
    ] };
  f.world.people = people;
  f.world.connections.push({ id: "home-station", from: "home", to: "station", minutes: 20 });
  f.world.actions.push({ id: "long-task", locationId: "home", label: "Work", minutes: 60, result: "Finished." });
  return { ...f, people, initial: f.refresh() };
}
