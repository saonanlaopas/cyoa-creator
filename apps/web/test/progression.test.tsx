// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryNativePlayerStorage, createNativePlayerInstallation } from "@story-to-cyoa/runtime";
import type { WorldDefinition } from "@story-to-cyoa/domain";
import { progressionFixture } from "../../../packages/runtime/test/progression-fixture.js";
import { WorldWorkspace } from "../src/features/workspace/WorldWorkspace.js";
import { WorldPanel } from "../src/features/player/WorldPanel.js";
import { NativePlayer } from "../src/features/player/NativePlayer.js";
import { ProgressionEditor } from "../src/features/workspace/ProgressionEditor.js";
import { useState } from "react";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
function authored(): WorldDefinition {
  const f = progressionFixture(), { schemaId: _id, assets: _assets, progression: p, ...world } = f.world;
  const ref = (passageId: string | null) => passageId ? { passageId, versionId: `pv-${passageId}` } : null;
  return { ...world, schemaId: "cyoa.world-definition", enabled: true,
    locations: f.world.locations.map(({ passageId, ...location }) => ({ ...location, passage: ref(passageId), mapImage: null })),
    progression: { ...p!, schemaId: "cyoa.world-progression", events: p!.events.map(({ passageId, ...event }) => ({ ...event, passage: ref(passageId) })), transitions: p!.transitions.map(({ passageId, ...transition }) => ({ ...transition, passage: ref(passageId) })) } };
}
it("defaults newly enabled progression to chapter-led play while allowing the author to remove chapters", async () => {
  function Editor() {
    const [progression, setProgression] = useState<WorldDefinition["progression"]>();
    return <ProgressionEditor progression={progression} onChange={setProgression} locations={[]} passages={[]} />;
  }
  const user = userEvent.setup(); render(<Editor />);
  await user.click(screen.getByLabelText("Chapters and events enabled"));
  expect((screen.getByLabelText("Chapter name 1") as HTMLInputElement).value).toBe("Chapter 1");
  expect((screen.getByLabelText("Initial chapter") as HTMLSelectElement).selectedOptions[0]!.textContent).toBe("Chapter 1");
  await user.click(screen.getByRole("button", { name: "Remove chapter 1", exact: true }));
  expect(screen.getByText(/Chapter-free play: events and milestones/)).toBeTruthy();
});
it("edits W2 prerequisites/policies through shared world review, clears consent on edits, and retries a lost Apply with the same UUID", async () => {
  let world = authored(); const posts: Array<{ tool: string; input: any }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, options) => {
    const tool = String(path).split("/").at(-1)!, input = options?.body ? JSON.parse(String(options.body)) : null;
    if (tool === "read_world") return response({ world });
    if (String(path).endsWith("passage-plan")) return response({ passages: [0, 1, 2, 3, 4].map((i) => ({ id: `pv-passage-${i}`, entityId: `passage-${i}`, content: { title: `Passage ${i}` } })) });
    if (tool === "review_world") { posts.push({ tool, input }); return response({ world: input.world, previous: world, fingerprint: "a".repeat(64), diagnostics: { findings: [], total: 0, omitted: 0, exhaustive: false } }); }
    if (tool === "apply_world") { posts.push({ tool, input }); if (posts.filter((p) => p.tool === tool).length === 1) throw new Error("Lost response"); world = input.world; return response({ versionId: "world-w2" }); }
    return response({ items: [], total: 0, offset: 0 });
  });
  const user = userEvent.setup(); render(<WorldWorkspace projectId="p" />);
  await user.clear(await screen.findByLabelText("Chapter name 1")); await user.type(screen.getByLabelText("Chapter name 1"), "The long night");
  await user.selectOptions(screen.getByLabelText("Event 1 prerequisite 1 rule"), "false");
  await user.click(screen.getByRole("button", { name: "Review world" }));
  expect(screen.getByRole("region", { name: "Progression diagnostics" }).textContent).toContain("not an exhaustive proof");
  expect((screen.getByRole("button", { name: "Apply world" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByLabelText("I approve this exact world and time definition."));
  await user.click(screen.getByLabelText("Carry Signal clue at transition 1"));
  expect(screen.queryByRole("button", { name: "Apply world" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Review world" })); await user.click(screen.getByLabelText("I approve this exact world and time definition."));
  await user.click(screen.getByRole("button", { name: "Apply world" })); await screen.findByRole("alert");
  await user.click(screen.getByRole("button", { name: "Apply world" })); await screen.findByText("World applied. Existing builds are unchanged.");
  const applies = posts.filter((p) => p.tool === "apply_world"); expect(applies).toHaveLength(2); expect(applies[1]!.input).toEqual(applies[0]!.input);
  expect(applies[0]!.input.world.progression.chapters[0].name).toBe("The long night");
  expect(applies[0]!.input.world.progression.transitions[0].carryMilestoneIds).toEqual([]);
});
it("shows current chapter, milestones and availability and passes a free state-bound loss preview to confirmation", async () => {
  const f = progressionFixture(), next = f.act(f.initial, { kind: "event", id: "notice" }), copy = structuredClone(next), onAction = vi.fn(), user = userEvent.setup();
  const { rerender } = render(<WorldPanel world={f.world} state={next.state} disabled={false} onAction={onAction} />);
  expect(screen.queryByRole("button", { name: /Remember the crossing/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Begin the next chapter · 5 min" }));
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ kind: "chapter-transition", id: "next", previewFingerprint: expect.any(String) }), "Begin the next chapter (5 min)", expect.objectContaining({ expiredMilestones: [{ id: "temporary", name: "Last conversation" }], lostOpportunities: expect.arrayContaining([expect.objectContaining({ id: "conversation", permanent: true })]) }));
  expect(next).toEqual(copy);
  const capped = structuredClone(next.state); capped.world!.minutes = 52_560_000;
  rerender(<WorldPanel world={f.world} state={capped} disabled={false} onAction={onAction} />);
  expect((screen.getByRole("button", { name: "Begin the next chapter · 5 min" }) as HTMLButtonElement).disabled).toBe(true);
});
it("keeps Creator's map preview available with asset URLs while rejecting contradictory draft progression", async () => {
  const world = authored(), mapId = "00000000-0000-4000-8000-000000000001";
  world.locations[0]!.mapImage = { assetId: mapId, versionId: "map-v1" };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    if (String(path).endsWith("read_world")) return response({ world });
    if (String(path).endsWith("passage-plan")) return response({ passages: [] });
    if (String(path).includes(`/${mapId}?`)) return response({ selected: { id: "map-v1", image: { url: "/api/map-image" }, content: { metadata: { altText: "Harbor map", credit: "", license: "" } } } });
    return response({ items: [], total: 0 });
  });
  const user = userEvent.setup(); render(<WorldWorkspace projectId="p" />);
  await user.click(await screen.findByText("Map preview", { exact: true }));
  await user.click(screen.getByText("Map", { exact: true }));
  expect(screen.getByAltText("Harbor map").getAttribute("src")).toBe("/api/map-image");
  await user.selectOptions(screen.getByLabelText("Event 1 prerequisite 1 rule"), "false");
  // A second requirement for the same chapter is now contradictory.
  await user.click(screen.getByRole("button", { name: "Add event 1 prerequisite", exact: true }));
  await user.selectOptions(screen.getByLabelText("Event 1 prerequisite 4 type"), "chapter");
  expect(screen.queryByText("Map preview", { exact: true })).toBeNull();
});
it("does not autosave on preview/cancel, confirms the actual carry/expiry once, and persists its state", async () => {
  const f = progressionFixture(), storage = new MemoryNativePlayerStorage(), user = userEvent.setup();
  await storage.install(createNativePlayerInstallation(f.bundle, f.config));
  const write = vi.spyOn(storage, "writeAutosave");
  render(<NativePlayer route={{ gameId: f.bundle.gameId, bundleFingerprint: f.bundle.bundleFingerprint, debug: false }} storage={storage} />);
  await user.click(await screen.findByRole("button", { name: "Read the signal notice · 5 min" })); await user.click(screen.getByRole("button", { name: "Confirm action" }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole("button", { name: "Begin the next chapter · 5 min" }));
  const preview = screen.getByRole("region", { name: "Chapter transition preview" }); expect(preview.textContent).toContain("Milestones expiring: Last conversation"); expect(preview.textContent).toContain("A last conversation: expires permanently");
  await user.click(screen.getByRole("button", { name: "Cancel" })); expect(write).toHaveBeenCalledTimes(1); expect(screen.getByLabelText("Game time").textContent).toBe("Day 1 · 23:55");
  await user.click(screen.getByRole("button", { name: "Begin the next chapter · 5 min" })); await user.click(screen.getByRole("button", { name: "Confirm action" }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  expect(screen.getByText("Chapter: After the crossing")).toBeTruthy(); expect(screen.getByLabelText("Game time").textContent).toBe("Day 2 · 00:00");
  expect(write.mock.calls[1]![2].state.world!.progression).toMatchObject({ chapterId: "second", milestones: ["clue"], expiredEventIds: ["conversation"] });
});
it("retains an already committed chapter transition through autosave failure and retries saving without applying it twice", async () => {
  const f = progressionFixture(), storage = new MemoryNativePlayerStorage(), user = userEvent.setup();
  await storage.install(createNativePlayerInstallation(f.bundle, f.config));
  const noticed = f.act(f.initial, { kind: "event", id: "notice" });
  const { createNativePlayerSave } = await import("@story-to-cyoa/runtime");
  await storage.writeAutosave(f.bundle.gameId, f.bundle.bundleFingerprint, createNativePlayerSave(f.bundle, f.config, noticed));
  const write = vi.spyOn(storage, "writeAutosave").mockRejectedValueOnce(new Error("Simulated save failure"));
  render(<NativePlayer route={{ gameId: f.bundle.gameId, bundleFingerprint: f.bundle.bundleFingerprint, debug: false }} storage={storage} />);
  await user.click(await screen.findByRole("button", { name: "Begin the next chapter · 5 min" })); await user.click(screen.getByRole("button", { name: "Confirm action" }));
  expect((await screen.findByRole("alert")).textContent).toContain("not saved");
  expect(screen.getByText("Chapter: After the crossing")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Retry autosave" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(write).toHaveBeenCalledTimes(2); expect(write.mock.calls[1]![2].state).toEqual(write.mock.calls[0]![2].state);
  expect(write.mock.calls[1]![2].state.world!.progression!.transitions).toEqual({ next: 1 });
});
