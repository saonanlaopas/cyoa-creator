import type { WorldDefinition } from "../../packages/domain/src/world-definition.js";
import type { FoundationCall } from "./original-foundations.js";
import { withAuthoredProgression } from "./progression.js";
export async function withAuthoredPeople(call: FoundationCall, projectId: string, world: WorldDefinition): Promise<WorldDefinition> {
  const base = await withAuthoredProgression(call, projectId, world), p = base.progression!, event = p.events[1]!;
  p.milestones[1]!.name = "Invitation";
  p.events = [
    { ...event, id: "hello", label: "Speak with Mara", prerequisites: [], visibility: "when-available", milestoneIds: ["temporary"] },
    { ...event, id: "urgent", label: "Hear the midnight warning", prerequisites: [{ kind: "time", from: 1440, until: 1450 }], visibility: "when-available", milestoneIds: ["clue"] },
    { ...event, id: "answer", label: "Answer the midnight signal", prerequisites: [{ kind: "time", from: 1440, until: 1450 }], visibility: "when-available" },
    { ...event, id: "fleeting", label: "Greet Ivo", prerequisites: [], visibility: "when-available" },
    { ...event, id: "cafe-talk", label: "Discuss the clue", prerequisites: [{ kind: "location", locationId: "cafe", present: true }, { kind: "milestone", milestoneId: "clue", achieved: true }], visibility: "when-available" },
    { ...event, id: "crossing", label: "Remember the crossing", prerequisites: [{ kind: "chapter", chapterId: "second", current: true }, { kind: "location", locationId: "station", present: true }], visibility: "when-available" },
  ];
  p.events.forEach((e) => { e.result = ({ hello: "Mara invites you to the cafe.", urgent: "Mara shares the midnight warning.", answer: "You answer the signal before it fades.", fleeting: "Ivo offers a quick greeting.", "cafe-talk": "You compare the signal clue over coffee.", crossing: "Mara recalls the crossing." } as Record<string, string>)[e.id]!; });
  p.transitions[0]!.expireEventIds = ["fleeting"];
  return { ...base, people: { schemaId: "cyoa.world-people", schemaVersion: 1,
    characters: [{ id: "mara", name: "Mara" }, { id: "ivo", name: "Ivo" }],
    schedules: [
      { id: "night", characterId: "mara", locationId: "home", days: [0, 1, 2, 3, 4, 5, 6], from: 1435, until: 10 },
      { id: "station", characterId: "mara", locationId: "station", days: [0, 1, 2, 3, 4, 5, 6], from: 10, until: 60 },
      { id: "fleeting", characterId: "ivo", locationId: "home", days: [0], from: 1432, until: 1434 },
    ], overrides: [
      { id: "invitation", characterId: "mara", locationId: "cafe", priority: 10, prerequisites: [{ kind: "milestone", milestoneId: "temporary", achieved: true }, { kind: "chapter", chapterId: "first", current: true }] },
      { id: "after-crossing", characterId: "mara", locationId: "station", priority: 20, prerequisites: [{ kind: "chapter", chapterId: "second", current: true }] },
      { id: "absence", characterId: "mara", locationId: null, priority: 30, prerequisites: [{ kind: "chapter", chapterId: "second", current: true }, { kind: "time", from: 1530, until: 1540 }] },
    ], events: p.events.map((e) => ({ eventId: e.id, priority: e.id === "urgent" ? 20 : e.id === "answer" ? 10 : 0, mandatory: ["urgent", "answer"].includes(e.id), characterIds: [e.id === "fleeting" ? "ivo" : "mara"] })),
  } };
}
