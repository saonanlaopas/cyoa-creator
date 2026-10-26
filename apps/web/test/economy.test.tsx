// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import type { WorldDefinition } from "@story-to-cyoa/domain";
import { MemoryNativePlayerStorage, createNativePlayerInstallation } from "@story-to-cyoa/runtime";
import { EconomyEditor } from "../src/features/workspace/EconomyEditor.js";
import { ProgressionEditor, WorldConditionOptionsContext } from "../src/features/workspace/ProgressionEditor.js";
import { PeopleEditor } from "../src/features/workspace/PeopleEditor.js";
import { WorldWorkspace } from "../src/features/workspace/WorldWorkspace.js";
import { NativePlayer } from "../src/features/player/NativePlayer.js";
import { WorldPanel } from "../src/features/player/WorldPanel.js";
import { economyFixture } from "../../../packages/runtime/test/economy-fixture.js";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const relationships = [{ key: "trust", label: "Trust with Mara", minimum: 0, maximum: 5, initial: 0 }];
function authored(): WorldDefinition {
  const f = economyFixture(), { schemaId: _id, assets: _assets, progression: p, people, economy: e, ...world } = f.world;
  const { schemaId: _eid, relationships: _bindings, ...economy } = e!;
  const ref = (passageId: string | null) => passageId ? { passageId, versionId: `pv-${passageId}` } : null;
  return { ...world, schemaId: "cyoa.world-definition", enabled: true, economy: { ...economy, schemaId: "cyoa.world-economy" },
    locations: world.locations.map(({ passageId, ...l }) => ({ ...l, passage: ref(passageId), mapImage: null })),
    progression: { ...p!, schemaId: "cyoa.world-progression", events: p!.events.map(({ passageId, ...r }) => ({ ...r, passage: ref(passageId) })), transitions: p!.transitions.map(({ passageId, ...r }) => ({ ...r, passage: ref(passageId) })) },
    people: { ...people!, schemaId: "cyoa.world-people" } };
}
function Editors({ initial, changed }: { initial: WorldDefinition; changed: (w: WorldDefinition) => void }) {
  const [world, setWorld] = useState(initial);
  const edit = (w: WorldDefinition) => { changed(w); setWorld(w); };
  return <WorldConditionOptionsContext.Provider value={{ world, economy: world.economy, relationships }}>
    <EconomyEditor world={world} onChange={(economy) => edit({ ...world, economy })} />
    <ProgressionEditor progression={world.progression} people={world.people} locations={world.locations} passages={[]} onChange={(progression) => edit({ ...world, progression })} />
    <PeopleEditor world={world} onChange={(people) => edit({ ...world, people })} />
  </WorldConditionOptionsContext.Provider>;
}
it("authors explicit quantities, prices, hours, repeat rules and canonical relationship effects through structured controls", async () => {
  let latest = authored(); render(<Editors initial={latest} changed={(w) => { latest = w; }} />); const user = userEvent.setup();
  await user.clear(screen.getByLabelText("Starting currency")); await user.type(screen.getByLabelText("Starting currency"), "15");
  await user.clear(screen.getByLabelText("Shop 1 offer 1 price")); await user.type(screen.getByLabelText("Shop 1 offer 1 price"), "3");
  await user.clear(screen.getByLabelText("Shop 1 closes")); await user.type(screen.getByLabelText("Shop 1 closes"), "90");
  await user.selectOptions(screen.getByLabelText("Gift 1 repeat"), "once-per-day");
  await user.clear(screen.getByLabelText("Gift 1 relationship change 1")); await user.type(screen.getByLabelText("Gift 1 relationship change 1"), "2");
  await user.click(screen.getByRole("button", { name: "Add use 1 item effect", exact: true }));
  expect(latest.economy).toMatchObject({ currency: { initial: 15 }, shops: [{ hours: { closes: 90 }, offers: [expect.objectContaining({ price: 3 }), expect.anything()] }], gifts: [expect.objectContaining({ repeat: { kind: "once-per-day" }, effects: expect.objectContaining({ relationships: [{ key: "trust", delta: 2 }] }) })], uses: [expect.objectContaining({ effects: expect.objectContaining({ items: [{ itemId: "tea", delta: 1 }] }) })] });
});
it("blocks referenced-item deletion until the author clears each visible rule and prerequisite", async () => {
  let latest = authored(); render(<Editors initial={latest} changed={(w) => { latest = w; }} />); const user = userEvent.setup();
  const remove = screen.getByRole("button", { name: "Remove item 1", exact: true });
  expect((remove as HTMLButtonElement).disabled).toBe(true);
  expect(document.getElementById(remove.getAttribute("aria-describedby")!)?.textContent).toContain("Shop 1 offer 1");
  await user.click(screen.getByRole("button", { name: "Remove gift 1", exact: true }));
  await user.click(screen.getByRole("button", { name: "Remove use 1", exact: true }));
  await user.click(screen.getByRole("button", { name: "Remove shop 1 offer 1", exact: true }));
  await user.click(screen.getByRole("button", { name: "Remove event transaction 1", exact: true }));
  await user.click(screen.getByRole("button", { name: "Remove Event 1 prerequisite 1", exact: true }));
  expect((remove as HTMLButtonElement).disabled).toBe(false); await user.click(remove);
  expect(latest.economy!.items.map((i) => i.id)).toEqual(["ticket"]);
});
it("keeps referenced people, chapters, milestones and event rules repairable and prevents unsafe disabling", () => {
  const world = authored(); world.economy!.gifts[0]!.prerequisites = [{ kind: "chapter", chapterId: "first", current: true }]; world.economy!.gifts[0]!.effects.milestoneIds = ["clue"];
  render(<Editors initial={world} changed={vi.fn()} />);
  for (const name of ["Remove person 1", "Remove chapter 1", "Remove milestone 1", "Remove event 1"]) expect((screen.getByRole("button", { name, exact: true }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.getElementById(screen.getByRole("button", { name: "Remove event 1", exact: true }).getAttribute("aria-describedby")!)?.textContent).toContain("Event transaction 1");
  for (const label of ["People and schedules enabled", "Chapters and events enabled", "Inventory and shops enabled"]) expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
});
it("invalidates trade reviews after edits and uses the identical Apply UUID when a response is lost", async () => {
  const world = authored(), applied: any[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, options) => {
    const tool = String(path).split("/").at(-1), body = options?.body ? JSON.parse(String(options.body)) : null;
    if (tool === "read_world") return response({ world, relationshipOptions: relationships });
    if (String(path).endsWith("passage-plan")) return response({ passages: [] });
    if (tool === "review_world") return response({ world: body.world, previous: world, fingerprint: "a".repeat(64) });
    if (tool === "apply_world") { applied.push(body); if (applied.length === 1) throw new Error("Lost response"); return response({ versionId: "w4" }); }
    return response({ items: [], total: 0 });
  });
  const user = userEvent.setup(); render(<WorldWorkspace projectId="p" />);
  await user.click(await screen.findByRole("button", { name: "Review world", exact: true })); await user.click(screen.getByLabelText("I approve this exact world and time definition."));
  await user.clear(screen.getByLabelText("Shop 1 offer 1 price")); await user.type(screen.getByLabelText("Shop 1 offer 1 price"), "3");
  expect(screen.queryByRole("button", { name: "Apply world" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Review world", exact: true })); await user.click(screen.getByLabelText("I approve this exact world and time definition."));
  await user.click(screen.getByRole("button", { name: "Apply world" })); await screen.findByRole("alert");
  await user.click(screen.getByRole("button", { name: "Apply world" })); await waitFor(() => expect(applied).toHaveLength(2));
  expect(applied[0]).toEqual(applied[1]); expect(applied[0].world.economy.shops[0].offers[0].price).toBe(3);
});
it("keeps trade navigation and cancellation free, then consumes exactly one purchase and one use", async () => {
  const f = economyFixture(), storage = new MemoryNativePlayerStorage(), user = userEvent.setup(); await storage.install(createNativePlayerInstallation(f.bundle, f.config)); const write = vi.spyOn(storage, "writeAutosave");
  render(<NativePlayer route={{ gameId: f.bundle.gameId, bundleFingerprint: f.bundle.bundleFingerprint, debug: false }} storage={storage} />);
  await user.click(await screen.findByRole("button", { name: "Shops here", exact: true }));
  const buy = screen.getByRole("button", { name: "Buy 1 Tea · 4 Coins · 2 min", exact: true });
  await user.click(buy); await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  expect(write).not.toHaveBeenCalled(); expect(screen.getByLabelText("Game time").textContent).toBe("Day 1 · 23:50");
  await user.click(buy); await user.click(screen.getByRole("button", { name: "Confirm action", exact: true }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole("button", { name: "Inventory", exact: true }));
  expect(screen.queryByRole("region", { name: "Local shops", exact: true })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Drink tea · 1 Tea · 1 min · Gain 1 Coins", exact: true })); await user.click(screen.getByRole("button", { name: "Confirm action", exact: true }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(2)); expect(write.mock.calls[1]![2].state.world!.economy).toMatchObject({ currency: 17, items: { tea: 0 }, receipts: { "buy-tea": { count: 1 }, "drink-tea": { count: 1 } } });
});
it("retries a failed purchase autosave without charging again or consuming stock twice", async () => {
  const f = economyFixture(), storage = new MemoryNativePlayerStorage(), user = userEvent.setup(); await storage.install(createNativePlayerInstallation(f.bundle, f.config)); const write = vi.spyOn(storage, "writeAutosave").mockRejectedValueOnce(new Error("Save failed"));
  render(<NativePlayer route={{ gameId: f.bundle.gameId, bundleFingerprint: f.bundle.bundleFingerprint, debug: false }} storage={storage} />);
  await user.click(await screen.findByRole("button", { name: "Shops here", exact: true })); await user.click(screen.getByRole("button", { name: "Buy 1 Tea · 4 Coins · 2 min", exact: true })); await user.click(screen.getByRole("button", { name: "Confirm action", exact: true }));
  expect((await screen.findByRole("alert")).textContent).toContain("not saved"); await user.click(screen.getByRole("button", { name: "Retry autosave", exact: true }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull()); expect(write).toHaveBeenCalledTimes(2); expect(write.mock.calls[0]![2].state).toEqual(write.mock.calls[1]![2].state);
  expect(write.mock.calls[1]![2].state.world!.economy).toMatchObject({ currency: 16, receipts: { "buy-tea": { count: 1 } } });
});
it("lets players inspect trade screens freely while a required encounter blocks trade actions", async () => {
  const f = economyFixture(); f.people.events[1]!.mandatory = true; const pending = f.act(f.refresh(), { kind: "wait", minutes: 15 }), onAction = vi.fn(), user = userEvent.setup();
  render(<WorldPanel world={f.world} state={pending.state} disabled={false} onAction={onAction} />);
  await user.click(screen.getByRole("button", { name: "Shops here", exact: true }));
  expect((screen.getByRole("button", { name: "Buy 1 Tea · 4 Coins · 2 min", exact: true }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getAllByText("Complete the required encounter first").length).toBeGreaterThan(0); expect(onAction).not.toHaveBeenCalled();
});
