// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LongFormWorkspace } from "../src/features/workspace/LongFormWorkspace.js";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const project = {
  id: "long-1",
  name: "The Long Road",
  mode: "long-form",
  archived: false,
  createdAt: "t",
  updatedAt: "t",
};

const briefContent = {
  schemaVersion: 1,
  workingTitle: "The Long Road",
  premise: "",
  sourceMode: "imported-source",
  protagonist: "",
  pointOfView: "second-person",
  adaptationFidelity: "balanced",
  tone: "",
  contentBoundaries: [],
  totalWordTarget: 175000,
  typicalPlaythroughWordTarget: 50000,
  routeTarget: 5,
  endingTarget: 10,
  passageWordTarget: 500,
  branchingStyle: "braided",
  priorityCharacters: [],
  priorityRelationships: [],
  projectConstraints: [],
  unresolvedQuestions: [],
};

const brief = {
  id: "brief-v1",
  projectId: project.id,
  artifactId: "brief",
  version: 1,
  content: briefContent,
  stale: false,
  createdAt: "t",
};

const draftWorkflow = {
  projectId: project.id,
  artifactId: "brief",
  status: "draft",
  approvedVersionId: null,
  updatedAt: "t",
};

const conversation = {
  id: "conversation-1",
  projectId: project.id,
  title: "Project brief discussion",
  scope: {
    kind: "artifact",
    projectId: project.id,
    stage: "brief",
    artifactId: "brief",
    versionId: brief.id,
  },
  summary: "",
  createdAt: "t",
  updatedAt: "t",
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("LongFormWorkspace", () => {
  it("creates a persistent project, edits the default brief, and approves its version", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/projects") return response([]);
      if (path === "/api/long-form/projects") {
        return response({ project, brief, workflow: draftWorkflow }, 201);
      }
      if (path === `/api/long-form/projects/${project.id}/conversations` && !init?.method) {
        return response([]);
      }
      if (path === `/api/long-form/projects/${project.id}/conversations` && init?.method === "POST") {
        return response(conversation, 201);
      }
      if (path === `/api/long-form/projects/${project.id}/conversations/${conversation.id}`) {
        return response({ conversation, messages: [], proposals: [] });
      }
      if (path === `/api/long-form/projects/${project.id}/brief` && init?.method === "PUT") {
        const content = JSON.parse(String(init.body));
        return response({
          brief: { ...brief, id: "brief-v2", version: 2, content },
          workflow: draftWorkflow,
        }, 201);
      }
      if (path === `/api/long-form/projects/${project.id}/brief/approve`) {
        return response({ ...draftWorkflow, status: "approved", approvedVersionId: "brief-v2" });
      }
      return response({ error: `Unexpected request: ${path}` }, 500);
    });
    const user = userEvent.setup();
    render(<LongFormWorkspace />);

    await user.type(await screen.findByLabelText("Working title"), project.name);
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByRole("heading", { name: "Project brief" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New project" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Project discussion" })).toBeTruthy();
    expect(screen.getByLabelText("Scope")).toBeTruthy();
    expect((screen.getByLabelText("Total words") as HTMLInputElement).value).toBe("175000");
    expect(screen.getByText("Scope")).toBeTruthy();
    expect(screen.getByText("Project brief · version 1")).toBeTruthy();

    await user.type(screen.getByPlaceholderText("What is this adaptation or original story about?"), "A very long mystery.");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Draft saved locally.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/long-form/projects/${project.id}/brief`,
      expect.objectContaining({ method: "PUT", body: expect.stringContaining("A very long mystery.") }),
    );

    await user.click(screen.getByRole("button", { name: "Approve brief" }));
    await waitFor(() => expect(screen.getAllByText("approved")).toHaveLength(2));
    expect(screen.getByText(/Story-bible work will be the next stage/)).toBeTruthy();
  });
});
