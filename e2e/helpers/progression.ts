import type { WorldDefinition } from "../../packages/domain/src/world-definition.js";
import type { FoundationCall } from "./original-foundations.js";

export async function withAuthoredProgression(call: FoundationCall, projectId: string, world: WorldDefinition): Promise<WorldDefinition> {
  const station = { passageId: "passage-route-1-act", versionId: (await call("read_game_record", { projectId, kind: "passage", entityId: "passage-route-1-act" })).record.id };
  return { ...world, waitMinutes: [5, 15, 60, 1440], progression: { schemaId: "cyoa.world-progression", schemaVersion: 1,
    chapters: [{ id: "first", name: "Before dawn", final: false }, { id: "second", name: "After the crossing", final: true }], initialChapterId: "first",
    milestones: [{ id: "clue", name: "Signal clue" }, { id: "temporary", name: "Last conversation" }], initialMilestoneIds: [],
    events: [
      { id: "notice", label: "Read the signal notice", prerequisites: [{ kind: "chapter", chapterId: "first", current: true }, { kind: "location", locationId: "home", present: true }, { kind: "time", from: 1430, until: 1445 }], repeat: { kind: "once" }, visibility: "always", passage: null, minutes: 5, milestoneIds: ["clue", "temporary"], result: "The signal clue is recorded." },
      { id: "conversation", label: "A last conversation", prerequisites: [{ kind: "chapter", chapterId: "first", current: true }], repeat: { kind: "once" }, visibility: "always", passage: null, minutes: 0, milestoneIds: [], result: "A quiet farewell." },
      { id: "bell", label: "Listen to the daily bell", prerequisites: [], repeat: { kind: "once-per-day" }, visibility: "always", passage: null, minutes: 0, milestoneIds: [], result: "A bell rings." },
      { id: "check-in", label: "Chapter check-in", prerequisites: [], repeat: { kind: "once-per-chapter" }, visibility: "always", passage: null, minutes: 0, milestoneIds: [], result: "A new beginning." },
      { id: "rest", label: "Rest", prerequisites: [], repeat: { kind: "repeatable", cooldownMinutes: 15 }, visibility: "always", passage: null, minutes: 0, milestoneIds: [], result: "A pause." },
      { id: "crossing", label: "Remember the crossing", prerequisites: [{ kind: "chapter", chapterId: "second", current: true }, { kind: "milestone", milestoneId: "clue", achieved: true }, { kind: "location", locationId: "station", present: true }, { kind: "time", from: 1440, until: null }], repeat: { kind: "once" }, visibility: "when-available", passage: null, minutes: 0, milestoneIds: [], result: "The crossing is remembered." },
    ], transitions: [{ id: "next", label: "Begin the next chapter", fromChapterId: "first", toChapterId: "second", prerequisites: [{ kind: "milestone", milestoneId: "clue", achieved: true }], carryMilestoneIds: ["clue"], expireEventIds: ["conversation"], passage: station, minutes: 5, result: "A new chapter begins at the station." }],
  } };
}
