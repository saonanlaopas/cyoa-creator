// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandManager } from "../src/features/generator/CommandManager.js";
import type { InstructionCommand } from "../src/api/quick-generation.js";
import { QuickGenerator } from "../src/features/generator/QuickGenerator.js";

const command = (overrides: Partial<InstructionCommand> = {}): InstructionCommand => ({
  id: "project-tone",
  scope: "project",
  projectId: "p1",
  name: "Tone",
  instruction: "Use a mature tone.",
  enabled: true,
  position: 1,
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:00:00.000Z",
  ...overrides,
});

const response = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("QuickGenerator draft persistence", () => {
  it("reuses a verified stored draft after refresh", async () => {
    localStorage.setItem("story-to-cyoa.active-project-id", "saved");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path === "/api/settings/openrouter") return response({ configured: false });
      if (path === "/api/projects/saved") return response({ id: "saved" });
      return response([]);
    });
    render(<QuickGenerator />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/projects/saved"));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/quick/drafts", expect.anything());
  });

  it("replaces a stale stored draft safely", async () => {
    localStorage.setItem("story-to-cyoa.active-project-id", "stale");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path === "/api/settings/openrouter") return response({ configured: false });
      if (path === "/api/projects/stale") return new Response("", { status: 404 });
      if (path === "/api/quick/drafts") return response({ projectId: "fresh" });
      return response([]);
    });
    render(<QuickGenerator />);
    await waitFor(() => expect(localStorage.getItem("story-to-cyoa.active-project-id")).toBe("fresh"));
    expect(fetchMock).toHaveBeenCalledWith("/api/quick/drafts", expect.objectContaining({ method: "POST" }));
  });
});

describe("CommandManager", () => {
  it("creates project commands by default and explicitly promotes globally", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response());
    const user = userEvent.setup();
    render(<CommandManager projectId="p1" globalCommands={[]} projectCommands={[]} onChanged={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(screen.getByRole("button", { name: "Add command" }));
    await user.type(screen.getByLabelText("Command name"), "Tone");
    await user.type(screen.getByLabelText("Instruction"), "Use a mature tone.");
    await user.click(screen.getByRole("button", { name: "Save for this story" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/commands", expect.objectContaining({ method: "POST" }));

    render(<CommandManager projectId="p1" globalCommands={[]} projectCommands={[command()]} onChanged={vi.fn().mockResolvedValue(undefined)} />);
    await user.click(screen.getByRole("button", { name: "Promote Tone to global" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/commands/project-tone/promote", expect.objectContaining({ method: "POST" }));
  });

  it("edits, toggles, deletes, and deterministically reorders within a scope", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response());
    const user = userEvent.setup();
    render(<CommandManager
      projectId="p1"
      globalCommands={[command({ id: "global-a", scope: "global", projectId: null, name: "Canon", position: 10 }), command({ id: "global-b", scope: "global", projectId: null, name: "Style", position: 20 })]}
      projectCommands={[command()]}
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />);

    const projectCommand = screen.getByRole("listitem", { name: /Tone/ });
    await user.click(within(projectCommand).getByRole("button", { name: "Edit Tone" }));
    const name = screen.getByLabelText("Command name");
    await user.clear(name);
    await user.type(name, "Voice");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/commands/project-tone", expect.objectContaining({ method: "PATCH" }));

    await user.click(within(projectCommand).getByRole("button", { name: "Disable Tone" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/commands/project-tone", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: false }) }));

    await user.click(screen.getByRole("button", { name: "Move Style up" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/commands/global/reorder", expect.objectContaining({ method: "PUT", body: JSON.stringify({ ids: ["global-b", "global-a"] }) }));

    await user.click(within(projectCommand).getByRole("button", { name: "Delete Tone" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/commands/project-tone", expect.objectContaining({ method: "DELETE" }));
  });

  it("uses presets to populate the form without saving", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response());
    const user = userEvent.setup();
    render(<CommandManager projectId="p1" globalCommands={[]} projectCommands={[]} onChanged={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(screen.getByRole("button", { name: "Add command" }));
    await user.click(screen.getByRole("button", { name: "Preset: Preserve characterization" }));

    expect((screen.getByLabelText("Command name") as HTMLInputElement).value).toBe("Preserve characterization");
    expect((screen.getByLabelText("Instruction") as HTMLTextAreaElement).value).toContain("characterization");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reloads once after a rejected reorder while retaining the mutation error", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Reorder IDs must match command scope" }), { status: 400 }));
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<CommandManager
      projectId="p1"
      globalCommands={[command({ id: "global-a", scope: "global", projectId: null, name: "Canon", position: 0 }), command({ id: "global-b", scope: "global", projectId: null, name: "Style", position: 1 })]}
      projectCommands={[]}
      onChanged={onChanged}
    />);

    await user.click(screen.getByRole("button", { name: "Move Style up" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert").textContent).toContain("Could not save command changes.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry reload after a successful reorder when normal refresh fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response());
    const onChanged = vi.fn().mockRejectedValue(new Error("Commands could not be reloaded."));
    const user = userEvent.setup();
    render(<CommandManager
      projectId="p1"
      globalCommands={[command({ id: "global-a", scope: "global", projectId: null, name: "Canon", position: 0 }), command({ id: "global-b", scope: "global", projectId: null, name: "Style", position: 1 })]}
      projectCommands={[]}
      onChanged={onChanged}
    />);

    await user.click(screen.getByRole("button", { name: "Move Style up" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert").textContent).toContain("Commands could not be reloaded.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
