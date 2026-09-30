// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "../src/api/project-setup.js";
import { ProjectSetupWorkspace } from "../src/features/workspace/ProjectSetupWorkspace.js";

vi.mock("../src/api/project-setup.js", () => Object.fromEntries([
  "applySetup", "askSetup", "draftSetup", "loadSetupSession", "previewSetup", "rejectSetup", "reviseSetup", "saveSetupMessage", "startSetupSession",
].map((name) => [name, vi.fn()])));
const loaded = {
  conversation: { id: "conversation-1" }, messages: [{ id: "message-1", role: "user", content: "A detective mystery" }],
  messageCount: 1, messagesTruncated: false, understanding: null, proposals: [],
} as unknown as api.SetupSession;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.startSetupSession).mockResolvedValue(loaded.conversation);
  vi.mocked(api.loadSetupSession).mockResolvedValue(structuredClone(loaded));
  vi.mocked(api.previewSetup).mockResolvedValue({ contextFingerprint: "exact-context", provider: { model: "offline-model" },
    ready: true, withinLimits: true, generatesProse: false, diagnostics: { serializedBytes: 1000, estimatedInputTokens: 250 } });
});
afterEach(cleanup);

it("typing is local and Ask requires an explicit saved idea", async () => {
  const user = userEvent.setup(); render(<ProjectSetupWorkspace projectId="p" onApplied={vi.fn()} />);
  await screen.findByText("A detective mystery");
  await user.type(screen.getByLabelText("Your idea or clarification"), "Retired and reluctant.");
  expect(vi.mocked(api.saveSetupMessage)).not.toHaveBeenCalled(); expect(vi.mocked(api.askSetup)).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Ask Studio" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Save idea" }));
  await waitFor(() => expect(api.saveSetupMessage).toHaveBeenCalledWith("p", "conversation-1", "Retired and reluctant."));
  await user.click(screen.getByRole("button", { name: "Ask Studio" }));
  await waitFor(() => expect(api.askSetup).toHaveBeenCalledOnce());
});

it("separates local preview, exact authorization and provider start", async () => {
  const user = userEvent.setup(); render(<ProjectSetupWorkspace projectId="p" onApplied={vi.fn()} />);
  await screen.findByText("A detective mystery");
  await user.click(screen.getByRole("button", { name: "Preview proposal context" }));
  const start = await screen.findByRole("button", { name: "Draft foundation proposal" });
  expect((start as HTMLButtonElement).disabled).toBe(true); expect(api.draftSetup).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText("Authorize this exact proposal request"));
  await user.click(start);
  await waitFor(() => expect(api.draftSetup).toHaveBeenCalledWith("p", "conversation-1", expect.objectContaining({ contextFingerprint: "exact-context", provider: { model: "offline-model" } }), expect.any(AbortSignal)));
});

it("announces stale errors and keeps canonical application separate from review", async () => {
  vi.mocked(api.loadSetupSession).mockResolvedValue({ ...loaded, proposals: [{ id: "proposal-1", status: "proposed", summary: "Draft detective",
    groups: [{ id: "brief", artifactId: "brief", label: "Story shape", summary: "Premise", dependsOnGroupIds: [], candidate: {}, changes: [] }], validationFindings: [] }] });
  vi.mocked(api.applySetup).mockRejectedValue(new Error("The project changed. Draft a new proposal."));
  const onApplied = vi.fn(); const user = userEvent.setup(); render(<ProjectSetupWorkspace projectId="p" onApplied={onApplied} />);
  await screen.findByText("Draft detective"); expect(api.applySetup).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Apply selected foundations" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The project changed. Draft a new proposal.");
  expect(onApplied).not.toHaveBeenCalled();
});
