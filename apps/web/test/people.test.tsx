// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { emptyWorldPeople, type WorldDefinition } from "@story-to-cyoa/domain";
import { PeopleEditor } from "../src/features/workspace/PeopleEditor.js";
import { ProgressionEditor } from "../src/features/workspace/ProgressionEditor.js";
import { WorldWorkspace } from "../src/features/workspace/WorldWorkspace.js";
import { NativePlayer } from "../src/features/player/NativePlayer.js";
import { WorldPanel } from "../src/features/player/WorldPanel.js";
import { MemoryNativePlayerStorage, createNativePlayerInstallation } from "@story-to-cyoa/runtime";
import { peopleFixture } from "../../../packages/runtime/test/people-fixture.js";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
function authored(): WorldDefinition {
  const f = peopleFixture(), { schemaId: _id, assets: _assets, progression: p, people, ...world } = f.world;
  const ref = (passageId: string | null) => passageId ? { passageId, versionId: `pv-${passageId}` } : null;
  return { ...world, schemaId: "cyoa.world-definition", enabled: true,
    locations: world.locations.map(({ passageId, ...l }) => ({ ...l, passage: ref(passageId), mapImage: null })),
    progression: { ...p!, schemaId: "cyoa.world-progression", events: p!.events.map(({ passageId, ...e }) => ({ ...e, passage: ref(passageId) })), transitions: p!.transitions.map(({ passageId, ...t }) => ({ ...t, passage: ref(passageId) })) },
    people: { ...people!, schemaId: "cyoa.world-people" } };
}
it("authors recurring days, overrides and explicit encounter priorities, with referenced-person deletion guards", async () => {
  let latest = authored();
  function Editor() { const [world, setWorld] = useState(latest); return <PeopleEditor world={world} onChange={(people) => { latest = { ...world, people }; setWorld(latest); }} />; }
  const user = userEvent.setup(); render(<Editor />);
  const remove = screen.getByRole("button", { name: "Remove person 1" });
  expect((remove as HTMLButtonElement).disabled).toBe(true);
  expect(document.getElementById(remove.getAttribute("aria-describedby")!)?.textContent).toContain("Remove the listed schedules/overrides");
  await user.clear(screen.getByLabelText("Person name 1")); await user.type(screen.getByLabelText("Person name 1"), "Mara Vale");
  await user.click(screen.getByLabelText("Schedule 1 Day 2"));
  await user.clear(screen.getByLabelText("Schedule 1 start minute")); await user.type(screen.getByLabelText("Schedule 1 start minute"), "1436");
  await user.click(screen.getByRole("button", { name: "Add story override" }));
  await user.selectOptions(screen.getByLabelText("Override 1 placement"), "cafe");
  await user.click(screen.getByRole("button", { name: "Add override 1 prerequisite" }));
  await user.clear(screen.getByLabelText("Encounter 2 priority")); await user.type(screen.getByLabelText("Encounter 2 priority"), "30");
  expect(latest.people!.schedules[0]).toMatchObject({ from: 1436, days: [0, 2, 3, 4, 5, 6] });
  expect(latest.people!.overrides[0]).toMatchObject({ locationId: "cafe", prerequisites: [{ kind: "milestone", milestoneId: "clue", achieved: true }] });
  expect(latest.people!.events[1]!.priority).toBe(30);
});
it("guards chapter/milestone override references and progression disabling until explicit cleanup", async () => {
  const world = authored(); world.people!.overrides = [{ id: "story", characterId: "mara", locationId: null, priority: 10, prerequisites: [{ kind: "chapter", chapterId: "first", current: true }, { kind: "milestone", milestoneId: "clue", achieved: true }] }];
  render(<ProgressionEditor progression={world.progression} people={world.people} onChange={vi.fn()} locations={world.locations} passages={[]} />);
  expect((screen.getByRole("button", { name: "Remove chapter 1" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText("Chapters and events enabled") as HTMLInputElement).disabled).toBe(true);
  const remove = screen.getByRole("button", { name: "Remove milestone 1" });
  expect(document.getElementById(remove.getAttribute("aria-describedby")!)?.textContent).toContain("Story override 1");
});
it("synchronizes owned event rules on event deletion/addition and clears reviewed consent on people edits", async () => {
  let world = authored(); world.people = { ...emptyWorldPeople(), events: world.progression!.events.map((e) => ({ eventId: e.id, priority: 0, mandatory: false, characterIds: [] })) };
  let proposed: WorldDefinition | undefined;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, options) => {
    const tool = String(path).split("/").at(-1), input = options?.body ? JSON.parse(String(options.body)) : null;
    if (tool === "read_world") return response({ world });
    if (String(path).endsWith("passage-plan")) return response({ passages: [] });
    if (tool === "review_world") { proposed = input.world; return response({ world: input.world, previous: world, fingerprint: "a".repeat(64) }); }
    return response({ items: [], total: 0 });
  });
  const user = userEvent.setup(); render(<WorldWorkspace projectId="p" />);
  await user.click(await screen.findByRole("button", { name: "Remove event 1", exact: true }));
  await user.click(screen.getByRole("button", { name: "Review world" }));
  expect(proposed!.people!.events.map((r) => r.eventId)).toEqual(proposed!.progression!.events.map((e) => e.id));
  await user.click(screen.getByLabelText("I approve this exact world and time definition."));
  await user.click(screen.getByRole("button", { name: "Add event", exact: true }));
  expect(screen.queryByRole("button", { name: "Apply world" })).toBeNull();
  await user.type(screen.getByLabelText("Event label 3"), "New harbor encounter");
  await user.type(screen.getByLabelText("Event result 3"), "A quiet greeting.");
  await user.click(screen.getByRole("button", { name: "Review world" }));
  expect(proposed!.people!.events.map((r) => r.eventId)).toEqual(proposed!.progression!.events.map((e) => e.id));
  expect(proposed!.people!.events.at(-1)).toMatchObject({ priority: 0, mandatory: false, characterIds: [] });
  await user.click(screen.getByLabelText("I approve this exact world and time definition."));
  await user.click(screen.getByRole("button", { name: "Add person" }));
  expect(screen.queryByRole("button", { name: "Apply world" })).toBeNull();
});
it("projects current people and known encounters without schedules or future destinations, and disables non-required actions", async () => {
  const f = peopleFixture(), next = f.act(f.initial, { kind: "wait", minutes: 60 }), user = userEvent.setup(), onAction = vi.fn();
  render(<WorldPanel world={f.world} state={next.state} disabled={false} onAction={onAction} />);
  expect(screen.getByRole("region", { name: "People present" }).textContent).toBe("Here now: Mara");
  expect(screen.queryByText(/Schedule|Override|1435|1450/)).toBeNull();
  expect((screen.getByRole("button", { name: "Wait 5 min" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: /Answer the signal/ }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Hear the warning · 0 min" }));
  expect(onAction).toHaveBeenCalledWith({ kind: "event", id: "urgent" }, "Hear the warning (0 min)");
});
it("stops actual player waiting at a required boundary, resumes saved priority order, and retries autosave without replaying effects", async () => {
  const f = peopleFixture(), storage = new MemoryNativePlayerStorage(), user = userEvent.setup();
  await storage.install(createNativePlayerInstallation(f.bundle, f.config));
  const write = vi.spyOn(storage, "writeAutosave");
  render(<NativePlayer route={{ gameId: f.bundle.gameId, bundleFingerprint: f.bundle.bundleFingerprint, debug: false }} storage={storage} />);
  await user.click(await screen.findByRole("button", { name: "Wait 60 min" })); await user.click(screen.getByRole("button", { name: "Confirm action" }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1)); expect(screen.getByLabelText("Game time").textContent).toBe("Day 2 · 00:00");
  expect((screen.getByRole("button", { name: "Continue 1" }) as HTMLButtonElement).disabled).toBe(true);
  write.mockRejectedValueOnce(new Error("Save failed"));
  await user.click(screen.getByRole("button", { name: "Hear the warning · 0 min" })); await user.click(screen.getByRole("button", { name: "Confirm action" }));
  expect((await screen.findByRole("alert")).textContent).toContain("not saved");
  await user.click(screen.getByRole("button", { name: "Retry autosave" })); await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(write).toHaveBeenCalledTimes(3); expect(write.mock.calls[1]![2].state).toEqual(write.mock.calls[2]![2].state);
  expect(write.mock.calls[2]![2].state.world!.progression!.events.urgent!.count).toBe(1);
});
