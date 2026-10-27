// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import type { WorldDefinition } from "@story-to-cyoa/domain";
import { createNativePlayerInstallation, MemoryNativePlayerStorage } from "@story-to-cyoa/runtime";
import { journalFixture } from "../../../packages/runtime/test/journal-fixture.js";
import { JournalEditor } from "../src/features/workspace/JournalEditor.js";
import { EconomyEditor } from "../src/features/workspace/EconomyEditor.js";
import { ProgressionEditor, WorldConditionOptionsContext } from "../src/features/workspace/ProgressionEditor.js";
import { WorldWorkspace } from "../src/features/workspace/WorldWorkspace.js";
import { WorldPanel } from "../src/features/player/WorldPanel.js";
import { NativePlayer } from "../src/features/player/NativePlayer.js";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const f0 = journalFixture(), stats = f0.journal.mechanics.filter((m) => m.category === "stat"), relationships = f0.journal.mechanics.filter((m) => m.category === "relationship");
function authored(): WorldDefinition {
  const f = journalFixture(), { schemaId: _id, assets: _a, progression: p, people, economy: e, journal: j, ...w } = f.world;
  const { schemaId: _eid, relationships: _r, ...economy } = e!, { schemaId: _jid, mechanics: _m, ...journal } = j!;
  const ref = (id: string | null) => id ? { passageId: id, versionId: `pv-${id}` } : null;
  return { ...w, enabled: true, schemaId: "cyoa.world-definition", economy: { ...economy, schemaId: "cyoa.world-economy" }, journal: { ...journal, schemaId: "cyoa.world-journal" },
    people: { ...people!, schemaId: "cyoa.world-people" }, locations: w.locations.map(({ passageId, ...l }) => ({ ...l, mapImage: null, passage: ref(passageId) })),
    progression: { ...p!, schemaId: "cyoa.world-progression", events: p!.events.map(({ passageId, ...r }) => ({ ...r, passage: ref(passageId) })), transitions: p!.transitions.map(({ passageId, ...r }) => ({ ...r, passage: ref(passageId) })) } };
}
function Editors({ changed }: { changed: (w: WorldDefinition) => void }) {
  const [world, setWorld] = useState(authored()); const edit = (w: WorldDefinition) => { changed(w); setWorld(w); };
  return <WorldConditionOptionsContext.Provider value={{ world, economy: world.economy, relationships }}>
    <JournalEditor world={world} stats={stats} relationships={relationships} onChange={(journal) => edit({ ...world, journal })} />
    <EconomyEditor world={world} onChange={(economy) => edit({ ...world, economy })} />
    <ProgressionEditor progression={world.progression} locations={world.locations} people={world.people} passages={[]} onChange={(progression) => edit({ ...world, progression })} />
  </WorldConditionOptionsContext.Provider>;
}
it("authors canonical visibility, journal prose, objectives and structured stat/event triggers", async () => {
  let latest = authored(); const user = userEvent.setup(); render(<Editors changed={(w) => { latest = w; }} />);
  await user.click(screen.getByLabelText("Show Stat Resolve")); expect(latest.journal!.character.some((r) => r.category === "stat")).toBe(false);
  await user.click(screen.getByLabelText("Show Stat Resolve"));
  await user.click(screen.getByRole("button", { name: "Add journal entry", exact: true }));
  await user.type(screen.getByLabelText("Entry 4 title", { exact: true }), "A resolve note"); await user.type(screen.getByLabelText("Entry 4 text", { exact: true }), "Authored words only.");
  await user.click(screen.getByRole("button", { name: "Add entry 4 stat trigger", exact: true }));
  await user.clear(screen.getByLabelText("Entry 4 stat trigger 1 minimum (inclusive)", { exact: true })); await user.type(screen.getByLabelText("Entry 4 stat trigger 1 minimum (inclusive)", { exact: true }), "2");
  await user.click(screen.getByRole("button", { name: "Add entry 4 event trigger", exact: true }));
  expect(latest.journal!.entries[3]).toMatchObject({ title: "A resolve note", text: "Authored words only.", when: [{ kind: "stat", key: "resolve", minimum: 2 }, { kind: "event", eventId: "hello", minimum: 1 }] });
  await user.click(screen.getByRole("button", { name: "Add objective", exact: true })); expect(latest.journal!.objectives).toHaveLength(3);
});
it("blocks deletion and disabling while journal triggers reference authored game state", () => {
  render(<Editors changed={vi.fn()} />);
  expect((screen.getByRole("button", { name: "Remove event 1", exact: true }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.getElementById(screen.getByRole("button", { name: "Remove event 1", exact: true }).getAttribute("aria-describedby")!)?.textContent).toContain("Objective Discuss the signal");
  expect((screen.getByLabelText("Chapters and events enabled") as HTMLInputElement).disabled).toBe(true);
});
it("keeps dedicated views free, hides undiscovered information, and supports keyboard entry and Escape", async () => {
  const f = journalFixture(), before = structuredClone(f.initial), action = vi.fn(), user = userEvent.setup();
  render(<WorldPanel world={f.world} state={f.initial.state} disabled={false} onAction={action} />);
  expect(screen.queryByRole("button", { name: /^station/ })).toBeNull();
  const character = screen.getByRole("button", { name: "Character", exact: true }); character.focus(); await user.keyboard("{Enter}");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Character", level: 3 })));
  expect(screen.queryByRole("region", { name: "Locations and time", exact: true })).toBeNull(); expect(screen.getByText("Resolve", { exact: true })).toBeTruthy(); expect(screen.queryByText("Trust with Mara", { exact: true })).toBeNull();
  await user.keyboard("{Escape}"); await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Explore", exact: true })));
  await user.click(screen.getByRole("button", { name: "Journal", exact: true })); await user.click(screen.getByRole("button", { name: "Entries", exact: true }));
  expect(screen.getByText("No journal entries recorded.")).toBeTruthy(); await user.click(screen.getByRole("button", { name: "Places", exact: true }));
  expect(within(screen.getByRole("region", { name: "Discovered locations" })).queryByText("station")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Events", exact: true })); expect(screen.getByText("No events recorded.")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/Secret future|Never disclosed|Secret objective|Future instruction/);
  expect(action).not.toHaveBeenCalled(); expect(f.initial).toEqual(before);
});
it("reveals only committed values and remembered entries when changing views", async () => {
  const f = journalFixture(); f.economy.items[0]!.initial = 1; const start = f.refresh(), next = f.act(start, { kind: "gift", id: "gift-tea" }), user = userEvent.setup();
  const { rerender } = render(<WorldPanel world={f.world} state={start.state} disabled={false} onAction={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Character", exact: true })); expect(screen.queryByText("Trust with Mara", { exact: true })).toBeNull();
  rerender(<WorldPanel world={f.world} state={next.state} disabled={false} onAction={vi.fn()} />); expect(screen.getByText("Trust with Mara", { exact: true })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Journal", exact: true })); await user.click(screen.getByRole("button", { name: "Entries", exact: true })); expect(screen.getByText("Mara's parcel", { exact: true })).toBeTruthy();
  rerender(<WorldPanel world={f.world} state={start.state} disabled={false} onAction={vi.fn()} />); expect(screen.queryByText("Mara's parcel", { exact: true })).toBeNull();
});
it("does not autosave during inspection or cancellation and hides narrative choices in secondary views", async () => {
  const f = journalFixture(), storage = new MemoryNativePlayerStorage(), user = userEvent.setup(); await storage.install(createNativePlayerInstallation(f.bundle, f.config)); const write = vi.spyOn(storage, "writeAutosave");
  render(<NativePlayer route={{ gameId: f.bundle.gameId, bundleFingerprint: f.bundle.bundleFingerprint, debug: false }} storage={storage} />);
  await user.click(await screen.findByRole("button", { name: "Character", exact: true })); expect(screen.queryByRole("region", { name: "Choices", exact: true })).toBeNull(); expect(screen.queryByRole("heading", { name: "Status", exact: true })).toBeNull();
  expect(screen.queryByText("Exact prose 0.")).toBeNull(); await user.keyboard("{Escape}"); await screen.findByRole("region", { name: "Choices", exact: true });
  await user.click(screen.getByRole("button", { name: "Wait 5 min", exact: true })); await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  await user.click(screen.getByRole("button", { name: "Journal", exact: true })); await user.click(screen.getByRole("button", { name: "Entries", exact: true })); expect(screen.getByText("No journal entries recorded.")).toBeTruthy();
  expect(write).not.toHaveBeenCalled();
});
it("invalidates journal consent on edits and retries identical approved Apply requests after response loss", async () => {
  const world = authored(), applied: any[] = [], response = (v: unknown) => new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, opts) => { const tool = String(path).split("/").at(-1), body = opts?.body ? JSON.parse(String(opts.body)) : null;
    if (tool === "read_world") return response({ world, statOptions: stats, relationshipOptions: relationships }); if (String(path).endsWith("passage-plan")) return response({ passages: [] });
    if (tool === "review_world") return response({ world: body.world, previous: world, fingerprint: "a".repeat(64) });
    if (tool === "apply_world") { applied.push(body); if (applied.length === 1) throw new Error("Lost response"); return response({ versionId: "w5" }); } return response({ items: [], total: 0 });
  });
  const user = userEvent.setup(); render(<WorldWorkspace projectId="p" />); await user.click(await screen.findByRole("button", { name: "Review world", exact: true })); await user.click(screen.getByLabelText("I approve this exact world and time definition."));
  await user.clear(screen.getByLabelText("Entry 1 title", { exact: true })); await user.type(screen.getByLabelText("Entry 1 title", { exact: true }), "Revised parcel note"); expect(screen.queryByRole("button", { name: "Apply world" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Review world", exact: true })); await user.click(screen.getByLabelText("I approve this exact world and time definition."));
  await user.click(screen.getByRole("button", { name: "Apply world", exact: true })); await screen.findByRole("alert"); await user.click(screen.getByRole("button", { name: "Apply world", exact: true })); await waitFor(() => expect(applied).toHaveLength(2)); expect(applied[0]).toEqual(applied[1]);
});

it("keeps inspection free during a required encounter while blocking trade in dedicated views", async () => {
  const f = journalFixture(); f.people.events[1]!.mandatory = true; const pending = f.act(f.refresh(), { kind: "wait", minutes: 15 }), action = vi.fn(), user = userEvent.setup();
  expect(pending.state.world!.minutes).toBe(1440);
  render(<WorldPanel world={f.world} state={pending.state} disabled={false} onAction={action} />);
  await user.click(screen.getByRole("button", { name: "Journal", exact: true })); await user.click(screen.getByRole("button", { name: "Entries", exact: true })); expect(screen.getByText("Fleeting signal", { exact: true })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Shops here", exact: true })); expect((screen.getByRole("button", { name: "Buy 1 Tea · 4 Coins · 2 min", exact: true }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getAllByText("Complete the required encounter first").length).toBeGreaterThan(0); expect(action).not.toHaveBeenCalled();
});
it("keeps missing canonical visibility bindings visible and repairable without discarding journal prose", async () => {
  let latest = authored(); latest.journal!.character.push({ category: "stat", key: "removed-stat", when: [] }, { category: "relationship", key: "removed-relationship", when: [] });
  function Repair() { const [world, setWorld] = useState(latest); return <JournalEditor world={world} stats={stats} relationships={relationships} onChange={(journal) => { latest = { ...world, journal }; setWorld(latest); }} />; }
  const prose = structuredClone(latest.journal!.entries), user = userEvent.setup(); render(<Repair />);
  await user.click(screen.getByRole("button", { name: "Remove missing stat visibility removed-stat", exact: true }));
  await user.click(screen.getByRole("button", { name: "Remove missing relationship visibility removed-relationship", exact: true }));
  expect(latest.journal!.character.map((r) => r.key)).toEqual(["resolve", "trust"]);
  expect(latest.journal!.entries).toEqual(prose);
});
