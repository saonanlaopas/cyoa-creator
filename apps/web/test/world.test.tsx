// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { emptyWorld } from "@story-to-cyoa/domain";
import { WorldWorkspace } from "../src/features/workspace/WorldWorkspace.js";
import { WorldPanel } from "../src/features/player/WorldPanel.js";
import type { NativeWorld, RuntimeState } from "@story-to-cyoa/runtime";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
function mock() {
  const posts: Array<{ tool: string; input: any }> = [];
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (path, options) => {
    const tool = String(path).split("/").at(-1)!, input = options?.body ? JSON.parse(String(options.body)) : null;
    if (tool === "read_world") return response({ world: emptyWorld() });
    if (tool === "review_world") { posts.push({ tool, input }); return response({ world: input.world, previous: null, fingerprint: "a".repeat(64) }); }
    if (tool === "apply_world") { posts.push({ tool, input }); if (posts.filter((p) => p.tool === tool).length === 1) throw new Error("Lost response"); return response({ versionId: "world-v1" }); }
    if (String(path).endsWith("passage-plan")) return response({ passages: [] });
    return response({ total: 0, offset: 0, items: [] });
  }); return { posts, fetch };
}
it("keeps world review/consent separate, reuses the UUID after a lost Apply and invalidates reviews on local edits", async () => {
  const { posts } = mock(), user = userEvent.setup(); render(<WorldWorkspace projectId="project-1" />);
  await user.click(await screen.findByRole("button", { name: "Review world" }));
  expect((screen.getByRole("button", { name: "Apply world" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByLabelText("I approve this exact world and time definition."));
  await user.click(screen.getByRole("button", { name: "Apply world" }));
  await screen.findByRole("alert"); await user.click(screen.getByRole("button", { name: "Apply world" }));
  await screen.findByText("World applied. Existing builds are unchanged.");
  const applies = posts.filter((p) => p.tool === "apply_world"); expect(applies).toHaveLength(2); expect(applies[0]!.input).toEqual(applies[1]!.input);
  await user.click(screen.getByRole("button", { name: "Review world" }));
  await user.click(screen.getByLabelText("World enabled")); expect(screen.queryByRole("button", { name: "Apply world" })).toBeNull();
});
it("does not replace an unmounted world's state after a delayed read", async () => {
  const { fetch } = mock(); let resolve!: (value: Response) => void;
  const fallback = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (path, options) => String(path).endsWith("read_world") ? new Promise<Response>((done) => { resolve = done; }) : fallback(path, options));
  const view = render(<WorldWorkspace projectId="old-project" />); await waitFor(() => expect(resolve).toBeTypeOf("function"));
  view.unmount(); resolve(response({ world: emptyWorld() }));
  await waitFor(() => expect(screen.queryByText("World enabled")).toBeNull());
});
it("keeps map inspection free, uses safe text, and retains destination navigation after optional artwork fails", async () => {
  const world: NativeWorld = { schemaId: "cyoa.native-world", schemaVersion: 1, startLocationId: "home", initialMinutes: 480, waitMinutes: [15], assets: [{ id: "map", dataUrl: "data:image/png;base64,broken", altText: "Map of roads beside the water", credit: "Author", license: "CC0" }],
    locations: [{ id: "town", name: "Town", parentId: null, passageId: null, mapImage: "map", marker: null, hours: null },
      { id: "home", name: "Home", parentId: "town", passageId: "opening", mapImage: null, marker: { x: 0, y: 100 }, hours: null },
      { id: "cafe", name: "<script>Cafe</script>", parentId: "town", passageId: "cafe-passage", mapImage: null, marker: { x: 100, y: 0 }, hours: null }],
    connections: [{ id: "to-cafe", from: "home", to: "cafe", minutes: 10 }], actions: [] };
  const state: RuntimeState = { currentPassageId: "opening", stats: {}, relationships: {}, flags: {}, resources: {}, decisions: [], routes: [], knownFacts: [], visitCounts: { opening: 1 }, turn: 0, world: { schemaVersion: 1, locationId: "home", minutes: 480 } };
  const onAction = vi.fn(), user = userEvent.setup(), copy = structuredClone(state);
  render(<WorldPanel world={world} state={state} disabled={false} onAction={onAction} />);
  await user.click(screen.getByText("Map", { exact: true }));
  await user.click(screen.getByRole("button", { name: "Inspect <script>Cafe</script>" }));
  expect(onAction).not.toHaveBeenCalled(); expect(state).toEqual(copy);
  fireEvent.error(screen.getByRole("img")); expect(screen.getByText("Map of roads beside the water")).toBeTruthy();
  expect(document.querySelector("script")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Travel to <script>Cafe</script> (10 min)" }));
  expect(onAction).toHaveBeenCalledWith({ kind: "travel", id: "to-cafe" }, "Travel to <script>Cafe</script> (10 min)");
});
