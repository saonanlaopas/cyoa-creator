import { describe, expect, it } from "vitest";
import {
  actNativePlayerWorld, chooseNativeGameChoice, chooseNativePlayerSession, compiledRuntimeFingerprint, createNativePlayerConfig,
  createNativePlayerSave, createNativePlayerSession, initialWorldState, listNativeGameChoices, loadNativeGame, loadNativePlayerSave, mandatoryEventStatus,
  nativeBundleFingerprint, nativePlayerView, previewChapterTransition, previewWorldSuppressions, restartNativePlayerSession,
  rewindNativePlayerSession, type WorldCommand,
} from "../src/index.js";
import { economyFixture } from "./economy-fixture.js";

function fixture() {
  const f = economyFixture();
  const { bundle, world, progression, economy } = f;
  const full = structuredClone(bundle);
  const { runtime } = loadNativeGame(bundle);
  const stopPassageId = "passage-1";
  const encounter = progression.events.find(event => event.id === "hello")!;
  encounter.passageId = stopPassageId;
  encounter.minutes = 3;
  encounter.prerequisites = [];
  economy.items.find(item => item.id === "tea")!.initial = 1;
  const chapter = progression.transitions[0]!;
  chapter.prerequisites = [];
  chapter.passageId = stopPassageId;
  world.connections.push({ id: "cafe-home", from: "cafe", to: "home", minutes: 15 });
  // A newly available mandatory encounter must not replace the stop or fire automatically.
  f.people.events.find(item => item.eventId === "urgent")!.mandatory = true;
  f.people.overrides.push({ id: "mara-at-cafe", characterId: "mara", locationId: "cafe", priority: 20,
    prerequisites: [{ kind: "location", locationId: "cafe", present: true }] });
  world.actions.push({ id: "read-board", locationId: "cafe", label: "Read board", minutes: 5, result: "Last train at dawn." });
  bundle.initialState.world = initialWorldState(world);
  bundle.gameId = "game-partial-preview";
  bundle.preview = {
    stopPassageId,
    suppressedChoices: bundle.choices.filter(choice => choice.sourcePassageId === stopPassageId)
      .map(({ id, destinationPassageId }) => ({ id, destinationPassageId })),
    suppressedWorldCommands: previewWorldSuppressions(world),
  };
  bundle.choices = bundle.choices.filter(choice => choice.sourcePassageId !== stopPassageId);
  bundle.passages.find(item => item.id === stopPassageId)!.choiceIds = [];
  runtime.passages[stopPassageId]!.choiceIds = [];
  for (const choice of bundle.preview.suppressedChoices) delete runtime.choices[choice.id];
  bundle.runtimeFingerprint = compiledRuntimeFingerprint(runtime);
  bundle.bundleFingerprint = nativeBundleFingerprint(bundle);
  const config = createNativePlayerConfig({ gameId: bundle.gameId, rewindPolicy: { kind: "previous-step" } }, bundle);
  return { bundle, config, world, full, initial: createNativePlayerSession(bundle, config), stopPassageId };
}

describe("partial preview runtime boundary", () => {
  it.each(["choice", "travel", "event", "chapter-transition"] as const)("preserves the normal %s entry and blocks every post-stop dispatch after reload", (entry) => {
    const { bundle, config, world, full, initial, stopPassageId } = fixture();
    const entering: WorldCommand = entry === "event" ? { kind: entry, id: "hello" } :
      entry === "chapter-transition" ? { kind: entry, id: "next", previewFingerprint: previewChapterTransition(world, initial.state, "next").fingerprint } :
        { kind: "travel", id: "home-cafe" };
    const session = entry === "choice"
      ? chooseNativePlayerSession(bundle, config, initial, "choice-0").session
      : actNativePlayerWorld(bundle, config, initial, entering).session;
    expect(session.state).toMatchObject({
      currentPassageId: stopPassageId, visitCounts: { "passage-0": 1, "passage-1": 1 }, turn: 1,
      world: { locationId: "cafe", minutes: { choice: 1430, travel: 1445, event: 1433, "chapter-transition": 1435 }[entry] },
      stats: { resolve: entry === "choice" ? 1 : 0 },
      resources: { supplies: entry === "choice" ? 4 : 5 },
    });
    if (entry === "event") expect(session.state.world).toMatchObject({
      progression: { milestones: ["clue"], events: { hello: { count: 1 } } }, economy: { currency: 25, items: { tea: 0 } },
    });
    if (entry === "chapter-transition") expect(session.state.world!.progression).toMatchObject({ chapterId: "second", transitions: { next: 1 } });
    if (entry === "travel") expect(mandatoryEventStatus(world, session.state)).toEqual({ eventId: "urgent", conflict: false });
    const loaded = loadNativePlayerSave(bundle, config, createNativePlayerSave(bundle, config, session));
    const before = structuredClone(loaded);
    expect(loaded.state).toEqual(session.state);
    const view = nativePlayerView(bundle, config, loaded);
    expect(view).toMatchObject({ previewStopped: true, choices: [], passage: { proseMarkdown: "Exact prose 1." }, terminal: { result: null } });
    const game = loadNativeGame(bundle);
    expect(listNativeGameChoices(game, loaded.state)).toEqual([]);
    expect(() => chooseNativeGameChoice(game, loaded.state, "choice-1")).toThrow("native_preview_stop_reached");
    expect(() => chooseNativePlayerSession(bundle, config, loaded, "choice-0")).toThrow("native_preview_stop_reached");
    const commands: WorldCommand[] = [
      { kind: "travel", id: "cafe-home" }, { kind: "action", id: "read-board" }, { kind: "wait", minutes: 5 },
      { kind: "event", id: "urgent" }, { kind: "chapter-transition", id: "next", previewFingerprint: "0".repeat(32) },
      { kind: "purchase", id: "buy-tea" }, { kind: "gift", id: "gift-tea" }, { kind: "use", id: "drink-tea" },
    ];
    for (const command of commands) expect(() => actNativePlayerWorld(bundle, config, loaded, command)).toThrow("native_preview_stop_reached");
    expect(loaded).toEqual(before);
    expect(rewindNativePlayerSession(bundle, config, loaded).state).toEqual(initial.state);
    expect(restartNativePlayerSession(bundle, config).state).toEqual(initial.state);
    const fullConfig = createNativePlayerConfig({ gameId: full.gameId }, full);
    expect(() => loadNativePlayerSave(full, fullConfig, createNativePlayerSave(bundle, config, loaded))).toThrow();
  });

  it("rejects a resealed bundle with a missing World suppression or a forged ending", () => {
    for (const tamper of [
      (bundle: ReturnType<typeof fixture>["bundle"]) => bundle.preview!.suppressedWorldCommands.pop(),
      (bundle: ReturnType<typeof fixture>["bundle"]) => { bundle.preview!.stopPassageId = "passage-4"; },
    ]) {
      const { bundle } = fixture();
      tamper(bundle);
      bundle.bundleFingerprint = nativeBundleFingerprint(bundle);
      expect(() => loadNativeGame(bundle)).toThrow(expect.objectContaining({
        findings: expect.arrayContaining([expect.objectContaining({ code: "native.bundle.preview-invalid" })]),
      }));
    }
  });
});
