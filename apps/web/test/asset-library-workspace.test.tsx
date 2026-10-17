// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AssetLibraryWorkspace } from "../src/features/workspace/AssetLibraryWorkspace.js";
const metadata = { title: "Harbor", description: "Red signal tower beside water.", altText: "Signal tower", tags: ["harbor"], credit: "Author", license: "CC0" };
const content = { schemaId: "cyoa.image-asset", schemaVersion: 1, assetId: "asset-1", status: "candidate", baseVersionId: null, reviewedCandidateVersionId: null,
  fileSha256: "a".repeat(64), thumbnailSha256: "b".repeat(64), metadata, provenance: { kind: "user-upload", sourceName: "harbor.png", sourceSha256: "c".repeat(64), sourceMimeType: "image/png", normalization: "oriented-srgb-rgba-png-v1", providerCalls: 0 } };
const selected = { id: "version-1", projectId: "project-1", artifactId: "image-asset:asset-1", version: 1, createdAt: "2026-10-18T00:00:00Z", content,
  image: { sha256: content.fileSha256, width: 512, height: 320, bytes: 1000, url: "/image.png" }, thumbnail: { url: "/thumb.png" } };
const detail = { assetId: "asset-1", currentVersionId: "version-1", selected, approved: null, totalVersions: 1, offset: 0,
  history: [{ id: "version-1", version: 1, createdAt: selected.createdAt, status: "candidate", title: metadata.title, fileSha256: content.fileSha256 }] };
const list = { total: 1, offset: 0, items: [{ assetId: "asset-1", versionId: "version-1", status: "candidate", metadata, thumbnailUrl: "/thumb.png", approvedVersionId: null }] };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("retries a lost upload response with the same operation UUID and keeps approval separate", async () => {
  const posts: Array<Record<string, unknown>> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, options) => {
    if (options?.method === "POST") {
      posts.push(JSON.parse(String((options.body as FormData).get("metadata"))));
      if (posts.length === 1) throw new Error("Response lost");
      return response({ assetId: "asset-1", versionId: "version-1", status: "candidate" });
    }
    return response(String(path).includes("asset-1") ? detail : posts.length > 1 ? list : { total: 0, offset: 0, items: [] });
  });
  const user = userEvent.setup(); render(<AssetLibraryWorkspace projectId="project-1" />);
  await user.click(screen.getByRole("button", { name: "New asset" }));
  await user.upload(screen.getByLabelText("Image file"), new File(["fixture"], "harbor.png", { type: "image/png" }));
  await user.type(screen.getByRole("textbox", { name: "Title", exact: true }), "Harbor");
  await user.type(screen.getByRole("textbox", { name: "Description", exact: true }), metadata.description);
  await user.type(screen.getByRole("textbox", { name: "Alternative text", exact: true }), metadata.altText);
  await user.type(screen.getByRole("textbox", { name: "Tags", exact: true }), "harbor, coast");
  fireEvent.submit(screen.getByRole("button", { name: "Upload candidate" }).closest("form")!);
  expect(await screen.findByText("Response lost")).toBeTruthy();
  fireEvent.submit(screen.getByRole("button", { name: "Upload candidate" }).closest("form")!);
  expect(await screen.findByText("Candidate saved. Approved image unchanged.")).toBeTruthy();
  expect(posts).toHaveLength(2); expect(posts[0]!.operationId).toBe(posts[1]!.operationId);
  expect(posts[1]!.metadata).toMatchObject({ tags: ["harbor", "coast"] });
  expect(screen.queryByRole("button", { name: "Approve candidate" })).toBeNull();
});
it("invalidates an exact approval review immediately when local metadata changes", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    if (String(path).includes("/review?")) return response({ ...detail, fingerprint: "d".repeat(64), findings: [], usage: { totalAssignments: 0, totalLibraryVersions: 1 } });
    return response(String(path).includes("asset-1") ? detail : list);
  });
  const user = userEvent.setup(); render(<AssetLibraryWorkspace projectId="project-1" />);
  await user.click(await screen.findByRole("button", { name: /Harbor.*candidate/ }));
  await user.click(await screen.findByRole("button", { name: "Review candidate", exact: true }));
  await user.click(await screen.findByLabelText("I reviewed this exact image and metadata."));
  expect(screen.getByRole("button", { name: "Approve candidate" }).hasAttribute("disabled")).toBe(false);
  await user.type(screen.getByRole("textbox", { name: "Description", exact: true }), " Revised.");
  expect(screen.queryByRole("button", { name: "Approve candidate" })).toBeNull();
  expect(screen.getByRole("button", { name: "Review candidate", exact: true }).hasAttribute("disabled")).toBe(true);
  expect(fetch.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
});
it("does not display an obsolete asset response after a newer selection or New asset", async () => {
  let resolve!: (value: Response) => void;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    if (String(path).includes("asset-1")) return new Promise<Response>((done) => { resolve = done; });
    return response(list);
  });
  const user = userEvent.setup(); render(<AssetLibraryWorkspace projectId="project-1" />);
  await user.click(await screen.findByRole("button", { name: /Harbor.*candidate/ }));
  await user.click(screen.getByRole("button", { name: "New asset" })); resolve(response(detail));
  await waitFor(() => expect(screen.getByRole("heading", { name: "New image candidate" })).toBeTruthy());
  expect(screen.queryByRole("heading", { name: "Harbor", exact: true })).toBeNull();
});
