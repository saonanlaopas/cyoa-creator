import { actNativePlayerWorld, createNativePlayerConfig, createNativePlayerSession, initialWorldState, nativeBundleFingerprint,
  type NativeWorld, type NativeProgression, type WorldCommand } from "../src/index.js";
import { playerFixture } from "./native-player-fixture.js";

export function progressionFixture() {
  const bundle = playerFixture(5);
  const progression: NativeProgression = { schemaId: "cyoa.native-progression", schemaVersion: 1,
    chapters: [{ id: "first", name: "Before dawn", final: false }, { id: "second", name: "After the crossing", final: true }], initialChapterId: "first",
    milestones: [{ id: "clue", name: "Signal clue" }, { id: "temporary", name: "Last conversation" }], initialMilestoneIds: [],
    events: [
      { id: "notice", label: "Read the signal notice", prerequisites: [{ kind: "chapter", chapterId: "first", current: true }, { kind: "location", locationId: "home", present: true }, { kind: "time", from: 1430, until: 1445 }], repeat: { kind: "once" }, visibility: "always", passageId: null, minutes: 5, milestoneIds: ["clue", "temporary"], result: "The signal clue is recorded." },
      { id: "conversation", label: "A last conversation", prerequisites: [{ kind: "chapter", chapterId: "first", current: true }], repeat: { kind: "once" }, visibility: "always", passageId: null, minutes: 0, milestoneIds: [], result: "A quiet farewell." },
      { id: "bell", label: "Listen to the daily bell", prerequisites: [], repeat: { kind: "once-per-day" }, visibility: "always", passageId: null, minutes: 0, milestoneIds: [], result: "A bell rings." },
      { id: "check-in", label: "Chapter check-in", prerequisites: [], repeat: { kind: "once-per-chapter" }, visibility: "always", passageId: null, minutes: 0, milestoneIds: [], result: "A new beginning." },
      { id: "rest", label: "Rest", prerequisites: [], repeat: { kind: "repeatable", cooldownMinutes: 15 }, visibility: "always", passageId: null, minutes: 0, milestoneIds: [], result: "A pause." },
      { id: "crossing", label: "Remember the crossing", prerequisites: [{ kind: "chapter", chapterId: "second", current: true }, { kind: "milestone", milestoneId: "clue", achieved: true }, { kind: "location", locationId: "station", present: true }, { kind: "time", from: 1440, until: null }], repeat: { kind: "once" }, visibility: "when-available", passageId: null, minutes: 0, milestoneIds: [], result: "The crossing is remembered." },
    ],
    transitions: [{ id: "next", label: "Begin the next chapter", fromChapterId: "first", toChapterId: "second", prerequisites: [{ kind: "milestone", milestoneId: "clue", achieved: true }], carryMilestoneIds: ["clue"], expireEventIds: ["conversation"], passageId: "passage-2", minutes: 5, result: "A new chapter begins at the station." }],
  };
  const world: NativeWorld = { schemaId: "cyoa.native-world", schemaVersion: 1, startLocationId: "home", initialMinutes: 1430, waitMinutes: [5, 15, 60, 1440],
    locations: ["home", "cafe", "station"].map((id, index) => ({ id, name: id, parentId: null, passageId: `passage-${index}`, mapImage: null, marker: null, hours: null })),
    connections: [{ id: "home-cafe", from: "home", to: "cafe", minutes: 15 }], actions: [], assets: [], progression };
  bundle.world = world; bundle.initialState.world = initialWorldState(world); bundle.bundleFingerprint = nativeBundleFingerprint(bundle);
  const config = createNativePlayerConfig({ gameId: bundle.gameId, rewindPolicy: { kind: "bounded-last-n", steps: 20 } }, bundle);
  const initial = createNativePlayerSession(bundle, config);
  const refresh = () => { bundle.initialState.world = initialWorldState(world); bundle.bundleFingerprint = nativeBundleFingerprint(bundle); return createNativePlayerSession(bundle, config); };
  const act = (session: typeof initial, command: WorldCommand) => actNativePlayerWorld(bundle, config, session, command).session;
  return { bundle, world, progression, config, initial, refresh, act };
}
