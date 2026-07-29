// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BibleWorkspace } from "../src/features/workspace/BibleWorkspace.js";

const workflow = {
  projectId: "project-1",
  artifactId: "bible",
  status: "draft" as const,
  approvedVersionId: null,
  updatedAt: "t",
};

const bible = {
  id: "bible-v1",
  projectId: "project-1",
  artifactId: "bible",
  version: 1,
  schemaVersion: 1,
  stale: false,
  createdAt: "t",
  content: {
    schemaVersion: 1 as const,
    title: "Test story bible",
    overview: "",
    characters: [],
    relationships: [],
    settings: [],
    timeline: [],
    worldRules: [],
    themes: [],
    proseGuidance: { tone: [], pointOfView: "second-person", style: [], avoid: [] },
    canonFacts: [],
    contradictions: [],
    adaptationOpportunities: [],
    unresolvedQuestions: [],
  },
};

afterEach(() => vi.restoreAllMocks());

describe("BibleWorkspace", () => {
  it("creates a gated local draft and saves structured entries with stable IDs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      bible,
      workflow,
    }), { status: 201, headers: { "content-type": "application/json" } }));
    const changed = vi.fn(async () => {});
    const user = userEvent.setup();
    const setBusy = vi.fn();
    const setMessage = vi.fn();
    const view = render(<BibleWorkspace
      projectId="project-1"
      briefApproved
      bible={null}
      workflow={{ ...workflow, status: "empty" }}
      busy={false}
      message={null}
      setBusy={setBusy}
      setMessage={setMessage}
      onChanged={changed}
    />);
    await user.click(screen.getByRole("button", { name: "Create story bible" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/long-form/projects/project-1/bible", { method: "POST" });
    expect(changed).toHaveBeenCalled();

    view.rerender(<BibleWorkspace
      projectId="project-1"
      briefApproved
      bible={bible}
      workflow={workflow}
      busy={false}
      message={null}
      setBusy={setBusy}
      setMessage={setMessage}
      onChanged={changed}
    />);
    await user.click(screen.getByRole("button", { name: "Add characters" }));
    await user.type(screen.getByLabelText("Name"), "Mara");
    await user.type(screen.getByLabelText("Role"), "Protagonist");
    await user.click(screen.getByRole("button", { name: "Save bible draft" }));
    const saveCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/bible") && call[1]?.method === "PUT");
    expect(saveCall).toBeTruthy();
    const saved = JSON.parse(String(saveCall![1]?.body));
    expect(saved.characters[0]).toMatchObject({ name: "Mara", role: "Protagonist" });
    expect(saved.characters[0].id).toMatch(/^character-/);
  });
});
