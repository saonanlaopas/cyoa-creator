// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { IllustratedScenesWorkspace } from "../src/features/workspace/IllustratedScenesWorkspace.js";
import { IllustratedScene } from "../src/features/player/IllustratedScene.js";
const base = { schemaId: "cyoa.illustrated-scene", schemaVersion: 1, passageId: "opening", passageVersionId: "passage-v1", layout: "illustrated", background: null, portraits: [], dialogue: [{ speaker: "Mira", text: "A signal." }] };
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function mock() {
  const posts: Array<{ tool: string; input: any }> = [];
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (path, options) => {
    const tool = String(path).split("/").at(-1)!, input = options?.body ? JSON.parse(String(options.body)) : null;
    if (tool === "read_scene") return response({ scene: base, passageVersionId: "passage-v1", stale: false });
    if (tool === "review_scene") { posts.push({ tool, input }); return response({ scene: input.scene, previous: base, fingerprint: "a".repeat(64) }); }
    if (tool === "apply_scene") { posts.push({ tool, input }); if (posts.filter((p) => p.tool === tool).length === 1) throw new Error("Lost response"); return response({ versionId: "scene-v1" }); }
    if (String(path).endsWith("passage-plan")) return response({ passages: [{ entityId: "opening", content: { title: "Opening" } }, { entityId: "ending", content: { title: "Ending" } }] });
    return response({ total: 0, offset: 0, items: [] });
  }); return { fetch, posts };
}
it("requires separate consent, retries a lost Apply with the identical UUID, and clears review on local edits", async () => {
  const { posts } = mock(), user = userEvent.setup(); render(<IllustratedScenesWorkspace projectId="project-1" />);
  await user.click(await screen.findByRole("button", { name: "Review scene" }));
  const checkbox = await screen.findByLabelText("I approve this exact scene and image selection.");
  expect(screen.getByRole("button", { name: "Apply scene" }).hasAttribute("disabled")).toBe(true);
  await user.click(checkbox); await user.click(screen.getByRole("button", { name: "Apply scene" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Lost response");
  await user.click(screen.getByRole("button", { name: "Apply scene" }));
  await screen.findByText("Scene applied. Existing builds are unchanged.");
  const applies = posts.filter((p) => p.tool === "apply_scene"); expect(applies).toHaveLength(2); expect(applies[0]!.input).toEqual(applies[1]!.input);
  await user.click(screen.getByRole("button", { name: "Review scene" })); await screen.findByLabelText("I approve this exact scene and image selection.");
  await user.type(screen.getByLabelText("Dialogue 1"), " Changed");
  expect(screen.queryByRole("button", { name: "Apply scene" })).toBeNull();
});
it("ignores a pending scene read after unmount", async () => {
  const { fetch } = mock(); let resolve!: (value: Response) => void;
  const fallback = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (path, options) => {
    if (String(path).endsWith("read_scene") && JSON.parse(String(options?.body)).passageId === "opening") return new Promise<Response>((done) => { resolve = done; });
    if (String(path).endsWith("read_scene")) return response({ scene: { ...base, passageId: "ending", dialogue: [{ speaker: "Fin", text: "Last light." }] }, passageVersionId: "passage-end-v1" });
    return fallback(path, options);
  });
  const view = render(<IllustratedScenesWorkspace projectId="project-1" />);
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  // A pending read is intentionally non-interruptible in the UI; unmount must still ignore its response.
  view.unmount(); resolve(response({ scene: base, passageVersionId: "passage-v1" }));
  await waitFor(() => expect(screen.queryByText("A signal.")).toBeNull());
});
it("keeps dialogue and alternative text readable when optional art fails and uses text nodes for unsafe markup", () => {
  render(<IllustratedScene passageId="opening" presentation={{ schemaId: "cyoa.illustrated-presentation", schemaVersion: 1,
    assets: [{ id: "art", dataUrl: "data:image/png;base64,broken", altText: "Red tower at the harbor", credit: "Author", license: "CC0" }],
    scenes: [{ passageId: "opening", background: "art", portraits: [], dialogue: [{ speaker: "Mira", text: "<script>not executable</script>" }] }] }} />);
  fireEvent.error(screen.getByRole("img"));
  expect(screen.getByText("Red tower at the harbor")).toBeTruthy();
  expect(screen.getByText("<script>not executable</script>")).toBeTruthy();
  expect(document.querySelector("script")).toBeNull();
});
